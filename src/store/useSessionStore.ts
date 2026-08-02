import { create } from "zustand";
import type { MotionState } from "@/lib/stateMachine";
import type { BurnIntensity } from "@/lib/prompts";
import { DEFAULT_PERSONA, type PersonaId } from "@/lib/personaMetadata";
import type { BrainState } from "@/lib/stateMachine";
import type { RoastModelId } from "@/lib/modelCatalog";
import {
  transition,
  SESSION_TRANSITIONS,
  type SessionPhase,
  type SessionTrigger,
} from "@/lib/stateMachine";

export type ContentMode = "clean" | "vulgar";

/**
 * Top-level puppet the user picks from the Puppet Line carousel. Roastie maps to
 * the standard roast experience; Toastie maps to a drunk woman at a wedding mic
 * giving a toast to the user, who she's pretending she knows. Same brain state
 * machine, different question bank, prompts, scripted lines, voice, and puppet
 * palette.
 *
 * In "toast": persona is ignored (one character).
 */
export type ExperienceType = "roast" | "toast";

export type { RoastModelId } from "@/lib/modelCatalog";

/**
 * Pick a DIFFERENT model to suggest when the current one is in trouble (hung or
 * unavailable). Crosses providers on purpose: a Gemini outage routes to OpenAI
 * and vice-versa, so the suggested restart isn't likely to hit the same outage.
 */
export function pickDifferentModel(failed: RoastModelId): RoastModelId {
  if (failed.startsWith("gpt")) return "gemini-3.6-flash";
  if (failed.startsWith("claude")) return "gemini-3.6-flash";
  // Gemini (or anything else) → OpenAI.
  return "gpt-5.6-terra";
}

/**
 * Surfaced when a Gemini model returns 503 UNAVAILABLE ("high demand").
 * UI shows a prompt offering to swap to a healthy fallback and restart.
 */
export interface ModelUnavailableInfo {
  failedModel: string;
  suggestedFallback: string;
}

export interface VoiceSettings {
  stability: number;        // 0-1
  similarity_boost: number; // 0-1
  style: number;            // 0-1
  speed: number;            // 0.7-1.2 (Flash v2.5)
  use_speaker_boost: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.5,
  style: 1,
  speed: 1.0,
  use_speaker_boost: true,
};

/**
 * Toastie deliberately uses the exact same synthesis profile as Roastie. The
 * previous low-stability, slowed-down "drunk" profile dipped to the ElevenLabs
 * stability floor after motion deltas and sounded scratchy/warbled in real
 * Android sessions. Character comes from the distinct voice and writing, not
 * degraded synthesis quality.
 */
export const TOAST_VOICE_SETTINGS: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };

/** Ambient context derived from geolocation — time-of-day, weather, city. */
export interface AmbientContext {
  city: string;
  region: string;
  timeOfDay: string; // "late night", "early morning", "morning", "afternoon", "evening", "night"
  localTime: string; // "2:30 AM", "11:15 PM" etc
  weather?: string;  // "clear skies", "raining", "overcast", etc
  tempF?: number;
  tempC?: number;
}

export type ConversationEventType = "user-start" | "user-end" | "ai-speech" | "ai-done" | "interrupted" | "listening" | "rotate" | "user-laugh";

export type TimelineRow = "user" | "gemini" | "tts" | "vision" | "session";

export const TIMELINE_ROW_COLORS: Record<TimelineRow, string> = {
  user: "#22d3ee",
  gemini: "#fb923c",
  tts: "#a78bfa",
  vision: "#60a5fa",
  session: "#94a3b8",
};

export interface TimelineSpan {
  id: string;
  row: TimelineRow;
  label: string;
  startTs: number;
  endTs: number | null;
  color: string;
}

export interface ConversationEvent {
  type: ConversationEventType;
  text?: string;
  ts: number;
}

// SessionPhase is now defined in @/lib/stateMachine/sessionPhase.ts
// Re-export for backwards compatibility
export type { SessionPhase } from "@/lib/stateMachine";

export type SessionMode = "monologue" | "conversation";

export interface RoastSentence {
  text: string;
  motion: MotionState;
  intensity: number;
}

