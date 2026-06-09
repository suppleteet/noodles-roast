/**
 * ComedianBrain — client-side state machine that orchestrates the comedy show.
 *
 * Responsibilities:
 *   - Owns the show flow: greeting → vision jokes → Q&A cycles → vision interrupts
 *   - Calls /api/generate-joke (Gemini Flash) for all speech content
 *   - Routes generated text to ElevenLabs via queueSpeak()
 *   - Controls mic gating (listening vs passive vs off)
 *   - Maintains joke hopper and conversation ledger for callbacks
 *
 * NOT responsible for:
 *   - Gemini Live WebSocket management (LiveSessionController does that)
 *   - Audio playback (usePcmPlayback does that)
 *   - React state (uses injected getStoreState() + setters)
 */

import type { MotionState } from "@/lib/motionStates";
import { inferFillerMotionFromAnswer } from "@/lib/motionInference";
import type { BrainState, MicMode } from "@/lib/comedianBrainConfig";
import { STATE_CONFIG } from "@/lib/comedianBrainConfig";
import { COMEDIAN_CONFIG } from "@/lib/comedianConfig";
import { VISION_MODEL } from "@/lib/constants";

import {
  QUESTION_BANK,
  CONFIRM_TAIL_FILLERS,
  DEFAULT_CONFIRM_ECHO_TEMPLATES,
  ECHO_REJECTION_TEMPLATES,
  REJECT_TEMPLATES,
  type ComedyQuestion,
} from "@/lib/questionBank";
import { RAPID_FIRE_QUESTION_BANK } from "@/lib/rapidFireQuestionBank";
import { TOAST_QUESTION_BANK } from "@/lib/toastQuestionBank";
import {
  NONWORD_FILLERS,
  ECHO_FILLER_TEMPLATES,
  ECHO_FILLER_PROBABILITY,
  RAPID_FIRE_ACKS,
  RAPID_FIRE_OPENERS,
  RAPID_FIRE_OPENERS_VULGAR,
  QUESTION_BRIDGES,
  CONFIRM_DENIED_LINE,
  ANSWER_FALLBACK_ROASTS,
  GREETING_FALLBACK,
  WRAPUP_FALLBACK,
  WRAPUP_BRIDGES,
  TECHNICAL_DIFFICULTIES_LINES,
  TOAST_FILLER_LINES,
  TOAST_GREETINGS,
  TOAST_TECHNICAL_DIFFICULTIES_LINES,
  TOAST_ANSWER_FALLBACK_ROASTS,
  CONTEXTUAL_QUESTION_PRODS,
  CONTEXTUAL_FALLBACK_QUESTION,
  CONTEXTUAL_FALLBACK_PRODS,
  RHETORICAL_QUESTIONS,
  DEFAULT_GREETING,
} from "@/lib/scriptLines";
import { matchExpectedAnswer } from "@/lib/expectedAnswerMatch";
import type { ExpectedJokesResponse } from "@/app/api/generate-expected-jokes/route";
import { transcriptConfidence, CONFIDENCE_THRESHOLDS } from "@/lib/transcriptConfidence";
import { diffObservations } from "@/lib/visionDiff";
import type { JokeResponse, JokeItem } from "@/app/api/generate-joke/route";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import type { BurnIntensity } from "@/lib/prompts";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ScoredJoke extends JokeItem {
  sourceContext: string;
  createdAt: number;
}

export interface LedgerEntry {
  type: "question" | "answer" | "joke" | "observation" | "reaction";
  text: string;
  timestamp: number;
  tags: string[];
}

export interface JokeStreamSink {
  pushAudio: (b64Pcm: string) => void;
  /** Record the joke's full text in transcript / lastSpokenText.
   *  Called when the LLM closes the joke JSON object. Does NOT mark the
   *  audio buffer done — EL TTS is still synthesizing remaining audio. */
  finalize: (text: string) => void;
  /** Signal that EL has finished producing audio for this joke. Closes
   *  the audio buffer so the playback chain can advance to the next item. */
  endAudio: () => void;
  cancel: () => void;
}

export interface ComedianBrainDeps {
  /** appendToPrev: when true, merge this text into the previous puppet transcript entry
   *  (single paragraph for streamed multi-joke deliveries). TTS pipeline is unaffected.
   *  voiceOverride: partial ElevenLabs voice settings to merge over the resolved settings —
   *  used to slow fillers (speed 0.75) without affecting the base voice or jokes. */
  queueSpeak: (
    text: string,
    motion?: MotionState,
    intensity?: number,
    appendToPrev?: boolean,
    voiceOverride?: Partial<import("@/store/useSessionStore").VoiceSettings>,
  ) => void;
  /**
   * Streaming-TTS variant: when present, the brain enables server-side joke
   * audio streaming. Returns a sink for the brain to push base64 PCM into as
   * SSE `audio` events arrive. `finalize(text)` is called when the LLM joke
   * JSON object closes.
   */
  openJokeStream?: (
    motion: MotionState,
    intensity: number,
    options?: { appendToPrev?: boolean },
  ) => JokeStreamSink;
  /** Base voice settings for streaming TTS (sent server-side as baseVoiceSettings). */
  getVoiceSettings?: () => import("@/store/useSessionStore").VoiceSettings;
  cancelSpeech: () => void;
  isQueueEmpty: () => boolean;
  setMotion: (state: MotionState, intensity: number) => void;
  captureFrame: () => string | undefined;
  getPersona: () => PersonaId;
  getBurnIntensity: () => BurnIntensity;
  getContentMode: () => "clean" | "vulgar";
  getObservations: () => string[];
  getVisionSetting: () => string | null;
  getAmbientContext: () => import("@/store/useSessionStore").AmbientContext | null;
  /** Optional async local culture/vibe line (filled after geolocation). */
  getTownFlavor: () => string | null;
  /** LLM model ID for joke generation (e.g. "gemini-3.5-flash", "gpt-4o"). */
  getRoastModel: () => string;
  /** Conversation flow style. Drives which question bank the brain pulls from. */
  getFlowMode: () => import("@/store/useSessionStore").FlowMode;
  /** Dev experiment: when true, generate every question via the LLM (simple/closed
   *  style, repeat-aware) instead of the fixed bank. */
  getLlmQuestions?: () => boolean;
  /** Top-level experience the user picked on the landing screen — "roast" or "toast".
   *  When "toast": brain pulls from TOAST_QUESTION_BANK, skips the FlowMode/persona
   *  branches, and swaps scripted lines (greetings, fillers, fallbacks) to the Toast
   *  variants. Defaults to "roast" if the dep isn't supplied (back-compat for tests). */
  getExperienceType?: () => import("@/store/useSessionStore").ExperienceType;
  /** Current mic input RMS (0-1) — used for background noise gating. */
  getInputAmplitude: () => number;
  /** Multi-turn chat session ID — if set, API routes reuse the session instead of sending the full persona. */
  getSessionId: () => string | null;
  setBrainState: (state: BrainState | null) => void;
  setCurrentQuestion: (q: string | null) => void;
  setUserAnswer: (ans: string) => void;
  logTiming: (entry: string) => void;
  /** Legible LLM call/response log for the debug panel. "→" = what we asked the model,
   *  "←" = the text it returned. Plain text only, never JSON. */
  logLlm?: (dir: "→" | "←", label: string, text: string) => void;
  /** Surface a fatal error to the user (quota exhaustion, API key missing, etc.) */
  setError?: (error: string) => void;
  /** Called when a Gemini call returns 503 UNAVAILABLE. Controller surfaces a
   *  fallback prompt to the user; on accept the session restarts with the
   *  suggested model. Brain stops issuing further calls after this fires. */
  onModelUnavailable?: (failedModel: string, suggestedFallback: string) => void;
  /** Called when session should reveal the puppet (fade in). */
  revealSession?: () => void;
  /** Fire-and-forget: save an in-session critique to feedback storage. */
  saveCritique?: (text: string, context: { persona: PersonaId; lastJokeText?: string }) => void;
  /** Called once after the wrapup closing line has finished playing — controller uses this to setPhase("stopped"). */
  onSessionEnd?: () => void;
  /** Optional: pre-seed for testing */
  initialHopper?: ScoredJoke[];
  initialLedger?: LedgerEntry[];
  /** Pre-fetched greeting result — if set, enterGreeting() skips generation. */
  prefetchedGreeting?: Promise<JokeResponse | null>;
  /**
   * Pre-fetched greeting audio — chunks already streaming in from /api/tts-ws
   * fired during permissions grant. enterGreeting calls `playPrefetchedAudio`
   * with this buffer instead of `queueSpeak`, saving the EL round-trip.
   */
  prefetchedGreetingAudio?: Promise<import("@/lib/ttsChunkBuffer").TtsChunkBuffer | null>;
  /** Play a buffer that's already being filled by a prefetched TTS call. */
  playPrefetchedAudio?: (
    text: string,
    buffer: import("@/lib/ttsChunkBuffer").TtsChunkBuffer,
    motion?: MotionState,
    intensity?: number,
    appendToPrev?: boolean,
  ) => void;
}

// Filler voice motion is now threaded from `lastJokeMotion` per call (see
// _queueNextPumpFiller) so the filler reads as a damped echo of the prior
// joke's mood — earlier the constant "energetic" preset jumped tone between
// joke and filler every cycle. No module-level constant anymore.

// ─── Fisher-Yates shuffle ───────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Word count helper ──────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function compactGreetingText(text: string): string {
  const maxWords = 28;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (wordCount(trimmed) <= maxWords) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const completeCandidate = sentences.filter((s) => wordCount(s) <= maxWords).at(-1);
  // Never cut a generated greeting mid-thought. A slightly longer first joke is
  // better than a line that sounds like TTS stopped in the middle of a setup.
  return completeCandidate ?? sentences[0] ?? trimmed;
}

function lastWordToken(text: string): string {
  const match = text.match(/([A-Za-z0-9]+)[^A-Za-z0-9]*$/);
  return match?.[1] ?? "";
}

function normalizeForConfirm(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:!?-]+/, "")
    .replace(/[,.;:!?-]+$/, "")
    // Strip leading hesitation markers so the confirm echo doesn't mock the user's filler.
    .replace(/^(uh+|um+|er+|ah+|so|like|well|okay|oh)\s*[,.]?\s*/i, "")
    .trim();
}

function shouldStartSpeculative(answerBuffer: string): boolean {
  const trimmed = answerBuffer.trim();
  const words = wordCount(trimmed);
  if (words >= 2) return true;
  if (words === 1) {
    // Avoid speculative calls on very short partial chunks ("Ty", "No", "Uh").
    // This reduces false starts before STT finishes the first word.
    const token = trimmed.split(/\s+/)[0] ?? "";
    return token.length >= 4;
  }
  return false;
}

function normalizeAnswerToken(text: string): string {
  return text.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").trim();
}

// ─── Smart transcript joining ────────────────────────────────────────────────────
// Gemini sends syllable-level chunks ("Ye", "s", ", one", "dog.").
// Blind space-join produces "Ye s , one dog." — garbled. This helper joins
// intelligently: no space if the new chunk looks like a word continuation.