interface SessionState {
  phase: SessionPhase;
  sessionMode: SessionMode;
  /** When true (legacy dev experiment), the session opens with an instant per-persona canned
   *  video-call intro (no LLM greeting) that also asks who the user is —
   *  banks live in src/lib/comedians/*.ts. Roast experience only; dev
   *  checkbox on the landing screen can turn it off to compare. */
  cannedIntro: boolean;
  /** When true (default), the LLM generates every question (simple/closed style,
   *  aware of what's already been answered) instead of the fixed bank. Dev toggle
   *  on the landing screen can turn it off to compare against the bank. */
  llmQuestions: boolean;
  experienceType: ExperienceType;
  burnIntensity: BurnIntensity;
  contentMode: ContentMode;
  roastModel: RoastModelId;
  /** Gemini model used for vision + greeting prefetch. Swapped together with
   *  roastModel when the fallback prompt is accepted, since both default to
   *  the same Gemini Flash tier. */
  visionModel: string;
  /** Non-null when a Gemini model returned 503 UNAVAILABLE. UI shows the
   *  fallback prompt; user accepts → swap models + restart session. */
  modelUnavailable: ModelUnavailableInfo | null;
  activePersona: PersonaId;
  isSpeaking: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  transcript: string;
  audioAmplitude: number; // 0-1 RMS from AnalyserNode
  activeMotionState: MotionState;
  motionIntensity: number; // 0-1
  lastSceneJson: string | null;
  recordedBlob: Blob | null;
  error: string | null;
  timingLog: string[];
  /** Legible LLM call/response log for the debug panel — "→" is what we asked the model,
   *  "←" is what came back (plain text, never JSON). */
  llmLog: { ts: number; dir: "→" | "←"; label: string; text: string }[];
  observations: string[];
  visionSetting: string | null; // best guess at user's location from background analysis
  locationConsent: boolean; // user opted in to share location
  ambientContext: AmbientContext | null; // time-of-day, weather, city from geolocation
  /** LLM blurbs local vibe/culture for roast fodder — filled async after geo resolves. */
  townFlavorBlurb: string | null;
  townFlavorRequested: boolean;
  conversationEvents: ConversationEvent[];
  timeToFirstSpeechMs: number | null;
  hasSpokenThisSession: boolean;
  puppetRevealed: boolean; // true once the first TTS audio chunk starts
  isEnding: boolean; // true while session is fading out — switches the puppet overlay to a fast fade-out duration
  lastVisionCallTs: number | null;

  // Comedian Brain state (conversation mode)
  brainState: BrainState | null;
  currentQuestion: string | null;
  userAnswer: string;
  voiceSettings: VoiceSettings;
  isUserLaughing: boolean; // vision-based: set when observations contain laugh keywords
  isUserSmiling: boolean;  // vision-based: set when observations contain smile keywords
  laughCount: number;       // total laugh detections this session
  smileFrames: number;      // vision frames where smile was detected
  totalVisionFrames: number; // total vision frames this session

  // Transcript history for debug panel.
  // groupId clusters jokes from the same delivery batch — UI renders them as one
  // paragraph while keeping per-joke ratings.
  transcriptHistory: { role: "user" | "puppet"; text: string; ts: number; groupId: string }[];
  jokeRatings: Record<number, "up" | "down">; // keyed by transcript entry ts

  // Session timer — set when phase enters "roasting"
  sessionStartTs: number | null;
  setSessionStartTs: (ts: number | null) => void;

  // Debug: type a response instead of speaking (consumed by LiveSessionController)
  pendingDebugTranscription: string | null;
  submitDebugTranscription: (text: string) => void;
  clearPendingDebugTranscription: () => void;

  // Dev voice notes: gesture-triggered recording
  pendingDevNoteResume: boolean;
  requestDevNoteResume: () => void;
  clearPendingDevNoteResume: () => void;
  devNoteCount: number;
  incrementDevNoteCount: () => void;

  // actions
  setPhase: (phase: SessionPhase, trigger: SessionTrigger) => void;
  setSessionMode: (mode: SessionMode) => void;
  setCannedIntro: (v: boolean) => void;
  setLlmQuestions: (v: boolean) => void;
  setExperienceType: (type: ExperienceType) => void;
  setBurnIntensity: (intensity: BurnIntensity) => void;
  setContentMode: (mode: ContentMode) => void;
  setRoastModel: (model: RoastModelId) => void;
  setVisionModel: (model: string) => void;
  setModelUnavailable: (info: ModelUnavailableInfo | null) => void;
  /** Apply the suggested fallback to both roastModel and visionModel, then
   *  clear modelUnavailable. UI calls setPhase("idle") after to drop the
   *  user back to the landing screen for a clean restart. */
  acceptModelFallback: () => void;
  setActivePersona: (persona: PersonaId) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setIsUserSpeaking: (speaking: boolean) => void;
  setTranscript: (text: string) => void;
  setAudioAmplitude: (amplitude: number) => void;
  setActiveMotionState: (state: MotionState, intensity: number) => void;
  setLastSceneJson: (json: string) => void;
  setRecordedBlob: (blob: Blob) => void;
  setError: (error: string | null) => void;
  logTiming: (entry: string) => void;
  clearTimingLog: () => void;
  pushLlmLog: (dir: "→" | "←", label: string, text: string) => void;
  clearLlmLog: () => void;
  setObservations: (obs: string[]) => void;
  setVisionSetting: (setting: string | null) => void;
  setLocationConsent: (consent: boolean) => void;
  setAmbientContext: (ctx: AmbientContext | null) => void;
  setTownFlavorBlurb: (text: string | null) => void;
  setTownFlavorRequested: (requested: boolean) => void;
  addConversationEvent: (type: ConversationEvent["type"], text?: string) => void;
  clearConversationEvents: () => void;
  setTimeToFirstSpeechMs: (ms: number | null) => void;
  setHasSpokenThisSession: (spoken: boolean) => void;
  setPuppetRevealed: (revealed: boolean) => void;
  setIsEnding: (isEnding: boolean) => void;
  setLastVisionCallTs: (ts: number | null) => void;
  setBrainState: (state: BrainState | null) => void;
  setCurrentQuestion: (q: string | null) => void;
  setUserAnswer: (ans: string) => void;
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void;
  setIsUserLaughing: (laughing: boolean) => void;
  setIsUserSmiling: (smiling: boolean) => void;
  incrementLaughCount: () => void;
  recordVisionFrame: (smiling: boolean) => void;
  pushTranscriptEntry: (role: "user" | "puppet", text: string, opts?: { append?: boolean }) => void;
  replaceLatestUserTranscript: (text: string) => void;
  timelineSpans: TimelineSpan[];
  beginSpan: (row: TimelineRow, label: string, color?: string) => string;
  endSpan: (id: string) => void;
  clearTimelineSpans: () => void;
  rateJoke: (ts: number, rating: "up" | "down") => void;
  clearTranscriptHistory: () => void;
  reset: () => void;
}

/** Production starts with the generated vision joke. The override remains for
 *  explicit experiments, but the legacy canned opener is off by default. */
const cannedIntroDefault: boolean = (() => {
  if (typeof window === "undefined") return false;
  const flag = (window as { __CANNED_INTRO_DEFAULT__?: unknown }).__CANNED_INTRO_DEFAULT__;
  return typeof flag === "boolean" ? flag : false;
})();