function smartJoin(buffer: string, chunk: string): string {
  if (!buffer) return chunk;
  if (!chunk) return buffer;

  const lastChar = buffer[buffer.length - 1];
  const firstChar = chunk[0];

  // New chunk starts with punctuation or space — no extra space needed
  if (/^[\s,;:.!?'"\-)]/.test(firstChar)) return buffer + chunk;

  // Previous buffer ends with space or opening bracket — no extra space
  if (/[\s(["']$/.test(lastChar)) return buffer + chunk;

  // Previous buffer ends with a letter and chunk starts with lowercase letter, with no
  // leading space on the chunk. STT consistently emits a leading space on real word
  // boundaries — its absence is a strong signal that this is a continuation of the same
  // word ("agri" + "cul" → "agricul", "Ye" + "s" → "Yes"). Always concat without space.
  if (/[a-zA-Z]$/.test(lastChar) && /^[a-z]/.test(firstChar)) {
    return buffer + chunk;
  }

  // Digit followed by digit — likely a number continuation ("4" + "2" → "42")
  if (/[0-9]$/.test(lastChar) && /^[0-9]/.test(firstChar)) return buffer + chunk;

  // Digit/letter followed by uppercase — likely compound ("3" + "D" → "3D")
  if (/[a-zA-Z0-9]$/.test(lastChar) && /^[A-Z]$/.test(chunk)) return buffer + chunk;

  // Default: add space
  return buffer + " " + chunk;
}

// ─── Levenshtein similarity (cheap approximate) ─────────────────────────────────

function isSimilarAnswer(a: string, b: string): boolean {
  const wa = wordCount(a);
  const wb = wordCount(b);
  if (Math.abs(wa - wb) > 0.2 * Math.max(wa, wb, 1)) return false;
  // Starts-with heuristic: if final answer starts with speculative snapshot, reuse it
  return b.toLowerCase().startsWith(a.toLowerCase().slice(0, Math.min(a.length, 40)));
}

// ─── ComedianBrain ──────────────────────────────────────────────────────────────

export class ComedianBrain {
  private state: BrainState = "greeting";
  private micMode: MicMode = "off";

  // Q&A state
  private shuffledQuestions: ComedyQuestion[] = [];
  private questionIndex = 0;
  private askedQuestionIds: Set<string> = new Set();
  private currentQuestion: ComedyQuestion | null = null;
  // Single-joke pipeline state
  private pipelineAnswer: string | null = null;
  private pipelineJokesDelivered = 0;
  private pipelinePreviousJokes: string[] = []; // what was already said, so pipeline doesn't repeat
  private pipelinePrefetch: { jokes: JokeItem[]; meta: { tags?: string[] } | null; done: boolean } | null = null;
  private pipelinePrefetchAbort: AbortController | null = null;
  /** Pre-queued question — selected during joke delivery so enterAskQuestion can advance without an LLM round-trip. */
  private preQueuedQuestion: ComedyQuestion | null = null;
  /** Rephrased text resolved during pre-queue. Null = rephrase didn't finish in time → fall back to original at enterAskQuestion. */
  private preQueuedRephrasedText: string | null = null;
  private rephraseAbort: AbortController | null = null;
  private answerBuffer = "";
  /** True once Gemini Live sent inputTranscription with finished=true for this answer turn. */
  private sttHadFinalSegment = false;
  private earlyListenActivated = false; // true once question TTS is nearly done — gate for early answer capture
  private fillerFiredForAnswer = false; // prevent double filler on late-transcription re-entry
  /** Incremented each time enterGenerating fires — stale stream callbacks check this to avoid double delivery. */
  private deliveryGeneration = 0;
  private prodCount = 0;
  private consecutiveSilentQuestions = 0;
  private visionOnlyMode = false;
  private bankQuestionsInARow = 0; // after 1-2 bank questions, interleave a contextual/vision question
  private started = false;
  private lastDeliveredJokeText = "";

  // Vision state
  private previousObservations: string[] = [];
  private transitionCount = 0;
  /** Queued vision interrupt — consumed at the next natural transition point. */
  private pendingVisionInterrupt: { changes: string[]; current: string[]; previous: string[] } | null = null;

  // Speculative generation (Original flow — partial-answer-snapshot prefetch).
  private speculativeRequest: {
    snapshot: string;
    abort: AbortController;
    result: Promise<JokeResponse | null>;
  } | null = null;

  // Speculative pre-generation by expected answer (Rapid Fire flow).
  // Fired when the next question is pre-queued; resolves to a map of
  // {answerKey -> 2 jokes}. On answer arrival, the brain fuzzy-matches the
  // STT to a key and delivers the cached pair instantly. questionId scopes
  // the cache so a stale request for a different question doesn't fire.
  private expectedJokesCache: {
    questionId: string;
    abort: AbortController;
    /** null until the fetch resolves. */
    jokesByAnswer: Map<string, JokeItem[]> | null;
    /** Awaitable handle if a consumer wants to briefly wait for resolution. */
    ready: Promise<void>;
  } | null = null;

  // Hopper
  private jokeHopper: ScoredJoke[] = [];
  private hopperAbort: AbortController | null = null;
  /** Canned save lines already spoken this session — _pickFallbackRoast avoids repeats. */
  private usedFallbackLines = new Set<string>();

  // Ledger
  private ledger: LedgerEntry[] = [];

  // Timers
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private prodTimer: ReturnType<typeof setTimeout> | null = null;
  private devNoteTimer: ReturnType<typeof setTimeout> | null = null;

  // Filler pump (active during "generating" — keeps audio chain non-silent until joke arrives).
  // Each filler is preceded by COMEDIAN_CONFIG.fillerBreathMs of real silence (pumpTimer)
  // instead of a baked-in leading "..." — EL rendered the ellipsis flatly and spiked the
  // attack on the following word. pumpTimer fires the breath; on its tick we queue the filler
  // audio, and the next drain event schedules the next breath. Cancelled when the pump stops.
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private fillerPumpActive = false;
  private fillerLineCount = 0;
  private fillerAnswerForPump = "";
  private fillerLastText: string | null = null;
  private fillerFirstText: string | null = null;
  /** Reaction motion + intensity for fillers, inferred once from the user's answer. */
  private fillerMotion: MotionState = "thinking";
  private fillerIntensity = 0.6;

  /** Rapid Fire burst accumulator: {question, answer} pairs collected with only quick acks
   *  until the burst is full (rapidFireBurstSize) — then one joke burst ties them together. */
  private rapidFireBurst: Array<{ question: string; answer: string }> = [];

  /** Rapid Fire: the user's name once captured (from the opener answer), used to occasionally
   *  personalize later questions ("Are you single, Tyler?"). Null until they say it. */
  private knownName: string | null = null;

  /** Rapid Fire: the instant opener doubles as the name question, so greeting advances
   *  straight to wait_answer instead of asking a separate name question. */
  private rapidFireOpenerIsNameAsk = false;

  /** Rapid Fire: toggles each burst so vision jokes alternate with question bursts. */
  private rapidFireVisionJokeTurn = false;

  /** Watchdog: fires if joke generation produces no joke within generationTimeoutMs.
   *  Aborts the hung request and delivers a canned fallback so the puppet never sits
   *  silent in "generating" forever (e.g. when generate-speak / Gemini hangs). */
  private generationWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** Abort controller for the in-flight generate-speak fetch — let the watchdog cancel it. */
  private generationAbort: AbortController | null = null;

  // Availability flags
  private micAvailable = true;
  private cameraAvailable = true;
  private vadAvailable = true;

  // Last delivered joke motion — used to match question inflection
  private lastJokeMotion: import("@/lib/motionStates").MotionState = "emphasis";
  private lastJokeIntensity = 0.75;

  // Confirmation state
  private pendingConfirmAnswer = "";
  private confirmBuffer = "";
  private confirmAttempts = 0;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  // Greeting state
  private visionReadyForGreeting = false;
  private greetingTtsDrained = false;
  private greetingSpeechQueued = false; // true once greeting generation resolves and speech is queued
  private greetingFallbackSpoken = false; // true once the instant canned fallback fired — late prefetch chains instead of being discarded
  private greetingVisionTimeout: ReturnType<typeof setTimeout> | null = null;
  private visionJokePrefetch: Promise<JokeResponse | null> | null = null;

  // Model availability — flipped once a 503 has fired the onModelUnavailable
  // callback, so we don't spam the user with the same prompt for every retry.
  private modelUnavailableFired = false;

  // Wrapup state
  private pendingWrapup = false;        // true once requestWrapup() fires; consumed by next safe transition
  private wrapupSessionEnded = false;   // guards onSessionEnd from firing twice
  /** True once the wrapup closing line (or its fallback) has been queueSpeak'd. Until this
   *  flips true, drain events during wrapup are just the bridge phrase finishing — firing
   *  session end then would cut the closing line off mid-sentence when it eventually arrives. */
  private wrapupClosingQueued = false;

  // Deps
  private readonly deps: ComedianBrainDeps;

  constructor(deps: ComedianBrainDeps) {
    this.deps = deps;
    if (deps.initialHopper) this.jokeHopper = [...deps.initialHopper];
    if (deps.initialLedger) this.ledger = [...deps.initialLedger];
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) {
      this.deps.logTiming("brain: start() called again — ignoring (already started)");
      return;
    }
    this.started = true;

    // Always lead with name so the puppet has something personal to work with.
    // Everything else shuffles freely — avoids the show feeling like a questionnaire.
    // ExperienceType is the top-level switch:
    //   - "toast": one bank (TOAST_QUESTION_BANK), no FlowMode branching,
    //     no Rapid Fire, no persona.
    //   - "roast": existing FlowMode-driven selection (Rapid Fire vs Original).
    const experienceType = this._getExperienceType();
    const flowMode = this.deps.getFlowMode();
    const bank =
      experienceType === "toast"
        ? TOAST_QUESTION_BANK
        : flowMode === "rapid_fire"
          ? RAPID_FIRE_QUESTION_BANK
          : QUESTION_BANK;
    this.deps.logTiming(
      `brain: experience=${experienceType} flow=${flowMode} bank=${bank.length}q`,
    );
    const nameQuestion = bank.find((q) => q.id === "name");
    const rest = shuffle(bank.filter((q) => q.id !== "name"));
    this.shuffledQuestions = nameQuestion ? [nameQuestion, ...rest] : shuffle(bank);
    this.questionIndex = 0;
    this.askedQuestionIds = new Set();
    this.ledger = [];
    this.jokeHopper = [];
    this.usedFallbackLines.clear();
    this.rapidFireBurst = [];
    this.knownName = null;
    this.rapidFireOpenerIsNameAsk = false;
    this.rapidFireVisionJokeTurn = false;
    this.transitionCount = 0;
    this.consecutiveSilentQuestions = 0;
    this.visionOnlyMode = false;
    this._cancelPipelinePrefetch();
    this._cancelRephrase();
    this.pendingWrapup = false;
    this.wrapupSessionEnded = false;
    this.wrapupClosingQueued = false;
    this.modelUnavailableFired = false;

    // Latency experiment: skip greeting entirely
    if (COMEDIAN_CONFIG.skipGreeting) {
      this.deps.logTiming("brain: skipGreeting — jumping to ask_question");
      this.enterAskQuestion();
      return;
    }

    this.enterGreeting();
  }

  stop(): void {
    this._clearTimers();
    this._cancelSpeculative();
    this._cancelExpectedJokesGen();
    this._cancelHopper();
    this._cancelRephrase();
    this.deps.setBrainState(null);
    this.micMode = "off";
  }

  isListening(): boolean {
    return this.micMode === "listening";
  }

  /** True when mic audio should be sent to Gemini (listening OR passive warm-up) */
  isAudioActive(): boolean {
    return this.micMode !== "off";
  }

  /**
   * Called by LiveSessionController when the question TTS is nearly done.
   * Switches mic to listening early so Gemini VAD is ready before the question ends.
   */
  activateEarlyListen(): void {
    if (this.state !== "ask_question" || this.micMode === "listening") return;
    this.micMode = "listening";
    this.earlyListenActivated = true;
    this.deps.logTiming("brain: early listen activated");
  }

  setMicAvailable(available: boolean): void {
    this.micAvailable = available;
  }

  setCameraAvailable(available: boolean): void {
    this.cameraAvailable = available;
  }

  setVadAvailable(available: boolean): void {
    this.vadAvailable = available;
  }

  /**
   * Signal the brain to wind down. Called by LiveSessionController when the
   * session-length timer fires. The brain finishes its current line, then
   * routes to `wrapup` at the next safe transition (next ask_question or
   * check_vision return), generates one closing line, and signals onSessionEnd
   * after TTS drains.
   */
  requestWrapup(): void {
    if (this.pendingWrapup || this.state === "wrapup") return;
    this.pendingWrapup = true;
    this.deps.logTiming("brain: wrapup requested — will route to wrapup at next transition");
    // No immediate-enter shortcut. Previously this cut the user off mid-answer (state
    // was wait_answer/prodding when the wrapup timer fired). The flag will be picked up
    // at the next safe transition — _onDeliveringDrained, enterCheckVision, or
    // enterAskQuestion — all of which fire only after the puppet has delivered its
    // current line. If the user stays silent, the prod timer chain exhausts and routes
    // through check_vision, which respects pendingWrapup. Either way the closing line
    // lands only AFTER the next joke delivers.
  }

  // ─── Dev voice notes (gesture-triggered) ──────────────────────────────────────

  /** Called when vision detects thumbs-down — pauses the brain for a voice note. */
  enterDevNote(): void {
    if (!COMEDIAN_CONFIG.devNotesEnabled || this.state === "dev_note") return;
    this._clearTimers();
    this._transition("dev_note");
    this.deps.setMotion("idle", 0.3);
    this.deps.cancelSpeech();
    this.deps.logTiming("brain: dev_note — thumbs down detected, pausing");
    this.devNoteTimer = setTimeout(() => {
      this.devNoteTimer = null;
      if (this.state === "dev_note") {
        this.deps.logTiming("brain: dev_note timeout — auto-resuming");
        this._advanceFromDevNote();
      }
    }, COMEDIAN_CONFIG.devNoteTimeoutMs);
  }

  /** Called when vision detects thumbs-up — resumes the brain from dev_note. */
  resumeFromDevNote(): void {
    if (this.state !== "dev_note") return;
    this.deps.logTiming("brain: dev_note — thumbs up detected, resuming");
    this._advanceFromDevNote();
  }

  private _advanceFromDevNote(): void {
    if (this.devNoteTimer) { clearTimeout(this.devNoteTimer); this.devNoteTimer = null; }
    this.enterCheckVision();
  }

  /**
   * Called by Silero VAD when end-of-speech is detected (~100-200ms latency).
   * This fires MUCH faster than the answerSilenceMs fallback timer.
   * If we already have transcript text from Gemini, complete the answer immediately.
   */
  onVadSpeechEnd(): void {
    // During confirmation: VAD speech-end completes the yes/no response
    if (this.state === "confirm_answer") {
      const response = this.confirmBuffer.trim();
      if (!response) return; // no transcript yet
      this.deps.logTiming(`brain: VAD speech-end in confirm → "${response}"`);
      this._clearConfirmTimer();
      this._processConfirmResponse();
      return;
    }

    if (this.state !== "wait_answer" && this.state !== "pre_generate") return;
    const answer = this.answerBuffer.trim();
    if (!answer) return; // no transcript yet — let the silence timer handle it

    // Silero often fires on a mid-sentence breath before Gemini marks the segment final.
    // Completing here queues the generating filler and cuts the user off. Defer to the
    // (length-aware) silence timer whenever the transcript reads as unfinished — multi-word
    // answers, and short danglers like "yes but" that the old >=3-word check committed
    // instantly. Viable short answers (names, yes/no) still complete immediately.
    if (
      !this.sttHadFinalSegment &&
      (wordCount(answer) >= 3 || this._answerNeedsMoreStt())
    ) {
      this.deps.logTiming(
        `brain: VAD speech-end deferred (no final STT yet) — "${answer.slice(0, 48)}"`,
      );
      this._clearTimers();
      this._startAnswerSilenceTimer();
      return;
    }

    this.deps.logTiming(`brain: VAD speech-end → completing "${answer.slice(0, 40)}"`);
    this._clearTimers();
    this._onAnswerComplete();
  }

  /**
   * Accumulate text into the answer buffer.
   * When `finished` is true, the text is the authoritative final transcription
   * for the current speech segment — replace the buffer wholesale to fix
   * smartJoin artifacts (e.g. "4 2" → "42").
   */
  private _accumulateAnswer(text: string, finished: boolean): void {
    if (finished && text.trim()) {
      this.answerBuffer = text;
    } else {
      this.answerBuffer = smartJoin(this.answerBuffer, text);
    }
    this.deps.setUserAnswer(this.answerBuffer);
  }

  /** Called when Gemini transcribes user speech */
  onInputTranscription(text: string, finished: boolean = false): void {
    if (!text.trim()) return;

    // In prodding state: user spoke → cancel prod, return to wait_answer
    if (this.state === "prodding") {
      this.deps.cancelSpeech();
      this._clearTimers();
      this._accumulateAnswer(text, finished);
      this._transition("wait_answer");
      this._startAnswerSilenceTimer();
      return;
    }

    // Confirmation state: accumulate into confirmBuffer for yes/no classification
    if (this.state === "confirm_answer") {
      this._clearConfirmTimer();
      if (finished && text.trim()) {
        this.confirmBuffer = text;
      } else {
        this.confirmBuffer = smartJoin(this.confirmBuffer, text);
      }
      this.deps.logTiming(`brain: confirm heard "${text}" → buffer "${this.confirmBuffer}"`);
      if (finished) {
        this._processConfirmResponse();
      } else {
        this._startConfirmSilenceTimer();
      }
      return;
    }

    // Late transcription during generation — STT tokens still arriving after silence timer fired.
    // Only restart if we haven't begun delivering yet. Once delivery starts, the answer is committed.
    if (this.state === "generating") {
      const oldAnswer = this.answerBuffer.trim();
      this._accumulateAnswer(text, finished);
      if (finished) this.sttHadFinalSegment = true;
      const newAnswer = this.answerBuffer.trim();
      const appended = newAnswer.toLowerCase().startsWith(oldAnswer.toLowerCase())
        ? newAnswer.slice(oldAnswer.length).trim()
        : "";

      // Late "yeah that's right" tails after a confirm prompt should not mutate
      // the committed answer and trigger another confirm loop.
      if (appended && ComedianBrain._isAffirmationTail(appended)) {
        this.deps.logTiming(`brain: late affirmation during generating — "${appended}" → no restart`);
        this.answerBuffer = oldAnswer;
        this.deps.setUserAnswer(this.answerBuffer);
        return;
      }

      // Explicit correction ("no, I said ...") should force a restart even if
      // similarity heuristics say it's "close".
      if (
        ComedianBrain._hasCorrectionCue(text) ||
        (appended && ComedianBrain._hasCorrectionCue(appended))
      ) {
        this._clearTimers();
        this.deps.cancelSpeech();
        this.deps.logTiming(`brain: correction cue during generating — "${text}" (restarting)`);
        this._transition("pre_generate");
        this._cancelSpeculative();
        this._startLateSilenceTimer();
        return;
      }

      if (appended && /[A-Za-z0-9]/.test(appended)) {
        this._clearTimers();
        this.deps.cancelSpeech();
        this.deps.logTiming(`brain: late transcription extended answer — "${appended}" (restarting)`);
        this._transition("pre_generate");
        this._cancelSpeculative();
        this._startLateSilenceTimer();
        return;
      }

      // If the buffer didn't materially change (just whitespace/punctuation), don't bounce.
      if (isSimilarAnswer(oldAnswer, newAnswer)) {
        this.deps.logTiming(`brain: late transcription during generating (similar) — "${text}" → no restart`);
        return;
      }
      this._clearTimers();
      this.deps.cancelSpeech();
      this.deps.logTiming(`brain: late transcription during generating — "${text}" → buffer now "${newAnswer}" (restarting)`);
      this._transition("pre_generate");
      this._cancelSpeculative();
      this._startLateSilenceTimer();
      return;
    }

    // While the puppet is delivering jokes the user can barge in to correct a mishearing
    // ("no, my name is Aleks not Alex"). Laughter and tiny acknowledgments stay passive —
    // anything substantive cancels TTS, replaces the answer buffer, and restarts the pipeline.
    if (this.state === "delivering") {
      if (this._shouldInterruptDelivering(text)) {
        this.deps.logTiming(`brain: user barge-in during delivering — "${text}" (restarting)`);
        this.deps.cancelSpeech();
        this._clearTimers();
        this._cancelSpeculative();
        this._addLedger("reaction", "[interrupted]", []);

        // Treat the new text as the corrected answer.
        this.answerBuffer = "";
        this._accumulateAnswer(text, finished);
        if (finished) this.sttHadFinalSegment = true;
        this.fillerFiredForAnswer = false; // allow a fresh filler on the corrected answer

        this._transition("pre_generate");
        if (finished) {
          this._onAnswerComplete();
        } else {
          this._startLateSilenceTimer();
        }
        return;
      }
      this._handleReactionText(text);
      return;
    }

    // Background noise gate: log when amplitude is low but DON'T filter.
    // The old gate silently dropped valid speech because Gemini's transcription
    // arrives after the user stops speaking — by then amplitude has dropped.
    // Gemini's own STT confidence is a better noise filter.
    if (COMEDIAN_CONFIG.inputAmplitudeMin > 0) {
      const amp = this.deps.getInputAmplitude();
      if (amp > 0 && amp < COMEDIAN_CONFIG.inputAmplitudeMin) {
        this.deps.logTiming(`brain: low amplitude ${amp.toFixed(3)} (threshold ${COMEDIAN_CONFIG.inputAmplitudeMin}) — accepting anyway`);
      }
    }

    // User speaks during question TTS — buffer it so wait_answer has the answer ready.
    // Trust Gemini's STT: if it transcribed something, treat it as user speech (the alternative
    // dropped real answers when users started replying before earlyListen activated, leaving
    // the brain with an empty buffer that prodded "I asked X, not for a moment of silence" while
    // the user could see their words on screen).
    if (this.state === "ask_question") {
      // Barge-in: if the user says something substantive while the puppet is still asking,
      // cut the question audio and treat the speech as the answer. Without this, insults
      // and corrections fired mid-question were quietly buffered, then surfaced as "the
      // answer" once the question finished — so the user's cut-off jumped in late as the
      // answer instead of interrupting. Same gate as the delivering-state barge-in.
      if (this._shouldInterruptDelivering(text)) {
        this.deps.logTiming(`brain: user barge-in during ask_question — "${text}" (cutting question)`);
        this.deps.cancelSpeech();
        this._clearTimers();
        this._cancelSpeculative();
        this._addLedger("reaction", "[interrupted]", []);

        this.answerBuffer = "";
        this._accumulateAnswer(text, finished);
        if (finished) this.sttHadFinalSegment = true;
        this.fillerFiredForAnswer = false;

        this._transition("pre_generate");
        if (finished) {
          this._onAnswerComplete();
        } else {
          this._startLateSilenceTimer();
        }
        return;
      }
      // Small/tiny chatter: keep the old passive-buffer behavior — let the question finish
      // and have the buffered text waiting in wait_answer.
      this._accumulateAnswer(text, finished);
      if (finished) this.sttHadFinalSegment = true;
      this.deps.logTiming(
        `brain: answer during ask_question${this.earlyListenActivated ? "" : " (pre-early-listen)"} — "${text}"`,
      );
      return;
    }

    if (this.state === "wait_answer" || this.state === "pre_generate") {
      this._clearTimers();
      this._accumulateAnswer(text, finished);
      if (finished) this.sttHadFinalSegment = true;
      this.deps.logTiming(`brain: heard "${text}" → buffer now "${this.answerBuffer}" (${wordCount(this.answerBuffer)}w)`);

      // Transcript-based early endpointing: complete immediately when the final transcript
      // looks like a complete thought OR a viable short answer (name/yes-no/number).
      if (
        finished &&
        (
          (wordCount(this.answerBuffer) >= 3 && ComedianBrain._looksComplete(this.answerBuffer)) ||
          this._isViableAnswer(this.answerBuffer)
        )
      ) {
        this.deps.logTiming(`brain: early endpoint — transcript looks complete "${this.answerBuffer.slice(-30)}"`);
        this._clearTimers();
        this._onAnswerComplete();
        return;
      }

      // Start speculative generation once we have enough words. Finished transcripts
      // endpoint above first, avoiding a wasted speculative call on final answers.
      if (
        !COMEDIAN_CONFIG.skipPreGeneration &&
        this.state === "wait_answer" &&
        wordCount(this.answerBuffer) >= COMEDIAN_CONFIG.speculativeMinWords &&
        shouldStartSpeculative(this.answerBuffer)
      ) {
        this._transition("pre_generate");
        this._startSpeculative();
      }

      this._startAnswerSilenceTimer();
    }
  }

  /** Words that strongly imply more is coming — if the answer's last real token is one
   *  of these, don't trust a terminal period. STT routinely inserts periods inside
   *  mid-sentence pauses ("No, my name is." → user about to say "Mr. Peanut man.").
   *  Kept in sync with the dangler list inside _isFillerEchoable. */
  private static readonly END_DANGLER_WORDS = new Set([
    "and", "but", "or", "so", "the", "a", "an", "to", "of", "in", "on", "at",
    "with", "for", "from", "by", "is", "was", "be", "are", "am", "my",
    "your", "his", "her", "their", "our", "its", "this", "that", "these",
    "those", "im", "ive", "ill",
  ]);

  /** Heuristic: does this transcript look like a complete thought? */
  private static _looksComplete(text: string): boolean {
    const trimmed = text.trim();
    // Sentence-ending punctuation … BUT only when the final word isn't a dangler
    // that almost certainly leads into more content (e.g. "No, my name is.").
    if (/[.?!]\s*$/.test(trimmed)) {
      const stripped = trimmed.replace(/[.?!,]+\s*$/, "").trim();
      const lastWord = lastWordToken(stripped).toLowerCase();
      if (ComedianBrain.END_DANGLER_WORDS.has(lastWord)) return false;
      return true;
    }
    // Common phrase terminals
    if (/\b(I guess|you know|I dunno|that's it|yeah|nope|no|yes)\s*$/i.test(trimmed)) return true;
    return false;
  }

  /** Heuristic: is this a plausible complete answer for the current question? */
  private _isViableAnswer(answer: string): boolean {
    const trimmed = answer.trim();
    if (!trimmed) return false;
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 3) return true;

    const normalized = normalizeAnswerToken(trimmed.toLowerCase());
    const qId = this.currentQuestion?.id ?? "";

    if (qId === "name") {
      // Single-word names are common; avoid accepting one-letter fragments.
      return normalized.length >= 2;
    }
    if (qId === "age") {
      return /\b\d{1,3}\b/.test(trimmed);
    }
    if (qId === "single") {
      return /^(yes|yeah|yep|yup|no|nah|nope|single|married|divorced|taken|it's complicated)\b/i.test(trimmed);
    }
    // 2+ words is enough to be a real answer. Single non-canonical words ("Super",
    // "Yeah", "Okay") are usually hesitations or sentence starters — wait for more
    // STT instead of generating a joke off one word. Single-word job titles like
    // "Dentist" are rare enough to lose vs. catching real multi-word answers early.
    return words.length >= 2;
  }

  /** Short confirmation chatter that often trails a just-confirmed answer. */
  private static _isAffirmationTail(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    return /^(,?\s*)?(yeah|yes|yep|yup|right|correct|exactly|that's right|that is right|uh huh|mhm|mm-hm)\b/.test(t);
  }

  /** Explicit correction cues that should override similarity checks. */
  private static _hasCorrectionCue(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    return /^(no|nah|nope|wrong)\b/.test(t) || /\b(i said|that's not|that is not|not that)\b/.test(t);
  }

  /**
   * Canned roast for when the LLM pipeline returns nothing (typically an
   * upstream API error — quota, missing key, malformed JSON). Keeps the show
   * going so the user sees a response instead of dead air + the next question.
   *
   * Does NOT echo the user's answer — the filler already does that work, so
   * including it here doubled up ("Smooches, you say." → "Smooches. Stunning…").
   */
  private _pickFallbackRoast(_answer: string): {
    text: string;
    motion: string;
    intensity: number;
  } {
    // Toast's fallback "save" line is warmer + drunker than the roast version.
    const pool = this._isToast() ? TOAST_ANSWER_FALLBACK_ROASTS : ANSWER_FALLBACK_ROASTS;
    // Never repeat a canned save line within a session — pick from the unused
    // ones first, and only recycle once the whole pool has been heard.
    let candidates = pool.filter((line) => !this.usedFallbackLines.has(line));
    if (candidates.length === 0) {
      this.usedFallbackLines.clear();
      candidates = [...pool];
    }
    const text = candidates[Math.floor(Math.random() * candidates.length)];
    this.usedFallbackLines.add(text);
    return {
      text,
      motion: this._isToast() ? "energetic" : "smug",
      intensity: this._isToast() ? 0.7 : 0.6,
    };
  }

  /** Normalize for substring match between STT and recent puppet lines. */
  private static _normalizeForEchoMatch(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * STT often returns the puppet's roast punchline (e.g. "you poor bastard") instead of the user's words.
   * If the transcript is a contiguous substring of a joke we just told, reject — don't confirm or roast it as fact.
   */
  private _answerEchoesRecentRoast(answer: string): boolean {
    const a = ComedianBrain._normalizeForEchoMatch(answer);
    if (a.length < 5) return false;
    if (wordCount(answer) > 10) return false;

    const sources: string[] = [];
    if (this.lastDeliveredJokeText) sources.push(this.lastDeliveredJokeText);
    for (const e of this.ledger) {
      if (e.type === "joke") sources.push(e.text);
    }

    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const t of sources) {
      const key = t.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(t);
    }

    for (const raw of dedup.slice(-5)) {
      const src = ComedianBrain._normalizeForEchoMatch(raw);
      if (src.length < 12) continue;
      if (src.includes(a)) return true;
    }

    return false;
  }

  /** Called when vision analysis completes (even with empty observations) */
  onVisionUpdate(observations: string[]): void {
    // Greeting fires generation immediately — no need to wait for vision
    if (this.state === "greeting") return;

    if (observations.length === 0) return;

    // When greeting was skipped, queue a vision joke for delivery after the current question
    if (COMEDIAN_CONFIG.skipGreeting && this.previousObservations.length === 0) {
      this.previousObservations = observations;
      this.deps.logTiming("brain: first vision with skipGreeting — queuing vision joke to hopper");
      this._generateJoke({
        context: "vision_opening",
        observations,
        knownFacts: this._getThrowbackContext(),
        imageBase64: this.cameraAvailable ? this.deps.captureFrame() : undefined,
      }).then((response) => {
        if (!response || response.jokes.length === 0) return;
        // Add to hopper instead of speaking immediately — avoids overlapping with question TTS
        for (const joke of response.jokes) {
          this._addToHopper(joke.text, joke.motion, joke.intensity, joke.score ?? 9);
        }
      });
    }

    // Proactive vision interrupt: if something interesting changes during delivering/wait_answer/ask_question,
    // flag it so the next transition inserts a vision react instead of the normal next step.
    if (
      this.previousObservations.length > 0 &&
      (this.state === "delivering" || this.state === "wait_answer" || this.state === "ask_question")
    ) {
      const { isInteresting, changes } = diffObservations(this.previousObservations, observations);
      if (isInteresting && changes.length > 0) {
        this.pendingVisionInterrupt = { changes, current: observations, previous: [...this.previousObservations] };
        this.previousObservations = [...observations];
        this.deps.logTiming(`brain: vision interrupt queued (${changes.length} changes) — will fire at next transition`);
        // Don't return — still feed hopper below
      }
    }

    // Feed hopper with new vision context
    this._fireHopperGeneration("vision", observations);

    // If stuck in check_vision (vision-only mode), re-evaluate with new observations
    if (this.state === "check_vision") {
      this.enterCheckVision();
    }
  }

  /** Called when all queued TTS has finished playing */
  onTtsQueueDrained(): void {
    switch (this.state) {
      case "greeting":
        this.greetingTtsDrained = true;
        this._maybeAdvanceFromGreeting();
        break;
      case "vision_jokes":
        this.enterAskQuestion();
        break;
      case "ask_question":
        this.enterWaitAnswer();
        break;
      case "confirm_answer":
        // Confirm prompt finished playing — start listening for yes/no
        this._startConfirmListenTimer();
        break;
      case "prodding":
        // Prod finished playing with no interruption — start next prod or skip
        this.prodCount++;
        if (this.prodCount >= COMEDIAN_CONFIG.maxProds) {
          this.consecutiveSilentQuestions++;
          if (
            this.consecutiveSilentQuestions >=
            COMEDIAN_CONFIG.silentQuestionsBeforeVisionMode
          ) {
            this.visionOnlyMode = true;
          }
          this.enterCheckVision();
        } else {
          // Give them another chance before the next prod
          this._startProdTimer();
        }
        break;
      case "generating":
        // Filler audio drained — queue the next filler directly so the audio chain stays
        // continuous until the joke arrives. Bails inside _queueNextPumpFiller if the pump was
        // already stopped (joke is on its way) or we hit fillerMaxStack.
        if (this.fillerPumpActive) {
          this._queueNextPumpFiller();
        }
        break;
      case "delivering":
        this._onDeliveringDrained();
        break;
      case "dev_note":
        break; // no-op — waiting for thumbs-up gesture
      case "redirecting":
        // After a redirect, advance to the next question — re-asking loops if the user keeps
        // giving off-topic answers (the puppet already nudged them back; move on)
        this.enterAskQuestion();
        break;
      case "vision_react":
        this.enterAskQuestion();
        break;
      case "wrapup":
        // Bridge audio drains BEFORE the closing-line LLM call returns (~2-3s). Don't fire
        // session end here — that would cut the closing line off mid-sentence when it
        // eventually arrives. _fireSessionEnd happens only after the closing line itself drains.
        if (this.wrapupClosingQueued) {
          this._fireSessionEnd();
        }
        break;
    }
  }

  /** Called when user barges in during speech */
  onInterrupted(): void {
    if (this.state === "delivering" || this.state === "vision_react") {
      // Log the interruption as a reaction
      this._addLedger("reaction", "[interrupted]", []);
    }
  }

  // ─── State entry methods ──────────────────────────────────────────────────────

  private enterGreeting(): void {
    this._transition("greeting");
    this.micMode = "off";
    this.greetingTtsDrained = false;
    this.greetingSpeechQueued = false;
    this.greetingFallbackSpoken = false;
    this.visionReadyForGreeting = true;

    this.deps.setMotion("thinking", 0.6);

    // Rapid Fire: skip the vision-dependent greeting joke entirely. Speak an INSTANT canned
    // opener that doubles as the name question — no LLM, no waiting on the camera — so TTFS is
    // just the TTS round-trip (~1s instead of ~10s). Vision analysis keeps running in the
    // background and feeds the interleaved vision jokes that come later.
    if (this._isRapidFireFlow()) {
      const vulgar = this.deps.getContentMode() === "vulgar";
      const openers = vulgar ? RAPID_FIRE_OPENERS_VULGAR : RAPID_FIRE_OPENERS;
      const opener = openers[Math.floor(Math.random() * openers.length)];
      const nameQ = this.shuffledQuestions.find((q) => q.id === "name") ?? this.shuffledQuestions[0];
      if (nameQ) {
        this.currentQuestion = nameQ;
        this.askedQuestionIds.add(nameQ.id);
      }
      this.deps.queueSpeak(opener, "energetic", 0.8);
      this.deps.setCurrentQuestion(opener);
      this._addLedger("question", opener, []);
      this.deps.setMotion("energetic", 0.8);
      this.greetingSpeechQueued = true;
      this.rapidFireOpenerIsNameAsk = true; // opener already asked the name → go to wait_answer
      this.deps.logTiming("brain: rapid fire instant opener (no vision wait)");
      this._maybeAdvanceFromGreeting();
      return;
    }

    // Use prefetched greeting if available (fired during Gemini Live connect to save time),
    // otherwise generate fresh.
    if (this.deps.prefetchedGreeting) {
      this.visionJokePrefetch = this.deps.prefetchedGreeting;
      this.deps.logTiming("brain: using prefetched greeting");
    } else {
      const observations = this.deps.getObservations();
      const frame = this.cameraAvailable ? this.deps.captureFrame() : undefined;
      const greetingContext = this._isRapidFireFlow() ? "rapid_fire_greeting" : "greeting";
      this.visionJokePrefetch = this._generateJoke({
        context: greetingContext,
        model: VISION_MODEL, // greeting always uses Gemini — fastest + best at vision
        observations,
        imageBase64: frame,
      });
      this.deps.logTiming(`brain: greeting generation fired (no prefetch, context=${greetingContext})`);
    }

    const queueGreeting = (
      response: JokeResponse | null,
      audioBuffer: import("@/lib/ttsChunkBuffer").TtsChunkBuffer | null,
    ) => {
      if (this.state !== "greeting" || this.greetingSpeechQueued) return;
      if (this.greetingVisionTimeout) {
        clearTimeout(this.greetingVisionTimeout);
        this.greetingVisionTimeout = null;
      }
      if (!response || response.jokes.length === 0) {
        const fallback = this._greetingFallbackLine();
        this.deps.logTiming("brain: greeting failed — using short fallback");
        this.deps.queueSpeak(fallback, "energetic", 0.8);
        this._addLedger("joke", fallback, []);
      } else {
        const joke = response.jokes[0];
        const text = compactGreetingText(joke.text);
        if (text !== joke.text) this.deps.logTiming(`brain: compacted greeting to ${wordCount(text)}w`);
        // If we have a prefetched audio buffer AND the text wasn't rewritten
        // by compactGreetingText (otherwise the audio doesn't match the
        // transcript), use the prefetched audio path — saves the EL round-trip.
        const canUsePrefetched =
          audioBuffer && !audioBuffer.failed && text === joke.text && this.deps.playPrefetchedAudio;
        if (canUsePrefetched) {
          this.deps.logTiming(
            `brain: greeting using prefetched audio (chunks=${audioBuffer.chunks.length} done=${audioBuffer.done})`,
          );
          this.deps.playPrefetchedAudio!(
            text,
            audioBuffer,
            joke.motion as import("@/lib/motionStates").MotionState,
            joke.intensity,
          );
        } else {
          this.deps.queueSpeak(text, joke.motion, joke.intensity);
        }
        this._addLedger("joke", text, response.tags ?? []);
        this.lastJokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
        this.lastJokeIntensity = joke.intensity;
      }
      this._preQueueNextQuestion();
      this.deps.setMotion("energetic", 0.8);
      this.greetingSpeechQueued = true;
      // If drain already fired while we were generating, advance now
      this._maybeAdvanceFromGreeting();
    };

    Promise.all([
      this.visionJokePrefetch,
      this.deps.prefetchedGreetingAudio ?? Promise.resolve(null),
    ]).then(([response, audioBuffer]) => {
      if (this.greetingFallbackSpoken) {
        this._handleLateGreeting(response);
        return;
      }
      queueGreeting(response, audioBuffer);
    });
    this.greetingVisionTimeout = setTimeout(() => {
      if (this.state !== "greeting" || this.greetingSpeechQueued) return;
      this.greetingFallbackSpoken = true;
      this.deps.logTiming("brain: greeting prefetch slow — speaking instant fallback, real greeting will chain");
      queueGreeting({
        relevant: true,
        jokes: [{
          motion: "energetic",
          intensity: 0.8,
          text: this._greetingFallbackLine(),
          score: 6,
        }],
      }, null);
    }, COMEDIAN_CONFIG.greetingVisionTimeoutMs);
  }

  /** Canned greeting line matched to the experience — Toast must never open in the roast voice. */
  private _greetingFallbackLine(): string {
    if (this._isToast()) {
      return TOAST_GREETINGS[Math.floor(Math.random() * TOAST_GREETINGS.length)];
    }
    return GREETING_FALLBACK;
  }

  /**
   * The instant canned fallback already played because the greeting prefetch missed
   * the timeout. Don't waste the real joke when it finally lands: chain it after the
   * fallback if we're still in greeting, otherwise drop it in the hopper so it gets
   * delivered after the current beat. (Toast has no hopper — discard there.)
   */
  private _handleLateGreeting(response: JokeResponse | null): void {
    if (!response || response.jokes.length === 0) return;
    const joke = response.jokes[0];
    const text = compactGreetingText(joke.text);
    const motion = joke.motion as import("@/lib/motionStates").MotionState;
    if (this.state === "greeting") {
      this.deps.logTiming("brain: late greeting arrived — chaining after fallback");
      this.deps.queueSpeak(text, joke.motion, joke.intensity);
      this._addLedger("joke", text, response.tags ?? []);
      this.lastJokeMotion = motion;
      this.lastJokeIntensity = joke.intensity;
      return;
    }
    if (this._isToast()) return;
    this.deps.logTiming("brain: late greeting arrived post-advance — adding to hopper");
    // Ledger entry happens at delivery time when the hopper joke is popped.
    this._addToHopper(text, motion, joke.intensity, joke.score ?? 8);
  }

  private _maybeAdvanceFromGreeting(): void {
    // Need both: generation resolved + TTS played through
    if (this.greetingSpeechQueued && this.greetingTtsDrained) {
      this.visionJokePrefetch = null;
      if (this.rapidFireOpenerIsNameAsk) {
        // The instant opener already asked the name — listen for it directly instead of
        // asking a separate name question.
        this.rapidFireOpenerIsNameAsk = false;
        this.enterWaitAnswer();
        return;
      }
      this.enterAskQuestion();
    }
  }

  private enterVisionJokes(): void {
    this._transition("vision_jokes");
    this.deps.setMotion("thinking", 0.6);
    const observations = this.deps.getObservations();

    // Use prefetched result if available, otherwise generate fresh
    const jokePromise = this.visionJokePrefetch ?? this._generateJoke({
      context: "vision_opening",
      observations,
      imageBase64: this.cameraAvailable ? this.deps.captureFrame() : undefined,
    });
    this.visionJokePrefetch = null;

    jokePromise.then((response) => {
      if (this.state !== "vision_jokes") return;
      if (!response || response.jokes.length === 0) {
        // No jokes — skip directly to questions rather than getting stuck
        this._transition("ask_question");
        this.enterAskQuestion();
        return;
      }
      for (const joke of response.jokes) {
        this.deps.queueSpeak(joke.text, joke.motion, joke.intensity);
        this._addLedger("joke", joke.text, response.tags ?? []);
        this.lastJokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
        this.lastJokeIntensity = joke.intensity;
      }
      // Clear hopper — vision-opening jokes must not replay as Q&A bonus jokes
      this.jokeHopper = [];
      this.previousObservations = [...observations];
    });
  }

  private enterAskQuestion(sameQuestion = false): void {
    if (this.pendingWrapup) {
      this.enterWrapup();
      return;
    }
    this._transition("ask_question");
    this.answerBuffer = "";
    this.earlyListenActivated = false;
    this.prodCount = 0;
    this.confirmAttempts = 0;
    this.deps.setUserAnswer("");

    // Determine which question to ask
    let question: ComedyQuestion | null = null;
    let shouldListenImmediately = false;
    let spokenQuestionText: string | null = null;
    let questionWillBeQueuedAsync = false;

    if (sameQuestion && this.currentQuestion) {
      // Re-ask same question (after redirect)
      this._clearPreQueue();
      this.deps.setMotion(this.lastJokeMotion, this.lastJokeIntensity);
      const text = this._pickQuestionText(this.currentQuestion);
      this.deps.queueSpeak(text, this.lastJokeMotion, this.lastJokeIntensity);
      spokenQuestionText = text;
    } else if (this.visionOnlyMode) {
      // Vision-only: no more questions, wait in check_vision for interesting changes
      this._transition("check_vision");
      this.deps.logTiming("brain: vision-only mode, waiting for interesting vision change");
      this.deps.setMotion("idle", 0.3);
      return;
    } else if (this.preQueuedQuestion) {
      // Pre-queued during joke delivery — consume it, no extra LLM round-trip
      question = this.preQueuedQuestion;
      const rephrased = this.preQueuedRephrasedText;
      this.preQueuedQuestion = null; // clear so stale rephrase callbacks bail out
      this.preQueuedRephrasedText = null;
      this.askedQuestionIds.add(question.id);
      this.currentQuestion = question;
      this.deps.setMotion(this.lastJokeMotion, this.lastJokeIntensity);
      if (rephrased) {
        this.deps.queueSpeak(rephrased, "emphasis", 0.6);
        this.deps.logTiming(`brain: using pre-queued rephrase — "${rephrased.slice(0, 60)}"`);
        spokenQuestionText = rephrased;
      } else {
        // Rephrase didn't resolve in time — fall back to original with bridge (no second fetch)
        const text = this._pickQuestionText(question);
        if (COMEDIAN_CONFIG.skipScriptedLines) {
          this.deps.queueSpeak(text, "emphasis", 0.6);
          spokenQuestionText = text;
        } else {
          spokenQuestionText = ComedianBrain._questionWithBridge(text);
          this.deps.queueSpeak(spokenQuestionText, "emphasis", 0.6);
        }
        this.deps.logTiming("brain: pre-queue rephrase not ready — using original");
      }
    } else {
      // Interleave bank questions with contextual/vision questions.
      // After every bank question, generate a contextual one (what do you do in that office?).
      // Rapid Fire skips contextual entirely — bank questions only, no LLM detour mid-game.
      const bankAvailable = this._nextValidQuestion();
      // Toast never detours to LLM-generated contextual questions — its 11-question
      // bank is the whole point, and generic contextual questions read as off-voice
      // ("not a good question for a toast"). Stay on the bank.
      // Dev experiment: when llmQuestions is on, generate EVERY question (after the
      // name) via the LLM instead of the bank — it's repeat-aware (knownFacts +
      // previousQuestions), which fixes "I said married, then she asked if I'm married".
      const useLlmQuestions = this.deps.getLlmQuestions?.() === true && this.askedQuestionIds.size >= 1;
      const shouldUseContextual =
        !this._isRapidFireFlow() &&
        !this._isToast() &&
        (useLlmQuestions || (this.bankQuestionsInARow >= 1 && this.cameraAvailable));

      if (bankAvailable && !shouldUseContextual) {
        // Use bank question
        question = bankAvailable;
        this.askedQuestionIds.add(question.id);
        this.currentQuestion = question;
        this.bankQuestionsInARow++;
        questionWillBeQueuedAsync = true;
        this._queueQuestionWithBridge(this._pickQuestionText(this.currentQuestion));
        // NOTE: per-answer speculative pre-gen (_fireExpectedJokesGen) is superseded by the
        // Rapid Fire burst cadence — answers are now roasted together in one burst, so a
        // per-question speculative joke would never be consumed. Left out intentionally.
      } else {
        // Generate a contextual question based on what we see + know
        this.bankQuestionsInARow = 0;
        this._generateContextualQuestion();
        return; // async — will set currentQuestion when it resolves
      }
    }

    if (!this.currentQuestion) return;

    if (!questionWillBeQueuedAsync) {
      const ledgerQuestion = spokenQuestionText ?? this.currentQuestion.question;
      this.deps.setCurrentQuestion(ledgerQuestion);
      this._addLedger("question", ledgerQuestion, []);
    }
    if (shouldListenImmediately) {
      this.enterWaitAnswer();
    }
  }

  private enterWaitAnswer(): void {
    this._transition("wait_answer");
    this.deps.setMotion("listening", 0.5);
    this.fillerFiredForAnswer = false;
    this.sttHadFinalSegment = false;

    // If user already spoke during ask_question, start silence timer (not prod timer)
    if (this.answerBuffer.trim()) {
      this.deps.logTiming(`brain: wait_answer with pre-buffered answer — "${this.answerBuffer}"`);
      if (
        !COMEDIAN_CONFIG.skipPreGeneration &&
        wordCount(this.answerBuffer) >= COMEDIAN_CONFIG.speculativeMinWords &&
        shouldStartSpeculative(this.answerBuffer)
      ) {
        this._transition("pre_generate");
        this._startSpeculative();
      }
      this._startAnswerSilenceTimer();
      return;
    }

    this._startAnswerTimers();
  }

  private _startAnswerTimers(): void {
    if (!this.micAvailable) {
      // Skip directly to check_vision after a short delay
      this.silenceTimer = setTimeout(() => {
        this.consecutiveSilentQuestions++;
        this._transition("check_vision");
        this.enterCheckVision();
      }, 1000);
      return;
    }
    this._startProdTimer();
  }

  private _startProdTimer(): void {
    this._clearTimers();
    this.silenceTimer = setTimeout(() => {
      if (this.state === "wait_answer" || this.state === "pre_generate") {
        this.enterProdding();
      }
    }, COMEDIAN_CONFIG.answerWaitMs);
  }

  private _startAnswerSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const silenceMs = this._answerNeedsMoreStt()
      ? Math.max(COMEDIAN_CONFIG.answerSilenceMs, COMEDIAN_CONFIG.unfinalizedAnswerSilenceMs ?? 1000)
      : COMEDIAN_CONFIG.answerSilenceMs;
    this.silenceTimer = setTimeout(() => {
      if (this.state === "wait_answer" || this.state === "pre_generate") {
        this._onAnswerComplete();
      }
    }, silenceMs);
  }

  /** Shorter silence window used after late-transcription bounces — STT is clearly ending. */
  private _startLateSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const silenceMs = this._answerNeedsMoreStt()
      ? Math.max(COMEDIAN_CONFIG.answerSilenceMs, 900)
      : Math.round(COMEDIAN_CONFIG.answerSilenceMs / 2);
    this.silenceTimer = setTimeout(() => {
      if (this.state === "wait_answer" || this.state === "pre_generate") {
        this._onAnswerComplete();
      }
    }, silenceMs);
  }

  private _answerNeedsMoreStt(): boolean {
    const answer = this.answerBuffer.trim();
    if (!answer || this.sttHadFinalSegment) return false;
    if (ComedianBrain._looksComplete(answer)) return false;
    const words = wordCount(answer);
    const firstWord = (answer.match(/[A-Za-z']+/)?.[0] ?? "").toLowerCase();
    const incompleteStarters = new Set([
      "i", "i'm", "im", "i've", "ive", "i'll", "ill", "my", "we", "we're", "were",
      "it", "it's", "its", "the", "a", "an", "to", "for", "with", "because", "uh", "um",
      // Demonstratives — "That's my X", "There's a Y", "These are Z" — almost
      // always lead into more content. Without these, "That's" by itself
      // committed at 300 ms silence and the brain fired a filler while the
      // user was just taking a breath before "my artwork".
      "that", "that's", "thats", "this", "this's", "those", "these",
      "there", "there's", "theres", "here", "here's", "heres",
    ]);
    if (words <= 2 && incompleteStarters.has(firstWord)) return true;
    // Any single word that isn't a yes/no/wave-off / complete-name response
    // is too thin to commit on. Wait for the user to finish the thought.
    if (words <= 1 && !this._isViableAnswer(answer)) return true;
    if (words <= 1 && this._isViableAnswer(answer)) return false;
    return words >= 2;
  }

  private enterProdding(): void {
    const q = this.currentQuestion;
    if (!q) return;
    if (COMEDIAN_CONFIG.skipScriptedLines) {
      // No canned prod — just count and eventually skip the question
      this._transition("prodding");
      this.prodCount++;
      if (this.prodCount >= COMEDIAN_CONFIG.maxProds) {
        this.consecutiveSilentQuestions++;
        if (this.consecutiveSilentQuestions >= COMEDIAN_CONFIG.silentQuestionsBeforeVisionMode) {
          this.visionOnlyMode = true;
        }
        this.enterCheckVision();
      } else {
        this._startProdTimer();
      }
      return;
    }
    const prodLine = q.prodLines[this.prodCount % q.prodLines.length];
    this._transition("prodding");
    this.deps.queueSpeak(prodLine, "conspiratorial", 0.5);
  }

  private _onAnswerComplete(): void {
    const answer = this.answerBuffer.trim();
    if (!answer) {
      this.enterProdding();
      return;
    }

    // STT often captures the puppet's last roast line (e.g. "you poor bastard" → user "Poor bastard.")
    // Never treat that as their answer — reject and re-ask like garbage transcript.
    if (this._answerEchoesRecentRoast(answer)) {
      this.deps.logTiming(`brain: reject echo of recent roast — "${answer}"`);
      this.answerBuffer = "";
      this.deps.setUserAnswer("");
      const line =
        ECHO_REJECTION_TEMPLATES[Math.floor(Math.random() * ECHO_REJECTION_TEMPLATES.length)];
      this.deps.queueSpeak(line, "conspiratorial", 0.55);
      this._cancelSpeculative();
      this._transition("ask_question");
      return;
    }

    // Confidence gate — reject garbage, confirm dubious, pass clean answers through.
    // Skip when scripted lines are disabled (no canned confirm/reject templates), and skip
    // entirely in Rapid Fire — confirmation prompts kill the quick tick-tock cadence; a
    // slightly-misheard answer just becomes a slightly-off burst joke, which is fine.
    if (
      COMEDIAN_CONFIG.confirmationEnabled &&
      !COMEDIAN_CONFIG.skipScriptedLines &&
      !this._isRapidFireFlow()
    ) {
      const qId = this.currentQuestion?.id ?? "";
      // Name confirmations are useful for short transcripts ("Mike"/"Mark"),
      // but long multi-word replies are usually intentional bits, not STT errors.
      if (qId === "name" && wordCount(answer) >= 3) {
        this.deps.logTiming(`brain: skip name confirmation for long answer — "${answer}"`);
        this.enterGenerating(answer);
        return;
      }
      const confidence = transcriptConfidence(answer, qId);
      const threshold = this.currentQuestion?.confirmThreshold ?? CONFIDENCE_THRESHOLDS.defaultConfirm;

      if (confidence < CONFIDENCE_THRESHOLDS.reject) {
        // Garbage — reject outright, ask again.
        // Use ask_question so onTtsQueueDrained → enterWaitAnswer() starts prod timers.
        this.deps.logTiming(`brain: reject transcript (confidence=${confidence.toFixed(2)}) — "${answer}"`);
        this.answerBuffer = "";
        this.deps.setUserAnswer("");
        const line = REJECT_TEMPLATES[Math.floor(Math.random() * REJECT_TEMPLATES.length)];
        this.deps.queueSpeak(line, "conspiratorial", 0.5);
        this._cancelSpeculative();
        this._transition("ask_question");
        return;
      }

      if (confidence < threshold) {
        // Low confidence — confirm before proceeding
        this.deps.logTiming(`brain: confirm transcript (confidence=${confidence.toFixed(2)}, threshold=${threshold}) — "${answer}"`);
        this._cancelSpeculative();
        this.enterConfirmAnswer(answer);
        return;
      }
    }

    this.enterGenerating(answer);
  }

  // ─── Answer confirmation ─────────────────────────────────────────────────────

  private enterConfirmAnswer(answer: string): void {
    this._transition("confirm_answer");
    const normalized = normalizeForConfirm(answer) || answer.trim();
    this.pendingConfirmAnswer = normalized;
    this.confirmBuffer = "";
    this.confirmAttempts++; // 1 = first attempt; at maxConfirmAttempts, proceeds without re-confirming
    this.deps.setMotion("conspiratorial", 0.6);

    // Echo what we think we heard, then a short absurdist “mis-hear” filler — no “did you say?”
    // Silence after both play (confirmTimeoutMs) = implicit yes and we roast the echoed answer.
    const templates = this.currentQuestion?.confirmTemplates ?? DEFAULT_CONFIRM_ECHO_TEMPLATES;
    const echoTemplate = templates[Math.floor(Math.random() * templates.length)];
    const echoAnswer = normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
    const echoLine = echoTemplate.replaceAll("{answer}", echoAnswer);
    const tail =
      CONFIRM_TAIL_FILLERS[Math.floor(Math.random() * CONFIRM_TAIL_FILLERS.length)];

    this.deps.queueSpeak(echoLine, "conspiratorial", 0.65);
    this.deps.queueSpeak(tail, "thinking", 0.55);
    this.deps.logTiming(
      `brain: confirm echo+t — "${echoLine.slice(0, 96)}" · "${tail}" (${this.confirmAttempts})`,
    );
  }

  /** Start listening timer after confirm prompt finishes playing. */
  private _startConfirmListenTimer(): void {
    this._clearConfirmTimer();
    // Silence after prompt = implicit yes (user didn't object)
    this.confirmTimer = setTimeout(() => {
      if (this.state !== "confirm_answer") return;
      this.deps.logTiming(`brain: confirm timeout (${COMEDIAN_CONFIG.confirmTimeoutMs}ms) — implicit yes for "${this.pendingConfirmAnswer}"`);
      this._confirmAccepted();
    }, COMEDIAN_CONFIG.confirmTimeoutMs);
  }

  /** Start short silence timer after user starts responding to confirmation. */
  private _startConfirmSilenceTimer(): void {
    this._clearConfirmTimer();
    this.confirmTimer = setTimeout(() => {
      if (this.state !== "confirm_answer") return;
      this._processConfirmResponse();
    }, COMEDIAN_CONFIG.confirmSilenceMs);
  }

  private _clearConfirmTimer(): void {
    if (this.confirmTimer) { clearTimeout(this.confirmTimer); this.confirmTimer = null; }
  }

  private _confirmAccepted(): void {
    this._clearConfirmTimer();
    this.confirmAttempts = 0;
    this.answerBuffer = this.pendingConfirmAnswer;
    this.deps.setUserAnswer(this.answerBuffer);
    this.deps.logTiming(`brain: confirmed — "${this.pendingConfirmAnswer}"`);
    this.enterGenerating(this.pendingConfirmAnswer);
  }

  private _processConfirmResponse(): void {
    const response = normalizeForConfirm(this.confirmBuffer);
    if (!response) {
      // No response heard — treat as implicit yes
      this._confirmAccepted();
      return;
    }

    const classification = ComedianBrain._classifyConfirmResponse(response);
    this.deps.logTiming(`brain: confirm response "${response}" → ${classification}`);

    switch (classification) {
      case "affirm":
        this._confirmAccepted();
        break;

      case "deny_correction": {
        // Extract corrected answer — strip leading negation
        const corrected = response.replace(/^(no+|nah|nope|wrong)[,.]?\s*/i, "").trim();
        // Strip common filler phrases before the actual answer
        const cleaned = normalizeForConfirm(
          corrected.replace(/^(it's|its|it is|i said|my name is|i'm|im|actually)\s+/i, "").trim()
        );
        if (!cleaned) {
          // They said "no" with filler but no actual correction — treat as bare deny
          this._confirmDenied();
          break;
        }
        if (this.confirmAttempts >= COMEDIAN_CONFIG.maxConfirmAttempts) {
          // Max attempts — proceed with the correction without re-confirming
          this.deps.logTiming(`brain: max confirm attempts — proceeding with "${cleaned}"`);
          this.pendingConfirmAnswer = cleaned;
          this._confirmAccepted();
        } else {
          // Re-confirm with the corrected answer
          this.enterConfirmAnswer(cleaned);
        }
        break;
      }

      case "deny_bare":
        this._confirmDenied();
        break;

      case "restate":
        // Streaming STT often arrives in fragments (", I love my" -> "name.").
        // If this still looks partial, wait for more chunks instead of re-confirming.
        if (!/[.?!]\s*$/.test(this.confirmBuffer.trim()) && wordCount(response) < 4) {
          this.deps.logTiming(`brain: confirm response looks partial — waiting for more ("${response}")`);
          this._startConfirmSilenceTimer();
          break;
        }
        // User restated their answer without saying no — treat as a new answer
        if (this.confirmAttempts >= COMEDIAN_CONFIG.maxConfirmAttempts) {
          this.deps.logTiming(`brain: max confirm attempts — proceeding with restatement "${response}"`);
          this.pendingConfirmAnswer = response;
          this._confirmAccepted();
        } else {
          this.enterConfirmAnswer(response);
        }
        break;
    }
  }

  private _confirmDenied(): void {
    this._clearConfirmTimer();
    this.confirmAttempts = 0;
    this.answerBuffer = "";
    this.deps.setUserAnswer("");
    this.deps.queueSpeak(CONFIRM_DENIED_LINE, "conspiratorial", 0.5);
    // Use ask_question so onTtsQueueDrained → enterWaitAnswer() starts prod timers
    this._transition("ask_question");
    this.deps.logTiming("brain: confirm denied — back to ask_question (will enter wait_answer on TTS drain)");
  }

  private static readonly AFFIRM_RE = /^(yes|yeah|yep|yup|correct|right|that's right|uh-huh|mhm|mm-?hm|sure|exactly)/i;
  private static readonly DENY_RE = /^(nope|nah|no+|wrong)/i;

  static _classifyConfirmResponse(text: string): "affirm" | "deny_correction" | "deny_bare" | "restate" {
    const trimmed = text.trim();
    if (ComedianBrain.AFFIRM_RE.test(trimmed)) return "affirm";
    if (ComedianBrain.DENY_RE.test(trimmed)) {
      // Check if there are additional words after the negation (= correction)
      const afterNegation = trimmed.replace(ComedianBrain.DENY_RE, "").replace(/^[,.\s]+/, "").trim();
      return afterNegation.length > 0 ? "deny_correction" : "deny_bare";
    }
    return "restate";
  }

  // Filler reaction lines (NONWORD_FILLERS / ECHO_FILLER_TEMPLATES / ECHO_FILLER_PROBABILITY)
  // live in src/lib/scriptLines.ts — edit them there.

  // Meta-complaints about the comedian's own behavior — never echo these.
  // Echoing "You keep asking about the posters." back as "...you say." reads as broken/glitchy.
  private static readonly META_COMPLAINT_RE =
    /\byou\s+(already|keep|just|always|literally|kept)\b|\byou\s+(asked|ask|said|told|repeated)\b/i;

  /** Profanity/vulgar phrases — never echo. The puppet reading these back lands as
   *  awkward parroting and ElevenLabs renders strong language with harsh prosody. */
  private static readonly VULGAR_RE = /\b(fuck|shit|cunt|cock|dick|pussy|asshole|bitch|bastard|jerk\s*off|jack\s*off|wank|piss)\w*/i;

  /** True if the answer is short enough and complete enough to repeat as a filler.
   *  Capped at 4 words — anything longer reads as the puppet reciting the answer,
   *  not as a brief "I heard you" filler. */
  private _isFillerEchoable(answer: string): boolean {
    const trimmed = answer.trim();
    const w = wordCount(trimmed);
    if (w < 1 || w > 4) return false;
    if (ComedianBrain.VULGAR_RE.test(trimmed)) return false;
    if (this._answerEchoesRecentRoast(trimmed)) return false;
    if (ComedianBrain.META_COMPLAINT_RE.test(trimmed)) return false;

    // Reject answers ending mid-thought (preposition/conjunction/article/aux verb).
    // These are the half-sentences that read as "you can't finish a sentence" if echoed.
    // Strip terminal punctuation first so "I work in." is judged on "in", not on "in.".
    const stripped = trimmed.replace(/[.?!,]+$/, "").trim();
    const lastWord = lastWordToken(stripped).toLowerCase();
    const danglers = new Set([
      "and", "but", "or", "so", "the", "a", "an", "to", "of", "in", "on", "at",
      "with", "for", "from", "by", "is", "was", "be", "im", "ive", "ill",
    ]);
    if (danglers.has(lastWord)) return false;

    // Sentence-ended → safe to echo.
    if (/[.?!]$/.test(trimmed)) return true;

    // Short viable answers (names, ages, "single", short jobs).
    if (this._isViableAnswer(trimmed)) return true;

    // Otherwise the answer is unpunctuated AND not obviously a complete viable answer
    // (e.g. a 2-word fragment like "yeah dude" mid-thought). Skip the echo and let the
    // non-word filler take over.
    return false;
  }

  /** Strip leading hesitations ("Uh,", "Um,", "So,") so the echo doesn't mock the user's filler. */
  private static _stripLeadingHesitation(text: string): string {
    return text.replace(/^(uh+|um+|er+|ah+|so|like|well|okay|oh)\s*[,.]?\s*/i, "").trim();
  }

  private _pickFiller(answer: string): string {
    // Toast skips echo fillers entirely — she's interrupting herself, not
    // listening attentively. Always uses drunk-thinking non-word fillers.
    if (this._isToast()) {
      return TOAST_FILLER_LINES[
        Math.floor(Math.random() * TOAST_FILLER_LINES.length)
      ];
    }
    if (this._isFillerEchoable(answer) && Math.random() < ECHO_FILLER_PROBABILITY) {
      const cleaned = ComedianBrain._stripLeadingHesitation(
        answer.trim().replace(/[.?!,]+$/, "").trim(),
      );
      // If stripping left us with too little to echo, fall back to non-word filler.
      if (wordCount(cleaned) < 1) {
        return NONWORD_FILLERS[Math.floor(Math.random() * NONWORD_FILLERS.length)];
      }
      const tpl = ECHO_FILLER_TEMPLATES[
        Math.floor(Math.random() * ECHO_FILLER_TEMPLATES.length)
      ];
      return tpl.replaceAll("{answer}", cleaned);
    }
    return NONWORD_FILLERS[Math.floor(Math.random() * NONWORD_FILLERS.length)];
  }

  /** Pick a non-word filler avoiding the last one to prevent immediate repeats. */
  private _pickNonWordFiller(avoid: string | null): string {
    const pool0 = this._isToast() ? TOAST_FILLER_LINES : NONWORD_FILLERS;
    const opts = pool0.filter((f) => f !== avoid);
    const pool = opts.length > 0 ? opts : pool0;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Stop the pump immediately. Returns whether at least one filler was queued. */
  private _stopFillerPump(): { fillerQueued: boolean } {
    const queued = this.fillerLineCount > 0;
    this.fillerPumpActive = false;
    // Cancel a pending breath so it can't queue a stray filler on top of the joke.
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = null; }
    return { fillerQueued: queued };
  }

  /**
   * Arm the generation watchdog for a fresh joke-generation request. Creates a new
   * AbortController (passed to the generate-speak fetch) and a timer that, if it fires
   * while we're still stuck in "generating" (no joke ever streamed), aborts the hung
   * request and delivers a canned fallback roast so the show never dead-airs.
   */
  private _armGenerationWatchdog(_answer: string): void {
    this._clearGenerationWatchdog();
    // Abort the PREVIOUS in-flight fetch before stomping the ref. Without this,
    // a barge-in restart leaves the prior generate-speak stream running — its
    // SSE chunks keep calling openJokeStream() into the playback chain and
    // motion events arrive seconds after the fallback already played.
    try { this.generationAbort?.abort(); } catch { /* best-effort */ }
    this.generationAbort = new AbortController();
    this.generationWatchdog = setTimeout(() => {
      this.generationWatchdog = null;
      // If a joke arrived we've already left "generating" — nothing to rescue.
      if (this.state !== "generating") return;
      this.deps.logTiming(
        `brain: generation watchdog fired (${COMEDIAN_CONFIG.generationTimeoutMs}ms) — graceful exit`,
      );
      // Cancel the hung fetch so a late response can't double-fire on top of the goodbye.
      try { this.generationAbort?.abort(); } catch { /* best-effort */ }
      this.generationAbort = null;
      // Invalidate any in-flight stream callbacks (they check deliveryGeneration).
      this.deliveryGeneration++;
      this._stopFillerPump();
      // Speak a persona-flavored "technical difficulties" line and end the session.
      // Previously this delivered a canned fallback roast and kept going, which
      // led to multiple watchdog fires per session (each = ~10s of fillers + a
      // generic line) when the LLM was actually broken.
      this._enterTechnicalDifficultiesExit();
    }, COMEDIAN_CONFIG.generationTimeoutMs);
  }

  /**
   * Watchdog-triggered graceful exit. Speaks a persona-flavored
   * technical-difficulties line and routes through the wrapup state so
   * the existing drain handler fires onSessionEnd. Skips the LLM closing-line
   * call (that's what just failed) — uses a canned line directly.
   */
  private _enterTechnicalDifficultiesExit(): void {
    // Cancel anything that could still queue audio after us.
    this._clearTimers();
    this._cancelSpeculative();
    this._cancelExpectedJokesGen();
    this._cancelHopper();
    this._cancelPipelinePrefetch();
    this._cancelRephrase();
    this.preQueuedQuestion = null;
    this.preQueuedRephrasedText = null;
    this.pipelinePrefetch = null;
    this.pendingWrapup = false;

    this._transition("wrapup");
    this.deps.setMotion("conspiratorial", 0.7);

    // Toast has her own drunk-apologetic exit lines that DON'T branch on
    // persona (Toast is one character). Roast uses the per-persona table.
    const lines = this._isToast()
      ? TOAST_TECHNICAL_DIFFICULTIES_LINES
      : TECHNICAL_DIFFICULTIES_LINES[this.deps.getPersona()] ??
        TECHNICAL_DIFFICULTIES_LINES.kvetch;
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.deps.logTiming(`brain: technical-difficulties exit — "${line.slice(0, 60)}"`);
    this.deps.queueSpeak(line, "conspiratorial", 0.7);
    this._addLedger("joke", line, []);
    // Flip the gate so the next wrapup drain event fires session end.
    this.wrapupClosingQueued = true;
  }

  /** Clear the generation watchdog timer (joke arrived, state left generating, or stop). */
  private _clearGenerationWatchdog(): void {
    if (this.generationWatchdog) {
      clearTimeout(this.generationWatchdog);
      this.generationWatchdog = null;
    }
  }

  /**
   * Schedule the next filler in the pump. We wait COMEDIAN_CONFIG.fillerBreathMs of real
   * silence (the breath beat we used to get from a leading "..."), then queue the filler audio.
   * Bails up front if the pump was stopped, we're no longer generating, or we've hit the cap;
   * the deferred callback re-checks those guards in case the joke arrived during the breath.
   */
  private _queueNextPumpFiller(): void {
    if (!this.fillerPumpActive) return;
    if (this.state !== "generating") return;
    if (this.fillerLineCount >= COMEDIAN_CONFIG.fillerMaxStack) {
      this.fillerPumpActive = false;
      this.deps.logTiming(`brain: filler pump stopped at max (${COMEDIAN_CONFIG.fillerMaxStack})`);
      return;
    }
    // First filler can echo the answer; subsequent stacked fillers stay non-word so we don't
    // repeat the same echo phrase or sound like a broken record.
    const isFirst = this.fillerLineCount === 0;
    const filler = isFirst
      ? this._pickFiller(this.fillerAnswerForPump)
      : this._pickNonWordFiller(this.fillerLastText);
    // Body animation reflects the inferred reaction immediately; the breath happens before voice.
    this.deps.setMotion(this.fillerMotion, this.fillerIntensity);
    // Add the breath ourselves: fillerBreathMs of silence, THEN queue the audio. We DON'T bake
    // a leading "..." into the text anymore — EL rendered it flatly and spiked the attack on the
    // word after it. The bookkeeping (count / lastText) only advances once the audio is actually
    // queued, so a joke arriving mid-breath leaves the counters consistent.
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      if (!this.fillerPumpActive || this.state !== "generating") return;
      if (isFirst) this.fillerFirstText = filler;
      this.fillerLastText = filler;
      this.fillerLineCount++;
      // INTONATION CONTINUITY: thread the prior delivery's motion through to the
      // filler voice instead of a fixed FILLER_VOICE_MOTION constant. The filler
      // sits between the question (or prior joke) and the upcoming joke — locking
      // it to "energetic" made it jump moods. Now: filler reads as a damped echo
      // of the last joke's vibe ("she's still in smug-mode, still thinking it
      // through"). Damped intensity (× 0.6) keeps the filler quieter than the
      // joke that spawned it. Falls back to "thinking" on the first cycle of the
      // session — measured, not expressive — since lastJokeMotion is empty then.
      const fillerVoiceMotion = (this.lastJokeMotion ?? "thinking") as import("@/lib/motionStates").MotionState;
      const fillerVoiceIntensity = Math.max(0.3, (this.lastJokeIntensity ?? 0.7) * 0.6);
      // STABILITY CLAMP: motion deltas push stability DOWN (more expressive).
      // Toast's base voice already runs at stability 0.4 — adding a smug delta
      // (-0.15) drops it to 0.27, and short fillers like "Mm-hm, mm-HM" warble
      // at that level. The voiceOverride wins last; pin stability to 0.65 so
      // fillers stay LEGIBLE while still inheriting the prior joke's style/speed
      // direction. Speed override 0.7 stays for the unhurried "thinking-out-loud"
      // beat; joke that follows returns to base speed for the punchline pop.
      this.deps.queueSpeak(filler, fillerVoiceMotion, fillerVoiceIntensity, false, {
        speed: 0.7,
        stability: 0.65,
      });
      this.deps.logTiming(
        `brain: filler[${this.fillerLineCount}] (voice=${fillerVoiceMotion}@${fillerVoiceIntensity.toFixed(2)}, body=${this.fillerMotion}, speed=0.7, stability=0.65) — "${filler}"`,
      );
    }, COMEDIAN_CONFIG.fillerBreathMs);
    // The next filler is scheduled when the queue drains (see onTtsQueueDrained "generating").
  }

  private _removeEchoedAnswerLead(text: string, answer: string, fillerAlreadySaid?: string): string {
    const cleanedAnswer = ComedianBrain._stripLeadingHesitation(
      answer.trim().replace(/[.?!,]+$/, "").trim(),
    );
    if (!cleanedAnswer || wordCount(cleanedAnswer) > 8) return text;

    const filler = fillerAlreadySaid?.toLowerCase() ?? "";
    if (filler && !filler.includes(cleanedAnswer.toLowerCase())) return text;

    const escaped = cleanedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = text.replace(new RegExp(`^\\s*${escaped}\\s*[,.!?:;\\-]*\\s+`, "i"), "").trim();
    return wordCount(stripped) >= 3 ? stripped : text;
  }

  private enterGenerating(answer: string): void {
    // Rapid Fire: don't joke on every answer. Accumulate answers across a few quick
    // questions (each gets only a one-word ack), then fire ONE joke burst tying them
    // together. _handleRapidFireAnswer either ack's + advances (returns), or — when the
    // burst is full — calls _enterRapidFireBurst() to generate the combined roast.
    if (this._isRapidFireFlow()) {
      this._handleRapidFireAnswer(answer);
      return;
    }

    this._transition("generating");
    this.deliveryGeneration++;
    this.deps.setMotion("thinking", 0.7);
    this._addLedger("answer", answer, []);

    // Rapid Fire fast path: if speculative pre-gen has produced jokes for
    // this question's expected answers, fuzzy-match the user's answer and
    // deliver the cached pair instantly. No filler, no fresh LLM round-trip.
    // Falls through silently when:
    //   - flow is "original" (cache is never populated)
    //   - question has no expectedAnswers (e.g., "name")
    //   - speculative request hasn't resolved yet
    //   - user's answer doesn't fuzzy-match any expected key
    const cachedJokes = this._tryConsumeExpectedJokes(answer);
    if (cachedJokes) {
      this.enterDelivering(answer, { relevant: true, jokes: cachedJokes }, undefined);
      return;
    }

    // Arm the generation watchdog — fresh request, fresh abort controller. Cancelled the
    // moment the first joke arrives (we leave "generating"); fires the fallback if not.
    this._armGenerationWatchdog(answer);

    // Start the filler pump — keeps audio flowing while the LLM generates so there's no dead
    // pause. _queueNextPumpFiller waits COMEDIAN_CONFIG.fillerBreathMs of silence (the breath
    // beat), then queues each filler; the next breath is scheduled on each drain event. The
    // pre-react beat and inter-filler gaps both come from that timer. Pump stops when the first
    // joke arrives.
    let fillerAlreadySaid: string | undefined;
    if (!COMEDIAN_CONFIG.skipFiller && !this.fillerFiredForAnswer) {
      this.fillerFiredForAnswer = true;
      this.fillerAnswerForPump = answer;
      this.fillerLineCount = 0;
      this.fillerLastText = null;
      this.fillerFirstText = null;
      this.fillerPumpActive = true;
      // Infer puppet's reaction motion once from the answer — drives ALL fillers in the
      // stack so the puppet's body language matches how it's processing what was said
      // (smug at an insult, conspiratorial at a short factual answer, etc.).
      [this.fillerMotion, this.fillerIntensity] = inferFillerMotionFromAnswer(answer);
      // LLM context — keep generic; the exact filler word doesn't matter for joke prompting.
      fillerAlreadySaid = "filler sound";
      this._queueNextPumpFiller();
    }

    const q = this.currentQuestion;
    const conversationSoFar = this._getLedgerContext();

    // Check if speculative result is still usable
    const spec = this.speculativeRequest;
    if (spec && isSimilarAnswer(spec.snapshot, answer)) {
      this.deps.logTiming(`brain: reusing speculative (snapshot="${spec.snapshot.slice(0, 30)}")`);
      // Reuse speculative result — but fall back to fresh if it returned empty
      spec.result.then((response) => {
        if (this.state !== "generating") return;
        this._speculativeRequest = null;
        if (response && response.jokes.length > 0) {
          this.enterDelivering(answer, response, fillerAlreadySaid);
        } else {
          // Speculative returned empty — generate fresh
          this.deps.logTiming("brain: speculative returned empty, generating fresh");
          this._generateAndDeliver(answer, q, conversationSoFar, fillerAlreadySaid);
        }
      }).catch(() => {
        // Speculative failed — generate fresh
        if (this.state !== "generating") return;
        this._generateAndDeliver(answer, q, conversationSoFar, fillerAlreadySaid);
      });
      this._cancelSpeculative(); // clear the ref (result promise still resolves)
    } else {
      // Cancel stale speculative, generate fresh
      this._cancelSpeculative();
      this._generateAndDeliver(answer, q, conversationSoFar, fillerAlreadySaid);
    }
  }

  /**
   * Rapid Fire answer handler. Pushes the answer onto the burst accumulator, then either:
   *   - acks quickly and advances to the NEXT question (burst not full, questions remain), or
   *   - fires the combined joke burst (burst full, or no more bank questions).
   * This is what gives Rapid Fire its distinct "quick questions → burst" cadence.
   */
  private _handleRapidFireAnswer(answer: string): void {
    const question = this.currentQuestion?.question ?? "";
    // Capture the name from the opener answer so later questions can use it.
    if (this.currentQuestion?.id === "name" && !this.knownName) {
      const name = ComedianBrain._extractName(answer);
      if (name) {
        this.knownName = name;
        this.deps.logTiming(`brain: rapid fire captured name "${name}"`);
      }
    }
    this.rapidFireBurst.push({ question, answer });
    this._addLedger("answer", answer, []);

    const burstSize = COMEDIAN_CONFIG.rapidFireBurstSize;
    const burstFull = this.rapidFireBurst.length >= burstSize;
    const burstReady = burstFull || !this._hasMoreBankQuestions() || this.pendingWrapup;

    if (!burstReady) {
      // Quick ack, then straight to the next question — the rapid tick-tock.
      const ack = RAPID_FIRE_ACKS[
        Math.floor(Math.random() * RAPID_FIRE_ACKS.length)
      ];
      this.deps.setMotion("energetic", 0.5);
      this.deps.queueSpeak(ack, "energetic", 0.5);
      this.deps.logTiming(
        `brain: rapid fire ack "${ack}" — burst ${this.rapidFireBurst.length}/${burstSize}, next Q`,
      );
      // enterAskQuestion queues the next question right behind the ack on the TTS chain;
      // both drain together → wait_answer.
      this.enterAskQuestion();
      return;
    }

    this._enterRapidFireBurst();
  }

  /**
   * Generate ONE joke burst that ties together every answer in the current Rapid Fire
   * accumulator, then clear it for the next burst. Reuses the standard generation
   * machinery (filler pump, watchdog, streaming TTS) via _generateAndDeliver — it just
   * feeds a combined recap as the "answer" so the LLM roasts the whole set at once.
   */
  private _enterRapidFireBurst(): void {
    const burst = this.rapidFireBurst;
    this.rapidFireBurst = []; // reset for the next burst (captured in `burst`)

    this._transition("generating");
    this.deliveryGeneration++;
    this.deps.setMotion("thinking", 0.7);

    // Combined recap, e.g. "Who am I talking to: Tyler; Single: Nope; Cats or dogs: Dogs".
    // Passed as USER'S ANSWER so the answer_roast prompt roasts the whole combination.
    const combinedAnswer = burst
      .map((b) => `${b.question.replace(/[?]+$/, "")}: ${b.answer}`)
      .join("; ");

    this._armGenerationWatchdog(combinedAnswer);

    // Filler while the burst generates — same mechanism as the normal path.
    let fillerAlreadySaid: string | undefined;
    if (!COMEDIAN_CONFIG.skipFiller) {
      this.fillerFiredForAnswer = true;
      this.fillerAnswerForPump = combinedAnswer;
      this.fillerLineCount = 0;
      this.fillerLastText = null;
      this.fillerFirstText = null;
      this.fillerPumpActive = true;
      [this.fillerMotion, this.fillerIntensity] = inferFillerMotionFromAnswer(
        burst.at(-1)?.answer ?? combinedAnswer,
      );
      fillerAlreadySaid = "filler sound";
      this._queueNextPumpFiller();
    }

    this.deps.logTiming(`brain: rapid fire burst (${burst.length} answers) — generating`);
    // q = null: no single "QUESTION ASKED" — the combined recap carries all the context.
    this._generateAndDeliver(combinedAnswer, null, this._getLedgerContext(), fillerAlreadySaid);
  }

  /** Pull a usable first name out of a freeform answer ("My name's Tyler" → "Tyler").
   *  Returns null if nothing name-shaped is found. */
  private static _extractName(answer: string): string | null {
    let s = answer.trim().replace(/[.?!,]+$/g, "").trim();
    s = s.replace(
      /^(my name'?s?\s+is\s+|my name'?s\s+|i'?m\s+|i am\s+|it'?s\s+|this is\s+|name'?s\s+|the name'?s\s+|call me\s+)/i,
      "",
    ).trim();
    if (!s) return null;
    const first = s.split(/\s+/)[0];
    const name = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    // Must start with a letter, only letters + a stray apostrophe/hyphen, 2-20 chars...
    if (!/^[A-Za-z][A-Za-z'’-]{1,19}$/.test(name)) return null;
    // ...and contain at least 2 actual letters (rejects "O'" / "A-" / punctuation runs).
    if (name.replace(/[^A-Za-z]/g, "").length < 2) return null;
    return name;
  }

  /** Rapid Fire: occasionally personalize a question with the user's name
   *  ("Are you single?" → "Are you single, Tyler?"). No-op until the name is known. */
  private _maybeInjectName(text: string): string {
    const name = this.knownName;
    if (!name) return text;
    if (Math.random() > COMEDIAN_CONFIG.rapidFireNameInjectionChance) return text;
    if (text.toLowerCase().includes(name.toLowerCase())) return text;
    if (/\?\s*$/.test(text)) return text.replace(/\s*\?+\s*$/, `, ${name}?`);
    if (/[.!]\s*$/.test(text)) return text.replace(/\s*[.!]+\s*$/, `, ${name}.`);
    return `${text}, ${name}`;
  }

  /** Non-mutating check: are there bank questions left to ask? Mirrors _nextValidQuestion's
   *  skip rules (already-asked, location-known, excluded) WITHOUT advancing questionIndex. */
  private _hasMoreBankQuestions(): boolean {
    const ambientCity = this.deps.getAmbientContext()?.city;
    const hasLocation = !!ambientCity && ambientCity !== "unknown";
    const excluded = this.shuffledQuestions
      .filter((prev) => this.askedQuestionIds.has(prev.id) && prev.excludes)
      .flatMap((prev) => prev.excludes!);
    return this.shuffledQuestions.some(
      (q) =>
        !this.askedQuestionIds.has(q.id) &&
        !(hasLocation && ComedianBrain.LOCATION_QUESTION_IDS.has(q.id)) &&
        !excluded.includes(q.id),
    );
  }

  // Workaround: TypeScript doesn't allow assigning to private field via underscore alias
  private set _speculativeRequest(v: typeof this.speculativeRequest) {
    this.speculativeRequest = v;
  }

  private _generateAndDeliver(
    answer: string,
    q: ComedyQuestion | null,
    conversationSoFar: string[],
    fillerAlreadySaid?: string,
  ): void {
    let jokesQueued = 0;
    let metaHandled = false;
    const gen = this.deliveryGeneration; // snapshot — stale callbacks check this

    // Track answer for single-joke pipeline
    if (COMEDIAN_CONFIG.singleJokeMode) {
      this.pipelineAnswer = answer;
      this.pipelineJokesDelivered = 0;
      this.pipelinePreviousJokes = [];
    }

    this._generateJokeStream(
      {
        context: "answer_roast",
        question: q?.question,
        userAnswer: answer,
        fillerAlreadySaid,
        jokesAlreadyDelivered: this._getDeliveredJokeTexts(),
        conversationSoFar,
        knownFacts: this._getThrowbackContext(),
        maxJokes: COMEDIAN_CONFIG.singleJokeMode ? 1 : undefined,
      },
      // onJoke — fires immediately as each joke streams in
      (joke) => {
        if (this.deliveryGeneration !== gen) return; // stale stream — ignore
        if (this.state !== "generating" && this.state !== "delivering") return;
        const isFirstJoke = jokesQueued === 0;
        if (isFirstJoke) {
          // Stop the filler pump; any in-flight filler audio finishes naturally on the TTS
          // chain. _stopFillerPump also cancels a pending breath (pumpTimer) so no further
          // filler queues ahead of the joke. The joke text itself stays unmodified.
          this._stopFillerPump();
          // Retarget puppet body language to anticipate the joke's mood while the last
          // filler audio is still draining. The motion-inferred-from-user-answer pose
          // (smug/conspiratorial/etc.) was a reaction to the user; this swaps to the
          // mood the comedian is about to deliver in, which feels more "alive".
          const jokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
          this.deps.setMotion(jokeMotion, joke.intensity);
        }
        if (this.state === "generating") {
          this._transition("delivering");
        }
        // Strip echoed answer using the actual first filler text (the pump's echo), not the
        // generic "filler sound" sentinel passed to the LLM.
        const echoFiller = this.fillerFirstText ?? fillerAlreadySaid;
        const jokeText = this._removeEchoedAnswerLead(joke.text, answer, echoFiller);
        const deliveredJoke = jokeText === joke.text ? joke : { ...joke, text: jokeText };
        // Streamed jokes after the first in this batch append to the same transcript paragraph
        const appendToPrev = jokesQueued > 0;
        // Streaming-TTS path: audio is already in flight via the server's EL WS,
        // and the brain's SSE handler already finalized the sink with this text.
        // Skip the legacy TTS fetch in that case.
        const streamingTtsActive = !!this.deps.openJokeStream;
        if (!streamingTtsActive) {
          this.deps.queueSpeak(
            deliveredJoke.text,
            deliveredJoke.motion as import("@/lib/motionStates").MotionState,
            deliveredJoke.intensity,
            appendToPrev,
          );
        }
        if (COMEDIAN_CONFIG.singleJokeMode) this.pipelinePreviousJokes.push(deliveredJoke.text);

        this._addLedger("joke", deliveredJoke.text, []);
        this.deps.logTiming(`brain: joke[${jokesQueued}] — "${deliveredJoke.text.slice(0, 60)}"`);
        this.lastJokeMotion = deliveredJoke.motion as import("@/lib/motionStates").MotionState;
        this.lastJokeIntensity = deliveredJoke.intensity;
        jokesQueued++;
      },
      // onMeta — fires after all jokes stream, with redirect/tags/callback/relevance
      (meta) => {
        if (this.deliveryGeneration !== gen) return; // stale stream — ignore
        if (this.state !== "generating" && this.state !== "delivering") return;
        metaHandled = true;
        this.deps.logTiming(`brain: api meta — relevant=${meta.relevant} jokes=${jokesQueued} redirect=${!!meta.redirect}`);

        if (!meta.relevant && meta.redirect) {
          if (jokesQueued > 0) {
            // A joke already streamed and is playing — don't queue the redirect on top of it.
            // The joke addressed the irrelevancy; let it finish and advance normally.
            this.deps.logTiming("brain: irrelevant but joke already delivered — advancing (no redirect)");
            return;
          }
          // No joke played yet — redirect immediately
          if (this.state === "generating") {
            this._transition("delivering");
            this.deps.setMotion("energetic", 0.8);
          }
          this.deps.queueSpeak(meta.redirect, "smug", 0.7);
          this._addLedger("joke", meta.redirect, []);
          this._transition("redirecting");
          return;
        }

        // Ensure we're in delivering state (no jokes may have arrived if API was fast)
        if (this.state === "generating") {
          this._transition("delivering");
          this.deps.setMotion("energetic", 0.8);
        }

        if (meta.tags?.length) this._addLedger("answer", answer, meta.tags);

        if (meta.callback) {
          this.deps.queueSpeak(
            meta.callback.text,
            meta.callback.motion as import("@/lib/motionStates").MotionState,
            meta.callback.intensity,
            jokesQueued > 0, // append to the streaming-jokes paragraph if any landed first
          );
          this._addLedger("joke", meta.callback.text, []);
          jokesQueued++;
        }

        if (jokesQueued === 0) {
          // Streaming JSON parsing can miss jokes from providers that emit awkward
          // chunk boundaries. Do a blocking JSON fallback before giving up.
          this.deps.logTiming("brain: stream delivered nothing - retrying non-streaming roast");
          this._generateJoke({
            context: "answer_roast",
            question: q?.question,
            userAnswer: answer,
            fillerAlreadySaid,
            conversationSoFar,
            knownFacts: this._getThrowbackContext(),
          }).then((response) => {
            if (this.deliveryGeneration !== gen) return;
            if (this.state !== "generating" && this.state !== "delivering") return;
            this.enterDelivering(answer, response ?? { relevant: true, jokes: [] }, fillerAlreadySaid);
          });
          return;
        }

        // Bonus hopper joke is intentionally NOT fired here — the streaming API already
        // returns 1-2 jokes per answer (jokesPerAnswer.max=2). Adding a third joke pads
        // the paragraph and delays the next question. The hopper still feeds vision_react
        // and silence-fallback paths.

        this._fireHopperGeneration("answer", undefined, answer);

        // Speculatively prefetch next pipeline joke while current TTS plays
        this._prefetchPipelineJoke();

        // Pre-queue next question (rephrase / contextual fetch) while jokes play.
        // No-op when pipelining single jokes — _pipelineNextJoke handles its own pacing.
        if (!COMEDIAN_CONFIG.singleJokeMode) {
          this._preQueueNextQuestion();
        }
      },
      // onError — stream failed, fall back to non-streaming
      () => {
        if (this.deliveryGeneration !== gen) return; // stale stream
        if (metaHandled) return;
        if (this.state !== "generating") return;
        this.deps.logTiming("brain: stream failed, generating fresh");
        this._generateJoke({
          context: "answer_roast",
          question: q?.question,
          userAnswer: answer,
          fillerAlreadySaid,
          conversationSoFar,
        }).then((response) => {
          if (this.state !== "generating") return;
          this.enterDelivering(answer, response ?? { relevant: true, jokes: [] }, fillerAlreadySaid);
        });
      },
      this.generationAbort?.signal,
      gen,
    );
  }

  private enterDelivering(answer: string, response: JokeResponse, fillerAlreadySaid?: string): void {
    this._transition("delivering");
    this.deps.setMotion("energetic", 0.8);

    if (!response.relevant && response.redirect) {
      // Irrelevant answer — play redirect and re-ask
      this.deps.queueSpeak(response.redirect, "smug", 0.7);
      this._addLedger("joke", response.redirect, []);
      this._transition("redirecting");
      return;
    }

    // Log tags to ledger
    if (response.tags?.length) {
      this._addLedger("answer", answer, response.tags);
    }

    let queued = 0;

    // Check for a callback
    if (response.callback) {
      this.deps.queueSpeak(response.callback.text, response.callback.motion, response.callback.intensity);
      this._addLedger("joke", response.callback.text, []);
      queued++;
    }

    // Queue all jokes — same delivery batch renders as a single transcript paragraph
    for (const joke of response.jokes) {
      const jokeText = this._removeEchoedAnswerLead(joke.text, answer, fillerAlreadySaid);
      this.deps.queueSpeak(jokeText, joke.motion, joke.intensity, queued > 0);
      this._addLedger("joke", jokeText, []);
      queued++;
    }

    // Nothing was queued — typically an upstream LLM failure (missing API key,
    // quota, malformed JSON). Drop in a canned beat so the puppet doesn't
    // silently bounce to the next question while the user is waiting for a roast.
    // Skip the fallback only when the API explicitly flagged the answer irrelevant
    // (the redirect path above will have already handled or chosen to advance).
    if (queued === 0) {
      if (response.relevant === false) {
        this.deps.logTiming("brain: enterDelivering with nothing to say — advancing");
        this._onDeliveringDrained();
        return;
      }
      const fallback = this._pickFallbackRoast(answer);
      this.deps.logTiming(`brain: enterDelivering empty — fallback "${fallback.text.slice(0, 60)}"`);
      this.deps.queueSpeak(fallback.text, fallback.motion as MotionState, fallback.intensity);
      this._addLedger("joke", fallback.text, []);
      return;
    }

    // Bonus hopper joke intentionally suppressed — see _generateAndDeliver onMeta for rationale.

    // Feed hopper with this context
    this._fireHopperGeneration("answer", undefined, answer);

    // Pre-queue next question while jokes play (no-op in singleJokeMode pipeline path)
    if (!COMEDIAN_CONFIG.singleJokeMode) {
      this._preQueueNextQuestion();
    }
  }

  private _onDeliveringDrained(): void {
    this.transitionCount++;

    // Wrapup pending — abort pipeline and route straight to closing line
    if (this.pendingWrapup) {
      this.pipelineAnswer = null;
      this._cancelPipelinePrefetch();
      this.enterWrapup();
      return;
    }

    // Single-joke pipeline: generate the next joke while delivering
    if (COMEDIAN_CONFIG.singleJokeMode && this.pipelineAnswer) {
      this.pipelineJokesDelivered++;
      const maxJokesPerAnswer = COMEDIAN_CONFIG.jokesPerAnswer.max;
      if (this.pipelineJokesDelivered < maxJokesPerAnswer) {
        this.deps.logTiming(`brain: pipeline next joke (${this.pipelineJokesDelivered + 1}/${maxJokesPerAnswer})`);
        this._pipelineNextJoke();
        return;
      }
      // Done with this answer's pipeline
      this.pipelineAnswer = null;
      this._cancelPipelinePrefetch();
    }

    this.enterCheckVision();
  }

  /** Generate the next pipelined joke for the current answer. */
  private _pipelineNextJoke(): void {
    const answer = this.pipelineAnswer;
    if (!answer) return;

    // Check if prefetch completed while current joke was playing
    const prefetch = this.pipelinePrefetch;
    if (prefetch?.done) {
      this.pipelinePrefetch = null;
      this.pipelinePrefetchAbort = null;

      if (prefetch.jokes.length > 0) {
        // Prefetch ready but not yet queued — queue now
        this.deps.logTiming("brain: using prefetched pipeline joke (zero wait)");
        this._transition("delivering");
        this.deps.setMotion("energetic", 0.8);
        for (const joke of prefetch.jokes) {
          this.deps.queueSpeak(joke.text, joke.motion as import("@/lib/motionStates").MotionState, joke.intensity);
          this.pipelinePreviousJokes.push(joke.text);
          this._addLedger("joke", joke.text, []);
          this.lastJokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
          this.lastJokeIntensity = joke.intensity;
        }
        if (prefetch.meta?.tags?.length) this._addLedger("answer", answer, prefetch.meta.tags);
        return;
      } else {
        // Jokes were already eagerly queued from the prefetch callback — TTS was in the chain.
        // Since we're inside _onDeliveringDrained (called from drain poll), the eagerly-queued
        // joke has already played — both jokes drained as one batch. Advance immediately.
        this.deps.logTiming("brain: pipeline joke already eagerly queued — advancing");
        this._onDeliveringDrained();
        return;
      }
    }

    // Prefetch not ready or failed — generate fresh (streaming)
    this._cancelPipelinePrefetch();
    this._transition("generating");
    this.deliveryGeneration++;
    this.deps.setMotion("thinking", 0.7);

    const q = this.currentQuestion;
    const conversationSoFar = this._getLedgerContext();
    const gen = this.deliveryGeneration;

    const alreadyDelivered = [
      ...new Set([...this._getDeliveredJokeTexts(), ...this.pipelinePreviousJokes]),
    ];

    this._generateJokeStream(
      {
        context: "answer_roast",
        question: q?.question,
        userAnswer: answer,
        jokesAlreadyDelivered: alreadyDelivered,
        conversationSoFar,
        knownFacts: this._getThrowbackContext(),
        maxJokes: 1,
      },
      (joke) => {
        if (this.deliveryGeneration !== gen) return;
        if (this.state !== "generating" && this.state !== "delivering") return;
        if (this.state === "generating") {
          this._transition("delivering");
          this.deps.setMotion("energetic", 0.8);
        }
        // Streaming-TTS path: audio already in flight via the SSE pipeline.
        if (!this.deps.openJokeStream) {
          this.deps.queueSpeak(joke.text, joke.motion as import("@/lib/motionStates").MotionState, joke.intensity);
        }
        this.pipelinePreviousJokes.push(joke.text);
        this._addLedger("joke", joke.text, []);
        this.lastJokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
        this.lastJokeIntensity = joke.intensity;
      },
      (meta) => {
        if (this.deliveryGeneration !== gen) return;
        if (this.state !== "generating" && this.state !== "delivering") return;
        if (this.state === "generating") {
          this._transition("delivering");
          this.deps.setMotion("energetic", 0.8);
        }
        if (meta.tags?.length) this._addLedger("answer", answer, meta.tags);
      },
      () => {
        if (this.deliveryGeneration !== gen) return;
        if (this.state === "generating") {
          this.pipelineAnswer = null;
          this._onDeliveringDrained();
        }
      },
      undefined,
      gen,
    );
  }

  // Bridge phrases (QUESTION_BRIDGES) live in src/lib/scriptLines.ts.

  private static _questionWithBridge(questionText: string): string {
    const normalizedQuestion = questionText.replace(/^[\s"'“”]+/, "").toLowerCase();
    const questionAlreadyHasBridge = QUESTION_BRIDGES.some((bridge) => {
      const bridgeLead = bridge.replace(/[.!?]+$/, "").toLowerCase();
      return normalizedQuestion.startsWith(bridgeLead);
    });
    if (questionAlreadyHasBridge) return questionText;
    const bridge = QUESTION_BRIDGES[Math.floor(Math.random() * QUESTION_BRIDGES.length)];
    return `${bridge} ${questionText}`;
  }

  /** Pick the question text variant — uses vulgarQuestions when contentMode is "vulgar". */
  private _pickQuestionText(q: ComedyQuestion): string {
    if (this.deps.getContentMode() === "vulgar" && q.vulgarQuestions?.length) {
      return q.vulgarQuestions[Math.floor(Math.random() * q.vulgarQuestions.length)];
    }
    return q.question;
  }

  /** Queue question with LLM rephrase for natural variation.
   *  Races rephrase vs a short timeout — falls back quickly if slow. */
  private _queueQuestionWithBridge(questionText: string): void {
    questionText = questionText || this.currentQuestion?.question || "What's your name?";
    this.deps.setMotion(this.lastJokeMotion, this.lastJokeIntensity);

    // Rapid Fire: skip rephrase entirely — questions are already short and punchy;
    // rephrase only adds latency and makes them longer. Occasionally drop the user's
    // name in ("Are you single, Tyler?").
    if (this._isRapidFireFlow()) {
      const spoken = this._maybeInjectName(questionText);
      this.deps.queueSpeak(spoken, "emphasis", 0.6);
      this.deps.setCurrentQuestion(spoken);
      this._addLedger("question", spoken, []);
      this.deps.logTiming("brain: rapid fire — skipping rephrase");
      return;
    }

    // Toast: questions are hand-authored drunk self-interruptions — the rambling
    // seam IS the comedy. The roast-only /api/rephrase-question forces a roast
    // persona voice + a <15-word single-sentence cap, flattening them to a generic
    // line ("So, what is your name anyway?"). Deliver the authored bank question
    // verbatim instead.
    if (this._isToast()) {
      this.deps.queueSpeak(questionText, "emphasis", 0.6);
      this.deps.setCurrentQuestion(questionText);
      this._addLedger("question", questionText, []);
      this.deps.logTiming("brain: toast — verbatim bank question (no rephrase)");
      return;
    }

    // Get the last joke text for rephrase context
    const lastJoke = this.ledger
      .filter((e) => e.type === "joke")
      .at(-1)?.text ?? "";

    const knownFacts = this._getThrowbackContext();

    // Skip rephrase when there's nothing to anchor it against — rephrase only
    // wins when it can bridge from a prior line or personalize with facts.
    if (!lastJoke && knownFacts.length === 0) {
      this.deps.queueSpeak(questionText, "emphasis", 0.6);
      this.deps.setCurrentQuestion(questionText);
      this._addLedger("question", questionText, []);
      this.deps.logTiming("brain: rephrase skipped — no prior context");
      return;
    }

    // Race: rephrase vs timeout
    const rephrasePromise = fetch("/api/rephrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: questionText,
        model: this.deps.getRoastModel(),
        persona: this.deps.getPersona(),
        burnIntensity: this.deps.getBurnIntensity(),
        knownFacts,
        previousLine: lastJoke,
      }),
    })
      .then((r) => r.json())
      .then((d: { rephrased?: string }) => d.rephrased?.trim() || null)
      .catch(() => null);

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 450));

    Promise.race([rephrasePromise, timeoutPromise]).then((rephrased) => {
      // Guard: only queue if we're in ask_question (normal path) or the pre-queue is
      // still pending (pipeline path — brain may be in delivering/generating/check_vision).
      // If preQueuedQuestion was cleared (consumed or cancelled), this callback is stale.
      if (this.state !== "ask_question" && !this.preQueuedQuestion) return;
      let spokenQuestionText: string;
      if (rephrased) {
        spokenQuestionText = rephrased;
        this.deps.queueSpeak(spokenQuestionText, "emphasis", 0.6);
        this.deps.logTiming(`brain: rephrased question — "${rephrased.slice(0, 60)}"`);
      } else if (COMEDIAN_CONFIG.skipScriptedLines) {
        spokenQuestionText = questionText;
        this.deps.queueSpeak(spokenQuestionText, "emphasis", 0.6);
        this.deps.logTiming("brain: rephrase timed out — using original (no bridge)");
      } else {
        spokenQuestionText = ComedianBrain._questionWithBridge(questionText);
        this.deps.queueSpeak(spokenQuestionText, "emphasis", 0.6);
        this.deps.logTiming("brain: rephrase timed out — using original");
      }
      this.deps.setCurrentQuestion(spokenQuestionText);
      this._addLedger("question", spokenQuestionText, []);
    });
  }

  /** Generate a contextual question via LLM based on what we see + know. */
  private _generateContextualQuestion(): void {
    this.deps.setMotion("thinking", 0.6);
    this.deps.logTiming("brain: generating contextual question");

    const observations = this.deps.getObservations();
    const frame = this.cameraAvailable ? this.deps.captureFrame() : undefined;

    fetch("/api/generate-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.deps.getRoastModel(),
        persona: this.deps.getPersona(),
        observations,
        setting: this.deps.getVisionSetting(),
        knownFacts: this._getThrowbackContext(),
        conversationSoFar: this._getLedgerContext(),
        previousQuestions: this._getPreviousQuestionTexts(),
        style: this.deps.getLlmQuestions?.() ? "simple" : "open",
        imageBase64: frame,
      }),
    })
      .then((r) => r.json())
      .then((data: { question: string; jokeContext: string }) => {
        if (this.state !== "ask_question") return; // stale
        const questionText = data.question;
        this.currentQuestion = {
          id: `generated_${Date.now()}`,
          question: questionText,
          jokeContext: data.jokeContext,
          prodLines: CONTEXTUAL_QUESTION_PRODS,
        };
        this._queueQuestionWithBridge(questionText);
        this.deps.logTiming(`brain: contextual question — "${questionText}"`);
      })
      .catch(() => {
        if (this.state !== "ask_question") return;
        // Fallback — ask where they are
        const fallback = CONTEXTUAL_FALLBACK_QUESTION;
        this.currentQuestion = {
          id: "generated_fallback",
          question: fallback,
          jokeContext: "Location and environment roast.",
          prodLines: CONTEXTUAL_FALLBACK_PRODS,
        };
        this._queueQuestionWithBridge(fallback);
      });
  }

  private _cancelRephrase(): void {
    if (this.rephraseAbort) {
      this.rephraseAbort.abort();
      this.rephraseAbort = null;
    }
    this._clearPreQueue();
  }

  private _clearPreQueue(): void {
    this.preQueuedQuestion = null;
    this.preQueuedRephrasedText = null;
  }

  /**
   * Pick the next question while jokes are still playing so enterAskQuestion
   * can advance without an LLM round-trip. Fires the rephrase / contextual fetch
   * concurrently so the text is usually ready by the time we drain.
   *
   * Pre-queue stashes text only — never queues TTS — so vision_react interrupts
   * during check_vision still play in the right order.
   */
  private _preQueueNextQuestion(): void {
    if (this.visionOnlyMode) return;
    if (this.preQueuedQuestion) return;

    const isRapidFire = this._isRapidFireFlow();
    // Dev experiment: llmQuestions on → pre-fetch every question from the LLM (repeat-aware).
    const useLlmQuestions = this.deps.getLlmQuestions?.() === true && this.askedQuestionIds.size >= 1;
    // Toast stays on its authored bank — never pre-fetch a generic contextual question.
    const shouldUseContextual =
      !isRapidFire && !this._isToast() &&
      (useLlmQuestions || (this.bankQuestionsInARow >= 1 && this.cameraAvailable));
    if (shouldUseContextual) {
      this.bankQuestionsInARow = 0;
      this._preFetchContextualQuestion();
      return;
    }

    const nextQ = this._nextValidQuestion();
    if (!nextQ) {
      if (!isRapidFire) this._preFetchContextualQuestion();
      return;
    }
    this.bankQuestionsInARow++;
    this.preQueuedQuestion = nextQ;
    this.preQueuedRephrasedText = null;
    if (isRapidFire) {
      // Skip rephrase — questions are already short; set text directly so enterAskQuestion
      // picks it up from the pre-queue as-is. Occasionally personalize with the name.
      this.preQueuedRephrasedText = this._maybeInjectName(this._pickQuestionText(nextQ));
      this.deps.logTiming(`brain: rapid fire pre-queue — "${nextQ.id}" (no rephrase)`);
    } else {
      this._fetchRephraseForPreQueue(this._pickQuestionText(nextQ));
    }
    // (Per-answer speculative pre-gen removed — superseded by the Rapid Fire burst cadence,
    // which roasts collected answers together rather than one joke per answer.)
    this.deps.logTiming(`brain: pre-queue bank question — "${nextQ.id}"`);
  }

  private _fetchRephraseForPreQueue(questionText: string): void {
    // Toast: skip rephrase entirely (see _queueQuestionWithBridge) — stash the
    // authored bank question verbatim so enterAskQuestion speaks it as written.
    if (this._isToast()) {
      this.preQueuedRephrasedText = questionText;
      this.deps.logTiming("brain: toast pre-queue — verbatim bank question (no rephrase)");
      return;
    }
    const lastJoke = this.ledger.filter((e) => e.type === "joke").at(-1)?.text ?? "";
    const knownFacts = this._getThrowbackContext();
    const targetSlot = this.preQueuedQuestion;

    // Same skip rule as the in-line path — nothing to anchor against.
    if (!lastJoke && knownFacts.length === 0) {
      this.preQueuedRephrasedText = questionText;
      this.deps.logTiming("brain: pre-queue rephrase skipped — no prior context");
      return;
    }

    fetch("/api/rephrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: questionText,
        model: this.deps.getRoastModel(),
        persona: this.deps.getPersona(),
        burnIntensity: this.deps.getBurnIntensity(),
        knownFacts,
        previousLine: lastJoke,
      }),
    })
      .then((r) => r.json())
      .then((d: { rephrased?: string }) => d.rephrased?.trim() || null)
      .catch(() => null)
      .then((rephrased) => {
        // Slot may have been cleared (cancel/consume) or replaced — bail
        if (this.preQueuedQuestion !== targetSlot) return;
        if (rephrased) {
          this.preQueuedRephrasedText = rephrased;
          this.deps.logTiming(`brain: pre-queue rephrase ready — "${rephrased.slice(0, 60)}"`);
        }
      });
  }

  private _preFetchContextualQuestion(): void {
    this.deps.logTiming("brain: pre-fetching contextual question");
    const observations = this.deps.getObservations();
    const frame = this.cameraAvailable ? this.deps.captureFrame() : undefined;

    fetch("/api/generate-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.deps.getRoastModel(),
        persona: this.deps.getPersona(),
        observations,
        setting: this.deps.getVisionSetting(),
        knownFacts: this._getThrowbackContext(),
        conversationSoFar: this._getLedgerContext(),
        previousQuestions: this._getPreviousQuestionTexts(),
        style: this.deps.getLlmQuestions?.() ? "simple" : "open",
        imageBase64: frame,
      }),
    })
      .then((r) => r.json())
      .then((data: { question: string; jokeContext: string }) => {
        if (!data?.question) return;
        if (this.preQueuedQuestion) return; // raced — keep whichever landed first
        this.preQueuedQuestion = {
          id: `generated_${Date.now()}`,
          question: data.question,
          jokeContext: data.jokeContext,
          prodLines: ["Come on, I'm waiting.", "I asked you a question."],
        };
        // Contextual question is freshly written for this moment — skip the rephrase pass.
        this.preQueuedRephrasedText = data.question;
        this.deps.logTiming(`brain: pre-fetched contextual — "${data.question.slice(0, 40)}"`);
      })
      .catch(() => {});
  }

  /** Speculatively generate the next pipeline joke while the current one plays. */
  private _prefetchPipelineJoke(): void {
    if (!COMEDIAN_CONFIG.singleJokeMode || !this.pipelineAnswer) return;
    const maxJokes = COMEDIAN_CONFIG.jokesPerAnswer.max;
    // If this is the last pipeline joke, do not pre-queue the next question yet.
    // We still need to pass through check_vision/vision_react first; speaking a question
    // early causes users to answer while the brain isn't listening yet.
    if (this.pipelineJokesDelivered + 1 >= maxJokes) {
      return;
    }

    this._cancelPipelinePrefetch();
    const abort = new AbortController();
    this.pipelinePrefetchAbort = abort;

    const prefetch: NonNullable<typeof this.pipelinePrefetch> = { jokes: [], meta: null, done: false };
    this.pipelinePrefetch = prefetch;

    const answer = this.pipelineAnswer;
    const q = this.currentQuestion;
    const alreadyDelivered = [
      ...new Set([...this._getDeliveredJokeTexts(), ...this.pipelinePreviousJokes]),
    ];

    this.deps.logTiming("brain: prefetching next pipeline joke while current plays");

    // Use non-streaming _generateJoke for simplicity — result stashed for _pipelineNextJoke
    this._generateJoke(
      {
        context: "answer_roast",
        question: q?.question,
        userAnswer: answer,
        jokesAlreadyDelivered: alreadyDelivered,
        conversationSoFar: this._getLedgerContext(),
        knownFacts: this._getThrowbackContext(),
        maxJokes: 1,
      },
      abort.signal,
    ).then((response) => {
      if (abort.signal.aborted || !response) return;
      prefetch.jokes = response.jokes;
      prefetch.meta = { tags: response.tags };
      prefetch.done = true;
      this.deps.logTiming(`brain: pipeline prefetch ready (${response.jokes.length} jokes)`);

      // Queue jokes immediately so TTS prefetch starts while current joke is still playing.
      // When _pipelineNextJoke fires on drain, it will find the prefetch consumed and
      // the TTS already in the chain — zero wait.
      if (this.state === "delivering" && prefetch.jokes.length > 0) {
        for (const joke of prefetch.jokes) {
          this.deps.queueSpeak(joke.text, joke.motion as import("@/lib/motionStates").MotionState, joke.intensity);
          this.pipelinePreviousJokes.push(joke.text);
          this._addLedger("joke", joke.text, []);
          this.lastJokeMotion = joke.motion as import("@/lib/motionStates").MotionState;
          this.lastJokeIntensity = joke.intensity;
        }
        if (prefetch.meta?.tags?.length) this._addLedger("answer", answer, prefetch.meta.tags);
        // Mark as consumed so _pipelineNextJoke skips straight to _onDeliveringDrained
        prefetch.jokes = [];
        this.deps.logTiming("brain: pipeline joke queued eagerly (TTS prefetch started)");
      }
    }).catch(() => { /* aborted or failed — _pipelineNextJoke falls back to fresh generation */ });
  }

  private _cancelPipelinePrefetch(): void {
    if (this.pipelinePrefetchAbort) {
      this.pipelinePrefetchAbort.abort();
      this.pipelinePrefetchAbort = null;
    }
    this.pipelinePrefetch = null;
  }

  private enterCheckVision(): void {
    if (this.pendingWrapup) {
      this.enterWrapup();
      return;
    }
    this._transition("check_vision");

    // If we already have the next question lined up (pre-queued during
    // delivery), skip vision_react and ask it. Avoids inserting a 5-7s vision joke between
    // the answer's roast and the next question. Vision interrupt still fires
    // when there's nothing queued — see refresh of previousObservations below.
    const isRapidFire = this._isRapidFireFlow();
    const hasQueuedNext = !!this.preQueuedQuestion;
    if (hasQueuedNext) {
      const current = this.deps.getObservations();
      // Rapid Fire: alternate a vision joke between question bursts. On the "vision turn"
      // we deliver a vision joke now and KEEP the pre-queued question — when the vision
      // joke drains, vision_react → enterAskQuestion asks it. Gives a vision/Q&A mix
      // instead of pure Q&A.
      if (isRapidFire && this.rapidFireVisionJokeTurn && this.cameraAvailable && current.length > 0) {
        this.rapidFireVisionJokeTurn = false;
        const old = [...this.previousObservations];
        this.previousObservations = [...current];
        this.pendingVisionInterrupt = null;
        this.deps.logTiming("brain: rapid fire — vision joke between bursts");
        this.enterVisionReact(current, current, old);
        return;
      }
      if (isRapidFire) this.rapidFireVisionJokeTurn = true; // next burst gets a vision joke
      // Refresh observation baseline so the next genuine vision_react isn't
      // triggered by changes we deliberately skipped.
      if (this.cameraAvailable && current.length > 0) {
        this.previousObservations = [...current];
      }
      this.pendingVisionInterrupt = null;
      this.deps.logTiming("brain: skipping vision_react — next question already queued");
      this.enterAskQuestion();
      return;
    }

    // Check for proactively queued vision interrupt first
    if (this.pendingVisionInterrupt) {
      const { changes, current, previous } = this.pendingVisionInterrupt;
      this.pendingVisionInterrupt = null;
      this.deps.logTiming("brain: consuming queued vision interrupt");
      this.enterVisionReact(changes, current, previous);
      return;
    }

    const current = this.deps.getObservations();

    if (this.cameraAvailable && current.length > 0) {
      const oldObservations = [...this.previousObservations];
      const { isInteresting, changes } = diffObservations(oldObservations, current);
      // Always update baseline — prevents diff accumulation from wording variation
      this.previousObservations = [...current];
      if (isInteresting) {
        this.enterVisionReact(changes, current, oldObservations);
        return;
      }
    }

    // Nothing interesting — next question (unless we've exhausted all questions)
    if (this.visionOnlyMode) {
      // All questions used up and vision isn't interesting — wait for next vision update
      this.deps.logTiming("brain: vision-only mode, waiting for interesting vision change");
      this.deps.setMotion("idle", 0.3);
      return;
    }
    this.enterAskQuestion();
  }

  private static readonly WRAPUP_GENERATION_TIMEOUT_MS = 6000;
  // Closing lines (WRAPUP_FALLBACK / WRAPUP_BRIDGES) live in src/lib/scriptLines.ts.

  private enterWrapup(): void {
    this.pendingWrapup = false;
    this._clearTimers();
    this._cancelSpeculative();
    this._cancelExpectedJokesGen();
    this._cancelHopper();
    this._cancelPipelinePrefetch();
    this._cancelRephrase();
    this.preQueuedQuestion = null;
    this.preQueuedRephrasedText = null;
    this.pipelinePrefetch = null;
    this._transition("wrapup");
    this.deps.setMotion("smug", 0.8);

    // Bridge phrase fills the ~2-3s LLM generation gap so the user hears speech the moment
    // the comedian "starts wrapping up" instead of staring at silence. Queued synchronously
    // so its TTS fetch happens in parallel with the closing-line generation.
    if (!COMEDIAN_CONFIG.skipScriptedLines) {
      const bridge =
        WRAPUP_BRIDGES[Math.floor(Math.random() * WRAPUP_BRIDGES.length)];
      this.deps.queueSpeak(bridge, "smug", 0.7);
      this.deps.logTiming(`brain: wrapup bridge — "${bridge}"`);
    }

    const knownFacts = this._getThrowbackContext();
    const conversation = this._getLedgerContext();
    const frame = this.cameraAvailable ? this.deps.captureFrame() : undefined;

    this.deps.logTiming("brain: → wrapup — generating closing line");

    let resolved = false;
    const queueClosing = (text: string, motion: MotionState = "smug", intensity = 0.8): void => {
      if (resolved || this.state !== "wrapup") return;
      resolved = true;
      this.deps.queueSpeak(text, motion, intensity);
      this._addLedger("joke", text, []);
      // Flip the gate so the next wrapup drain event fires session end. If the bridge has
      // already drained by now, queueing the closing line resets the chain to non-empty;
      // the next drain (when the closing line itself finishes) will fire session end.
      this.wrapupClosingQueued = true;
    };

    // Safety net: if the LLM hangs, queue the fallback so the session can still end.
    const timeout = setTimeout(() => {
      if (resolved) return;
      this.deps.logTiming("brain: wrapup generation timeout — using fallback");
      queueClosing(WRAPUP_FALLBACK);
    }, ComedianBrain.WRAPUP_GENERATION_TIMEOUT_MS);

    this._generateJoke({
      context: "wrapup",
      knownFacts,
      conversationSoFar: conversation,
      observations: this.deps.getObservations(),
      imageBase64: frame,
      maxJokes: 1,
    }).then((response) => {
      clearTimeout(timeout);
      const closing = response?.jokes?.[0];
      if (closing && closing.text.trim()) {
        this.deps.logTiming(`brain: wrapup closing — "${closing.text.slice(0, 60)}"`);
        queueClosing(closing.text, closing.motion, closing.intensity);
      } else {
        this.deps.logTiming("brain: wrapup generation empty — using fallback");
        queueClosing(WRAPUP_FALLBACK);
      }
    }).catch(() => {
      clearTimeout(timeout);
      this.deps.logTiming("brain: wrapup generation error — using fallback");
      queueClosing(WRAPUP_FALLBACK);
    });
  }

  private _fireSessionEnd(): void {
    if (this.wrapupSessionEnded) return;
    this.wrapupSessionEnded = true;
    this.deps.logTiming("brain: wrapup TTS drained — signaling session end");
    this.deps.onSessionEnd?.();
  }

  private enterVisionReact(changes: string[], currentObs: string[], oldObs: string[]): void {
    this._transition("vision_react");
    this.deps.setMotion("shocked", 0.8);
    const frame = this.cameraAvailable ? this.deps.captureFrame() : undefined;

    // Check hopper for a vision joke first
    const hopperJoke = this._popHopperJoke(4, "vision");
    if (hopperJoke) {
      this.deps.queueSpeak(hopperJoke.text, hopperJoke.motion, hopperJoke.intensity);
      this._addLedger("joke", hopperJoke.text, []);
      return;
    }

    this._generateJoke({
      context: "vision_react",
      observations: currentObs,
      previousObservations: oldObs,
      jokesAlreadyDelivered: this._getDeliveredJokeTexts(),
      knownFacts: this._getThrowbackContext(),
      imageBase64: frame,
    }).then((response) => {
      if (this.state !== "vision_react") return;
      if (!response || response.jokes.length === 0) {
        // No jokes — fall through to next question rather than getting stuck
        this._transition("ask_question");
        this.enterAskQuestion();
        return;
      }
      for (const joke of response.jokes) {
        this.deps.queueSpeak(joke.text, joke.motion, joke.intensity);
        this._addLedger("joke", joke.text, []);
      }
    });
  }

  // ─── Speculative pre-generation ───────────────────────────────────────────────

  private _startSpeculative(): void {
    if (COMEDIAN_CONFIG.skipPreGeneration) return;
    const snapshot = this.answerBuffer.trim();
    if (this.speculativeRequest) {
      // Already running — if snapshot changed significantly, cancel and restart
      if (!isSimilarAnswer(this.speculativeRequest.snapshot, snapshot)) {
        this._cancelSpeculative();
      } else {
        return;
      }
    }

    const abort = new AbortController();
    const q = this.currentQuestion;
    const conversationSoFar = this._getLedgerContext();

    // Filler will be a non-word sound — tell the generator so the joke doesn't open similarly
    const fillerAlreadySaid = COMEDIAN_CONFIG.skipFiller ? undefined : "filler sound";

    const result = this._generateJoke(
      {
        context: "answer_roast",
        question: q?.question,
        userAnswer: snapshot,
        fillerAlreadySaid,
        conversationSoFar,
        knownFacts: this._getThrowbackContext(),
      },
      abort.signal,
    );

    this.speculativeRequest = { snapshot, abort, result };
  }

  private _cancelSpeculative(): void {
    if (this.speculativeRequest) {
      this.speculativeRequest.abort.abort();
      this.speculativeRequest = null;
    }
  }

  // ─── Speculative pre-gen by expected answer (Rapid Fire) ─────────────────────

  /**
   * Fire a single LLM call that generates jokes for EACH expected answer of
   * the given question. Result is cached on `expectedJokesCache`. When the
   * user actually answers, the brain matches the STT to a key and delivers
   * the cached pair without waiting on a fresh LLM round-trip.
   *
   * No-op when:
   *   - flowMode !== "rapid_fire" (Original flow doesn't use this path)
   *   - the question has no `expectedAnswers` (e.g., "name" — open-ended)
   *   - a cache is already in flight or resolved for this same questionId
   *
   * Failures resolve to an empty cache, which the consumer treats as a miss
   * and falls back to fresh gen — silently degrading, never throwing.
   */
  private _fireExpectedJokesGen(question: ComedyQuestion): void {
    if (!this._isRapidFireFlow()) return;
    if (!question.expectedAnswers || question.expectedAnswers.length === 0) return;
    // Already cached/in-flight for this question? Reuse.
    if (this.expectedJokesCache?.questionId === question.id) return;
    // Different question pending — cancel before we replace.
    this._cancelExpectedJokesGen();

    const abort = new AbortController();
    // Build the request body defensively. JSON.stringify can throw for
    // circular refs / BigInts — none expected here, but the brain's
    // never-throws contract means we belt-and-suspender it.
    let bodyJson: string;
    try {
      bodyJson = JSON.stringify({
        question: question.question,
        expectedAnswers: question.expectedAnswers,
        persona: this.deps.getPersona(),
        burnIntensity: this.deps.getBurnIntensity(),
        contentMode: this.deps.getContentMode(),
        model: this.deps.getRoastModel(),
        knownFacts: this._getThrowbackContext(),
      });
    } catch (err) {
      this.deps.logTiming(`brain: expected-jokes serialize failed q=${question.id}: ${String(err).slice(0, 80)}`);
      return;
    }
    const ready = fetch("/api/generate-expected-jokes", {
      method: "POST",
      signal: abort.signal,
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
    })
      .then((r) => r.json() as Promise<ExpectedJokesResponse>)
      .then((data) => {
        if (abort.signal.aborted) return;
        if (this.expectedJokesCache?.questionId !== question.id) return; // stale
        const map = new Map<string, JokeItem[]>();
        for (const [key, jokes] of Object.entries(data.jokesByAnswer ?? {})) {
          if (Array.isArray(jokes) && jokes.length > 0) {
            map.set(key, jokes as JokeItem[]);
          }
        }
        this.expectedJokesCache.jokesByAnswer = map;
        this.deps.logTiming(
          `brain: expected-jokes ready q=${question.id} keys=${[...map.keys()].join("|")}`,
        );
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        this.deps.logTiming(`brain: expected-jokes fetch failed q=${question.id}: ${String(err).slice(0, 80)}`);
        if (this.expectedJokesCache?.questionId === question.id) {
          this.expectedJokesCache.jokesByAnswer = new Map(); // empty → consumer falls back
        }
      });

    this.expectedJokesCache = {
      questionId: question.id,
      abort,
      jokesByAnswer: null,
      ready,
    };
    this.deps.logTiming(`brain: expected-jokes fired q=${question.id} keys=${question.expectedAnswers.join("|")}`);
  }

  private _cancelExpectedJokesGen(): void {
    if (this.expectedJokesCache) {
      this.expectedJokesCache.abort.abort();
      this.expectedJokesCache = null;
    }
  }

  /**
   * Look up cached pre-gen'd jokes for the given answer. Returns the joke
   * array if there's a confident match, else null (caller falls back to
   * fresh generation).
   *
   * Consumes the cache on hit — same pair won't be reused on a re-ask.
   */
  private _tryConsumeExpectedJokes(answer: string): JokeItem[] | null {
    const cache = this.expectedJokesCache;
    if (!cache) return null;
    if (cache.questionId !== this.currentQuestion?.id) return null;
    if (cache.jokesByAnswer === null) {
      // Cache still resolving — too early to use, fall through.
      return null;
    }
    const keys = [...cache.jokesByAnswer.keys()];
    if (keys.length === 0) return null;
    const matched = matchExpectedAnswer(answer, keys);
    if (!matched) {
      this.deps.logTiming(`brain: expected-jokes miss "${answer.slice(0, 30)}" — fall back`);
      return null;
    }
    const jokes = cache.jokesByAnswer.get(matched) ?? null;
    if (!jokes || jokes.length === 0) return null;
    // Consume — clear so a re-ask doesn't reuse the same pair.
    this.expectedJokesCache = null;
    this.deps.logTiming(`brain: expected-jokes hit "${matched}" — ${jokes.length} jokes`);
    return jokes;
  }

  // ─── Joke Hopper ──────────────────────────────────────────────────────────────

  private _fireHopperGeneration(
    sourceContext: string,
    observations?: string[],
    answer?: string,
  ): void {
    // Toast: the hopper is disabled. Its only live consumer (vision_react) already
    // generates a fresh single joke on demand when the hopper is empty, and the old
    // bonus-joke / silence-fallback consumers are gone — so background batches were
    // pure waste that also buried the funniest scored lines (never spoken). Roast
    // still uses the hopper.
    if (this._isToast()) return;
    // Cancel stale hopper generation
    this._cancelHopper();

    const abort = new AbortController();
    this.hopperAbort = abort;

    const conversationSoFar = this._getLedgerContext();

    this._generateJoke(
      {
        context: "hopper",
        observations: observations ?? this.deps.getObservations(),
        userAnswer: answer,
        jokesAlreadyDelivered: this._getDeliveredJokeTexts(),
        conversationSoFar,
        knownFacts: this._getThrowbackContext(),
      },
      abort.signal,
    ).then((response) => {
      if (abort.signal.aborted || !response) return;
      this.hopperAbort = null;

      const now = Date.now();
      const newJokes: ScoredJoke[] = response.jokes.map((j) => ({
        ...j,
        sourceContext,
        createdAt: now,
      }));

      // Merge into hopper, evict oldest if over max
      this.jokeHopper = [
        ...this.jokeHopper.filter(
          (j) => now - j.createdAt < COMEDIAN_CONFIG.hopperStalenessMs
        ),
        ...newJokes,
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, COMEDIAN_CONFIG.hopperMaxSize);
    });
  }

  private _cancelHopper(): void {
    if (this.hopperAbort) {
      this.hopperAbort.abort();
      this.hopperAbort = null;
    }
  }

  /** Add a single joke to the hopper directly (e.g. vision opening when greeting is skipped). */
  private _addToHopper(text: string, motion: MotionState, intensity: number, score: number): void {
    this.jokeHopper.push({
      text, motion, intensity, score,
      sourceContext: "vision",
      createdAt: Date.now(),
    });
    this.jokeHopper.sort((a, b) => b.score - a.score);
    if (this.jokeHopper.length > COMEDIAN_CONFIG.hopperMaxSize) {
      this.jokeHopper.length = COMEDIAN_CONFIG.hopperMaxSize;
    }
  }

  /** Pop the best joke from the hopper meeting the minimum score, optionally filtered by context */
  private _popHopperJoke(minScore: number, contextFilter?: string): ScoredJoke | null {
    const now = Date.now();
    const idx = this.jokeHopper.findIndex(
      (j) =>
        j.score >= minScore &&
        now - j.createdAt < COMEDIAN_CONFIG.hopperStalenessMs &&
        (contextFilter ? j.sourceContext.includes(contextFilter) : true)
    );
    if (idx === -1) return null;
    const [joke] = this.jokeHopper.splice(idx, 1);
    return joke;
  }

  // ─── Passive reaction handling ────────────────────────────────────────────────

  private static CRITIQUE_RE = /not\s+funny|wasn'?t\s+funny|isn'?t\s+funny|too\s+(mean|harsh|far|rude)|stop\s+(that|it)|offensive|inappropriate|don'?t\s+(joke|talk)\s+about|that\s+(hurt|sucked|was\s+bad)/i;
  private static LAUGHTER_RE = /^(ha+|he+|haha+|hehe+|lo+l|hahaha+|heh)\b/i;
  private static TINY_REACTION_RE = /^(yeah|yep|yup|right|ok|okay|sure|wow|oh|ah|huh|mm+|hmm+|mhm)\b[\s.!?]*$/i;

  /**
   * Decide whether incoming user speech during `delivering` should interrupt the joke.
   * Conservative: laughter, tiny acknowledgments ("yeah", "wow"), and STT echoes of the
   * puppet's own line stay passive. Substantive speech (3+ words, a correction cue, or a
   * critique) interrupts so the user can correct a mishearing.
   */
  private _shouldInterruptDelivering(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (this._answerEchoesRecentRoast(trimmed)) return false;
    if (ComedianBrain.LAUGHTER_RE.test(trimmed)) return false;
    if (ComedianBrain.TINY_REACTION_RE.test(trimmed)) return false;
    if (ComedianBrain._hasCorrectionCue(trimmed)) return true;
    if (ComedianBrain.CRITIQUE_RE.test(trimmed)) return true;
    return wordCount(trimmed) >= 3;
  }

  private _handleReactionText(text: string): void {
    const lower = text.toLowerCase();
    const isLaughter = /ha|hehe|lol|haha/.test(lower);
    const isCritique = ComedianBrain.CRITIQUE_RE.test(lower);

    if (isLaughter) {
      this._addLedger("reaction", text, ["reaction:laughter"]);
      this._fireHopperGeneration("riff_on_reaction");
    } else if (isCritique) {
      this._addLedger("reaction", text, ["reaction:critique"]);
      this.deps.logTiming(`brain: critique detected — "${text}"`);
      this.deps.saveCritique?.(text, {
        persona: this.deps.getPersona(),
        lastJokeText: this.lastDeliveredJokeText || undefined,
      });
    } else if (text.trim().split(/\s+/).length <= 5) {
      this._addLedger("reaction", text, ["reaction:verbal"]);
    }
  }

  // ─── Ledger ───────────────────────────────────────────────────────────────────

  private _addLedger(
    type: LedgerEntry["type"],
    text: string,
    tags: string[],
  ): void {
    if (type === "joke") this.lastDeliveredJokeText = text;
    // Mirror questions into the LLM debug log so it shows the FULL back-and-forth
    // (jokes are already logged at their generation site). Keeps the panel in sync
    // with the transcript + on-screen question instead of showing only jokes.
    if (type === "question") this.deps.logLlm?.("←", "question", text);
    this.ledger.push({ type, text, timestamp: Date.now(), tags });
    // Keep last 30 entries
    if (this.ledger.length > 30) this.ledger = this.ledger.slice(-30);
  }

  /** IDs of questions to skip when ambient context provides location. Stay in sync with
   *  questionBank.ts — currently only `where_from` asks about location. */
  private static readonly LOCATION_QUESTION_IDS = new Set(["where_from"]);

  /** Returns the next valid question, skipping excluded ones. Null if exhausted. */
  private _nextValidQuestion(): ComedyQuestion | null {
    const total = this.shuffledQuestions.length;
    const ambientCity = this.deps.getAmbientContext()?.city;
    const hasLocation = !!ambientCity && ambientCity !== "unknown";

    for (let i = 0; i < total; i++) {
      const q = this.shuffledQuestions[(this.questionIndex + i) % total];
      // Skip if already asked
      if (this.askedQuestionIds.has(q.id)) continue;
      // Skip location questions when we already know their city
      if (hasLocation && ComedianBrain.LOCATION_QUESTION_IDS.has(q.id)) continue;
      // Skip if excluded by a previously asked question
      const excluded = this.shuffledQuestions
        .filter((prev) => this.askedQuestionIds.has(prev.id) && prev.excludes)
        .flatMap((prev) => prev.excludes!);
      if (excluded.includes(q.id)) continue;
      this.questionIndex += i + 1;
      return q;
    }
    return null;
  }

  private _getLedgerContext(): string[] {
    return this.ledger.slice(-6).map(
      (e) => `[${e.type}] ${e.text}${e.tags.length ? ` (${e.tags.join(", ")})` : ""}`
    );
  }

  /** Last N delivered joke texts across the whole session — sent as a hard
   *  do-not-repeat list. conversationSoFar only carries the last 6 ledger
   *  entries, so without this the LLM loses sight of jokes told a few cycles
   *  back and re-uses the same angles. */
  private _getDeliveredJokeTexts(limit = 10): string[] {
    const jokes: string[] = [];
    for (const e of this.ledger) {
      if (e.type === "joke") jokes.push(e.text);
    }
    return jokes.slice(-limit);
  }

  /** Resolve the experience type with a safe default. The dep is optional so
   *  existing tests / harnesses that don't supply it still default to "roast". */
  private _getExperienceType(): import("@/store/useSessionStore").ExperienceType {
    return this.deps.getExperienceType?.() ?? "roast";
  }

  /** Convenience: brain code reads `this._isToast()` instead of comparing strings. */
  private _isToast(): boolean {
    return this._getExperienceType() === "toast";
  }

  /** True only when ROAST experience AND flowMode is rapid_fire. Toast has no
   *  Rapid Fire variant — even if the store's flowMode is set, we don't route
   *  through the Rapid Fire branches when in Toast. Use this everywhere
   *  instead of comparing `getFlowMode() === "rapid_fire"` directly. */
  private _isRapidFireFlow(): boolean {
    return !this._isToast() && this.deps.getFlowMode() === "rapid_fire";
  }

  /** All question texts asked so far. Passed to generate-question to prevent topic repetition. */
  private _getPreviousQuestionTexts(): string[] {
    return this.ledger.filter((e) => e.type === "question").map((e) => e.text);
  }

  /** Full ledger summary for throwback references — all facts learned so far. */
  /**
   * Maximum personal facts (excluding city) included in `knownFacts` per joke
   * generation call. Without this cap the prompt accumulates the entire
   * dossier ("name, age, job, hobby, kids...") and the LLM starts reciting
   * the list instead of riffing on what just happened. 2 = current topic +
   * one prior anchor — usually enough for a callback without forcing one.
   */
  private static readonly MAX_KNOWN_FACTS = 2;

  private _getThrowbackContext(): string[] {
    // Extract all tagged facts from the full ledger, dedupe preserving order.
    const facts: string[] = [];
    for (const entry of this.ledger) {
      if (entry.tags.length > 0) {
        facts.push(...entry.tags);
      }
    }
    const deduped = [...new Set(facts)];
    // Cap to the most recent N — bias toward what just happened.
    const capped = deduped.slice(-ComedianBrain.MAX_KNOWN_FACTS);

    // City is always included if known. It's geo-derived flavor, not a fact
    // they told us, so it doesn't count against the cap.
    const ambient = this.deps.getAmbientContext();
    if (ambient?.city && ambient.city !== "unknown") {
      capped.push(`city:${ambient.city}`);
    }
    return capped;
  }

  /**
   * When prior jokes already echoed geo/time/weather, drop the generic AMBIENT boilerplate on the API
   * side and inject a strict instruction instead — stops "Monday afternoon in Woodacre in the drizzle" every line.
   */
  private _ambientAntiRepeatNote(): string | undefined {
    const ac = this.deps.getAmbientContext();
    if (!ac || ac.city === "unknown") return undefined;

    const jokeTexts = this.ledger
      .filter((e) => e.type === "joke")
      .map((e) => e.text.toLowerCase());
    if (jokeTexts.length === 0) return undefined;

    const combined = jokeTexts.join("\n");

    const cityLc = ac.city.trim().toLowerCase();
    const usedCity = cityLc.length >= 2 && combined.includes(cityLc);

    const weekdayLc = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const usedWeekday = combined.includes(weekdayLc);

    const todLc = ac.timeOfDay.toLowerCase();
    const todHits = ["morning", "afternoon", "evening", "night"].filter(
      (w) => todLc.includes(w) && combined.includes(w),
    );

    let usedWeather = false;
    if (ac.weather) {
      const w = ac.weather.toLowerCase();
      const stems = ["drizzl", "rain", "rainy", "storm", "snow", "fog", "wind", "cloud", "overcast", "clear"];
      usedWeather = stems.some((stem) => w.includes(stem) && combined.includes(stem));
      const words = w.split(/[\s,]+/).filter((x) => x.length >= 4);
      usedWeather ||= words.some((word) => combined.includes(word.toLowerCase()));
    }

    if (!usedCity && !usedWeekday && todHits.length === 0 && !usedWeather) return undefined;

    const bits: string[] = [];
    if (usedCity) bits.push(`place (“${ac.city}”)`);
    if (usedWeekday) bits.push(`weekday (${weekdayLc})`);
    if (todHits.length > 0) bits.push(`time-of-day (${todHits.join(", ")})`);
    if (usedWeather) bits.push("weather vibe");

    return (
      `AMBIENT DISCIPLINE (mandatory): Earlier [joke] lines already referenced ${bits.join(", ")}. ` +
        `Do NOT repeat the scenic stack (town + weekday + weather/time) as filler. ` +
        `Do NOT reopen with "${weekdayLc} afternoon in ${ac.city}" style setups — they've been burned. ` +
        `Roast the USER'S ANSWER or riff without restating geography unless ONE word is the punchline itself.`
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private _transition(next: BrainState): void {
    // Leaving "generating" — a joke streamed in (or we're being redirected/aborted).
    // Either way the watchdog's job is done; cancel it so it can't fire a spurious fallback.
    if (this.state === "generating" && next !== "generating") {
      this._clearGenerationWatchdog();
    }
    const config = STATE_CONFIG[next];
    this.state = next;
    this.micMode = config.micMode;
    this.deps.setBrainState(next);
    this.deps.logTiming(`brain: → ${next}`);
  }

  private _clearTimers(): void {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.prodTimer) { clearTimeout(this.prodTimer); this.prodTimer = null; }
    if (this.devNoteTimer) { clearTimeout(this.devNoteTimer); this.devNoteTimer = null; }
    if (this.greetingVisionTimeout) { clearTimeout(this.greetingVisionTimeout); this.greetingVisionTimeout = null; }
    this._clearConfirmTimer();
    this._clearGenerationWatchdog();
    // Pump cancellation — _clearTimers fires on stop / cancellation / wait_answer entry, all
    // paths where leaving "generating" without delivering a joke is possible. Flip the flag and
    // cancel any pending breath so a deferred filler can't fire after we've moved on.
    this.fillerPumpActive = false;
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = null; }
  }

  private _getPersonaGreetings(): string[] {
    return PERSONAS[this.deps.getPersona()]?.greetings ?? [DEFAULT_GREETING];
  }

  private _rhetoricalVersion(question: string): string {
    return RHETORICAL_QUESTIONS[question] ?? `I'd ask you ${question.toLowerCase()} but I'll just have to guess.`;
  }

  private _generateJokeStream(
    params: {
      context: "answer_roast";
      question?: string;
      userAnswer?: string;
      fillerAlreadySaid?: string;
      jokesAlreadyDelivered?: string[];
      conversationSoFar?: string[];
      knownFacts?: string[];
      maxJokes?: number;
      imageBase64?: string;
    },
    onJoke: (joke: JokeItem) => void,
    onMeta: (meta: {
      relevant: boolean;
      redirect?: string;
      tags?: string[];
      callback?: { text: string; motion: string; intensity: number };
    }) => void,
    onError: () => void,
    signal?: AbortSignal,
    /** deliveryGeneration snapshot from the caller — used to short-circuit
     *  the SSE handler when a barge-in / watchdog fires and the caller has
     *  already moved on. Without this, buffered SSE chunks open new audio
     *  sinks via openJokeStream() that play seconds after the canned
     *  fallback already landed. */
    gen?: number,
  ): void {
    const streamingTtsEnabled = !!this.deps.openJokeStream;
    const baseVoiceSettings = streamingTtsEnabled ? this.deps.getVoiceSettings?.() : undefined;
    /** Per-joke audio sinks, keyed by index from the server SSE stream. */
    const jokeSinks: Map<number, JokeStreamSink> = new Map();
    /** Whether the brain has emitted a transcript entry for this joke yet. */
    const jokeAppendState: Map<number, boolean> = new Map();
    let jokesSeen = 0;

    // Debug LLM log: legible record of what we're asking for.
    {
      const bits: string[] = [];
      if (params.question) bits.push(`Q:"${params.question}"`);
      if (params.userAnswer) bits.push(`A:"${params.userAnswer}"`);
      this.deps.logLlm?.("→", params.context, bits.join(" ") || "(streaming roast)");
    }

    fetch("/api/generate-speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Watchdog-owned signal — lets the generation watchdog abort a hung request so the
      // brain can fall back instead of stranding the user in silence. Undefined on the
      // pipeline path, which is fine (short-lived, has its own drain handling).
      signal,
      body: JSON.stringify({
        ...params,
        model: this.deps.getRoastModel(),
        experienceType: this._getExperienceType(),
        sessionId: this.deps.getSessionId(),
        persona: this.deps.getPersona(),
        burnIntensity: this.deps.getBurnIntensity(),
        contentMode: this.deps.getContentMode(),
        ambientContext: this.deps.getAmbientContext() ?? undefined,
        ambientAntiRepeatNote: this._ambientAntiRepeatNote(),
        townFlavor: this.deps.getTownFlavor()?.trim() || undefined,
        streamingTts: streamingTtsEnabled,
        baseVoiceSettings,
      }),
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) {
          if (resp.status === 402) {
            const body = await resp.json().catch(() => ({ provider: "unknown" }));
            const provider = (body as { provider?: string }).provider ?? "unknown";
            this.deps.setError?.(`${provider} credits exhausted — add billing or switch models`);
            this.deps.logTiming(`brain: QUOTA ERROR from ${provider}`);
          }
          onError();
          return;
        }

        let metaSeen = false;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (event: { type: string; [key: string]: unknown }): boolean => {
          // Stale stream — the brain has moved on (barge-in / watchdog fired).
          // Cancel any sinks already opened (they were enqueued into the TTS
          // chain) and stop processing further events so we don't queue audio
          // that the user shouldn't hear.
          if (gen !== undefined && this.deliveryGeneration !== gen) {
            if (jokeSinks.size > 0) {
              for (const s of jokeSinks.values()) s.cancel();
              jokeSinks.clear();
            }
            return true; // signal caller to stop reading more SSE chunks
          }
          if (event.type === "joke-meta" && streamingTtsEnabled) {
            // Server opened EL WS — open a sink on our side to absorb audio.
            const index = (event.index as number) ?? 0;
            const motion = (event.motion as string) ?? "idle";
            const intensity = (event.intensity as number) ?? 0.7;
            const appendToPrev = index > 0;
            jokeAppendState.set(index, appendToPrev);
            try {
              const sink = this.deps.openJokeStream!(
                motion as MotionState,
                intensity,
                { appendToPrev },
              );
              jokeSinks.set(index, sink);
            } catch (err) {
              console.error("[brain] openJokeStream failed:", err);
            }
          } else if (event.type === "audio" && streamingTtsEnabled) {
            const index = (event.index as number) ?? 0;
            const chunk = event.chunk as string | undefined;
            const sink = jokeSinks.get(index);
            if (sink && chunk) sink.pushAudio(chunk);
          } else if (event.type === "audio-end" && streamingTtsEnabled) {
            // EL has finished producing audio for this joke. Close the buffer
            // so the playback chain can advance. Transcript was already
            // recorded when the `joke` event arrived earlier.
            const index = (event.index as number) ?? 0;
            const sink = jokeSinks.get(index);
            if (sink) {
              sink.endAudio();
              jokeSinks.delete(index);
            }
          } else if (event.type === "joke") {
            const joke = event as unknown as JokeItem & { index?: number };
            this.deps.logLlm?.("←", "joke", joke.text);
            // Streaming path: record transcript now (LLM has all the text),
            // but DO NOT close the audio buffer — EL is still synthesizing.
            // The buffer is closed by the `audio-end` event above.
            if (streamingTtsEnabled) {
              const idx = joke.index ?? jokesSeen;
              const sink = jokeSinks.get(idx);
              if (sink) sink.finalize(joke.text);
            }
            // Either path: still notify the caller so brain bookkeeping
            // (jokesAlreadyDelivered, ledger, etc.) runs.
            onJoke(joke);
            jokesSeen++;
          } else if (event.type === "error" && event.error === "quota_exceeded") {
            const provider = (event.provider as string) ?? "unknown";
            this.deps.setError?.(`${provider} credits exhausted — add billing or switch models`);
            this.deps.logTiming(`brain: QUOTA ERROR from ${provider} (stream)`);
            // Cancel any in-flight sinks so playback unblocks.
            for (const s of jokeSinks.values()) s.cancel();
            jokeSinks.clear();
            onError();
            return true;
          } else if (event.type === "meta") {
            metaSeen = true;
            onMeta(
              event as unknown as {
                relevant: boolean;
                redirect?: string;
                tags?: string[];
                callback?: { text: string; motion: string; intensity: number };
              },
            );
          }
          return false;
        };

        const parseLines = (lines: string[]): boolean => {
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as { type: string; [key: string]: unknown };
              if (handleEvent(event)) return true;
            } catch {
              // malformed SSE line
            }
          }
          return false;
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (parseLines(lines)) return;
        }

        if (buffer.trim() && parseLines(buffer.split("\n"))) return;

        // Safety net: SSE ended but some sinks never received audio-end (EL
        // hung or server dropped the event). Close them so the playback
        // chain can advance instead of waiting forever.
        if (jokeSinks.size > 0) {
          this.deps.logTiming(
            `brain: stream ended with ${jokeSinks.size} sink(s) still open — closing`,
          );
          for (const s of jokeSinks.values()) s.endAudio();
          jokeSinks.clear();
        }

        if (!metaSeen) {
          this.deps.logTiming("brain: generate-speak stream ended without meta — synthesizing");
          onMeta({ relevant: true });
        }
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          console.error("[brain] generate-speak error:", e);
        }
        // Cancel any open sinks so playback doesn't stall.
        for (const s of jokeSinks.values()) s.cancel();
        jokeSinks.clear();
        onError();
      });
  }

  private async _generateJoke(
    params: {
      context: "greeting" | "rapid_fire_greeting" | "vision_opening" | "answer_roast" | "vision_react" | "hopper" | "wrapup";
      /** Override the roast model for this request (e.g. Gemini Flash for vision-reactive jokes). */
      model?: string;
      question?: string;
      userAnswer?: string;
      fillerAlreadySaid?: string;
      jokesAlreadyDelivered?: string[];
      observations?: string[];
      previousObservations?: string[];
      conversationSoFar?: string[];
      knownFacts?: string[];
      maxJokes?: number;
      imageBase64?: string;
    },
    signal?: AbortSignal,
  ): Promise<JokeResponse | null> {
    try {
      {
        const bits: string[] = [];
        if (params.question) bits.push(`Q:"${params.question}"`);
        if (params.userAnswer) bits.push(`A:"${params.userAnswer}"`);
        if (params.observations?.length) bits.push(`sees: ${params.observations.slice(0, 4).join(", ")}`);
        this.deps.logLlm?.("→", params.context, bits.join(" ") || "(generate)");
      }
      const resp = await fetch("/api/generate-joke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.deps.getRoastModel(),
          ...params,
          experienceType: this._getExperienceType(),
          sessionId: this.deps.getSessionId(),
          persona: this.deps.getPersona(),
          burnIntensity: this.deps.getBurnIntensity(),
          contentMode: this.deps.getContentMode(),
          setting: this.deps.getVisionSetting(),
          ambientContext: this.deps.getAmbientContext() ?? undefined,
          ambientAntiRepeatNote: this._ambientAntiRepeatNote(),
          townFlavor: this.deps.getTownFlavor()?.trim() || undefined,
        }),
        signal,
      });
      if (!resp.ok) {
        if (resp.status === 402) {
          const body = await resp.json().catch(() => ({ provider: "unknown" }));
          const provider = (body as { provider?: string }).provider ?? "unknown";
          this.deps.setError?.(`${provider} credits exhausted — add billing or switch models`);
          this.deps.logTiming(`brain: QUOTA ERROR from ${provider}`);
        } else if (resp.status === 503) {
          const body = await resp.json().catch(() => ({}));
          const b = body as { error?: string; failedModel?: string; suggestedFallback?: string };
          if (
            b.error === "model_unavailable" &&
            b.failedModel &&
            b.suggestedFallback &&
            !this.modelUnavailableFired
          ) {
            this.modelUnavailableFired = true;
            this.deps.logTiming(
              `brain: MODEL_UNAVAILABLE ${b.failedModel} → suggest ${b.suggestedFallback}`,
            );
            this.deps.onModelUnavailable?.(b.failedModel, b.suggestedFallback);
          }
        }
        return null;
      }
      const json = (await resp.json()) as JokeResponse;
      const firstText = json.jokes?.[0]?.text;
      if (firstText) this.deps.logLlm?.("←", params.context, firstText);
      return json;
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("[brain] generate-joke error:", e);
      }
      return null;
    }
  }
}