const initialState = {
  phase: "idle" as SessionPhase,
  sessionMode: "conversation" as SessionMode,
  cannedIntro: cannedIntroDefault,
  llmQuestions: true,
  experienceType: "roast" as ExperienceType,
  burnIntensity: 5 as BurnIntensity,
  contentMode: "clean" as ContentMode,
  roastModel: "gemini-3.6-flash" as RoastModelId,
  visionModel: "gemini-3.6-flash",
  modelUnavailable: null as ModelUnavailableInfo | null,
  activePersona: DEFAULT_PERSONA,
  isSpeaking: false,
  isListening: false,
  isUserSpeaking: false,
  transcript: "",
  audioAmplitude: 0,
  activeMotionState: "idle" as MotionState,
  motionIntensity: 0.3,
  lastSceneJson: null,
  recordedBlob: null,
  error: null,
  timingLog: [] as string[],
  llmLog: [] as { ts: number; dir: "→" | "←"; label: string; text: string }[],
  observations: [] as string[],
  visionSetting: null as string | null,
  locationConsent: true,
  ambientContext: null as AmbientContext | null,
  townFlavorBlurb: null as string | null,
  townFlavorRequested: false,
  conversationEvents: [] as ConversationEvent[],
  timeToFirstSpeechMs: null as number | null,
  hasSpokenThisSession: false,
  puppetRevealed: false,
  isEnding: false,
  lastVisionCallTs: null as number | null,
  brainState: null as BrainState | null,
  currentQuestion: null as string | null,
  userAnswer: "",
  voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
  isUserLaughing: false,
  isUserSmiling: false,
  laughCount: 0,
  smileFrames: 0,
  totalVisionFrames: 0,
  transcriptHistory: [] as { role: "user" | "puppet"; text: string; ts: number; groupId: string }[],
  jokeRatings: {} as Record<number, "up" | "down">,
  timelineSpans: [] as TimelineSpan[],
  sessionStartTs: null as number | null,
  pendingDebugTranscription: null as string | null,
  pendingDevNoteResume: false,
  devNoteCount: 0,
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setPhase: (phase, trigger) => {
    const current = useSessionStore.getState().phase;
    const event = transition(current, phase, SESSION_TRANSITIONS, trigger);
    if (!event) return;
    set({ phase });
  },
  setSessionMode: (sessionMode) => set({ sessionMode }),
  setCannedIntro: (cannedIntro) => set({ cannedIntro }),
  setLlmQuestions: (llmQuestions) => set({ llmQuestions }),
  setExperienceType: (experienceType) =>
    set((s) =>
      // Only reseed the voice when the experience actually changes — protects any
      // live VoiceSliders tweaks from being clobbered by a redundant set call.
      s.experienceType === experienceType
        ? { experienceType }
        : {
            experienceType,
            voiceSettings: {
              ...(experienceType === "toast" ? TOAST_VOICE_SETTINGS : DEFAULT_VOICE_SETTINGS),
            },
          },
    ),
  setBurnIntensity: (burnIntensity) => set({ burnIntensity }),
  setContentMode: (contentMode) => set({ contentMode }),
  setRoastModel: (roastModel) => set({ roastModel }),
  setVisionModel: (visionModel) => set({ visionModel }),
  setModelUnavailable: (modelUnavailable) => set({ modelUnavailable }),
  acceptModelFallback: () => set((s) => {
    const info = s.modelUnavailable;
    if (!info) return {};
    const fallback = info.suggestedFallback as RoastModelId;
    // Vision is Gemini-only (the /api/vision + /api/analyze routes call Gemini
    // directly). If the new roast model is a non-Gemini provider, keep vision on
    // a healthy Gemini tier rather than pointing it at gpt/claude.
    const visionModel = fallback.startsWith("gemini") ? fallback : "gemini-3.5-flash";
    return {
      modelUnavailable: null,
      roastModel: fallback,
      visionModel,
    };
  }),
  setActivePersona: (activePersona) => set({ activePersona }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setIsListening: (isListening) => set({ isListening }),
  setIsUserSpeaking: (isUserSpeaking) => set({ isUserSpeaking }),
  setTranscript: (transcript) => set({ transcript }),
  setAudioAmplitude: (audioAmplitude) => set({ audioAmplitude }),
  setActiveMotionState: (activeMotionState, motionIntensity) =>
    set({ activeMotionState, motionIntensity }),
  setLastSceneJson: (lastSceneJson) => set({ lastSceneJson }),
  setRecordedBlob: (recordedBlob) => set({ recordedBlob }),
  setError: (error) => set({ error }),
  logTiming: (entry) =>
    set((s) => {
      const rel = s.sessionStartTs !== null
        ? `+${((Date.now() - s.sessionStartTs) / 1000).toFixed(2)}s`
        : "--";
      const line = `${rel} ${entry}`;
      const next = [...s.timingLog.slice(-499), line];
      try { localStorage.setItem("roastie-timing-log", JSON.stringify(next)); } catch { /* ignore */ }
      return { timingLog: next };
    }),
  clearTimingLog: () => set({ timingLog: [] }),
  pushLlmLog: (dir, label, text) =>
    set((s) => ({
      llmLog: [...s.llmLog.slice(-299), { ts: Date.now(), dir, label, text: text.trim() }],
    })),
  clearLlmLog: () => set({ llmLog: [] }),
  setObservations: (observations) => set({ observations }),
  setVisionSetting: (visionSetting) => set({ visionSetting }),
  setLocationConsent: (locationConsent) => set({ locationConsent }),
  setAmbientContext: (ambientContext) => set({ ambientContext }),
  setTownFlavorBlurb: (townFlavorBlurb) => set({ townFlavorBlurb }),
  setTownFlavorRequested: (townFlavorRequested) => set({ townFlavorRequested }),
  addConversationEvent: (type, text) =>
    set((s) => ({
      conversationEvents: [
        ...s.conversationEvents.slice(-29),
        { type, text, ts: Date.now() },
      ],
    })),
  clearConversationEvents: () => set({ conversationEvents: [] }),
  setTimeToFirstSpeechMs: (timeToFirstSpeechMs) => set({ timeToFirstSpeechMs }),
  setHasSpokenThisSession: (hasSpokenThisSession) => set({ hasSpokenThisSession }),
  setPuppetRevealed: (puppetRevealed) => set({ puppetRevealed }),
  setIsEnding: (isEnding) => set({ isEnding }),
  setLastVisionCallTs: (lastVisionCallTs) => set({ lastVisionCallTs }),
  setBrainState: (brainState) => set({ brainState }),
  setCurrentQuestion: (currentQuestion) => set({ currentQuestion }),
  setUserAnswer: (userAnswer) => set({ userAnswer }),
  setVoiceSettings: (partial) => set((s) => ({ voiceSettings: { ...s.voiceSettings, ...partial } })),
  setIsUserLaughing: (isUserLaughing) => set({ isUserLaughing }),
  setIsUserSmiling: (isUserSmiling) => set({ isUserSmiling }),
  incrementLaughCount: () => set((s) => ({ laughCount: s.laughCount + 1 })),
  recordVisionFrame: (smiling) => set((s) => ({
    totalVisionFrames: s.totalVisionFrames + 1,
    smileFrames: s.smileFrames + (smiling ? 1 : 0),
  })),
  pushTranscriptEntry: (role, text, opts) =>
    set((s) => {
      const last = s.transcriptHistory[s.transcriptHistory.length - 1];
      const ts = Date.now();
      const groupId =
        opts?.append && last && last.role === role
          ? last.groupId
          : `g-${ts}-${Math.random().toString(36).slice(2, 8)}`;
      const next = [...s.transcriptHistory.slice(-199), { role, text, ts, groupId }];
      try { localStorage.setItem("roastie-transcript", JSON.stringify(next)); } catch { /* ignore */ }
      return { transcriptHistory: next };
    }),
  replaceLatestUserTranscript: (text) =>
    set((s) => {
      const index = s.transcriptHistory.findLastIndex((entry) => entry.role === "user");
      if (index < 0) return s;
      const next = [...s.transcriptHistory];
      next[index] = { ...next[index], text };
      try { localStorage.setItem("roastie-transcript", JSON.stringify(next)); } catch { /* ignore */ }
      return { transcriptHistory: next };
    }),
  beginSpan: (row, label, color) => {
    const id = `${row}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      timelineSpans: [
        ...s.timelineSpans.slice(-299),
        { id, row, label, startTs: Date.now(), endTs: null, color: color ?? TIMELINE_ROW_COLORS[row] },
      ],
    }));
    return id;
  },
  endSpan: (id) =>
    set((s) => ({
      timelineSpans: s.timelineSpans.map((span) =>
        span.id === id ? { ...span, endTs: Date.now() } : span
      ),
    })),
  clearTimelineSpans: () => set({ timelineSpans: [] }),
  rateJoke: (ts, rating) => {
    set((s) => ({ jokeRatings: { ...s.jokeRatings, [ts]: rating } }));
    // Find the joke text for this timestamp
    const entry = useSessionStore.getState().transcriptHistory.find(
      (e) => e.ts === ts && e.role === "puppet"
    );
    if (!entry) return;
    // Fire-and-forget save to feedback log
    fetch("/api/save-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "joke-rating",
        text: `${rating === "up" ? "👍" : "👎"} ${entry.text}`,
        persona: useSessionStore.getState().activePersona,
        lastJokeText: entry.text,
      }),
    }).catch(() => {});
  },
  clearTranscriptHistory: () => set({ transcriptHistory: [], jokeRatings: {} }),
  setSessionStartTs: (sessionStartTs) => set({ sessionStartTs }),
  submitDebugTranscription: (text) => set({ pendingDebugTranscription: text }),
  clearPendingDebugTranscription: () => set({ pendingDebugTranscription: null }),
  requestDevNoteResume: () => set({ pendingDevNoteResume: true }),
  clearPendingDevNoteResume: () => set({ pendingDevNoteResume: false }),
  incrementDevNoteCount: () => set((s) => ({ devNoteCount: s.devNoteCount + 1 })),
  reset: () => set(initialState),
}));
