import type { MotionState } from "@/lib/motionStates";
import type { PersonaId } from "@/lib/personaMetadata";

/**
 * Full character definition for one comedian. Each comedian lives in its own
 * file in this directory — edit that file to change everything about how the
 * comedian talks, jokes, and moves.
 *
 * How each field reaches the LLM / app:
 * - comedyApproach, roastTechniques, toneDescription, sentenceGuidance,
 *   antiPatterns, avoidTopics → injected into the system prompt for every
 *   joke/greeting/question generation (assembled in src/lib/prompts.ts).
 * - motionPreferences → listed in the prompt as the character's preferred
 *   body language AND drives per-line voice prosody (voiceMotionPresets.ts).
 * - cannedIntros → instant video-call opener pool, spoken (not LLM-generated)
 *   when the cannedIntro toggle is on. Every line must END by asking who the
 *   user is or telling them to give their name — the opener doubles as the
 *   name question.
 * - fillers → brief, low-information conversational backchannels spoken
 *   (not LLM-generated) to cover the 1-4s while a roast is being written. They
 *   acknowledge without evaluating, paraphrasing, or sounding like a reply.
 *   Lead with a soft/voiced sound (an "Mm/Oh/Yeah" hum) — the breath beat is added
 *   in code, so don't bake in a leading "...". (Toast has its own pool, in
 *   toastPrompts.ts.)
 * - echoFillers → occasional active-listening templates for the first filler.
 *   Eligibility and cadence are guarded centrally by ComedianBrain.
 * - visionOpening → the first 2-6 spoken words before the opening visual
 *   roast. `arrivalInstruction` is sent to the LLM for that one turn and
 *   `fallbackArrival` is spoken only when the model omits an arrival beat.
 * - jokeRules → character-specific LLM rules beyond the shared comedy policy.
 * - scriptedLines → spoken recovery lines used only when generation fails;
 *   these stay in the comedian's voice without constraining normal freeform
 *   joke generation.
 * - energy → reserved metadata, not currently injected.
 *
 * View the fully-assembled prompt at /api/debug-prompt?persona=<id>.
 */
export interface PersonaConfig {
  id: PersonaId;
  name: string;
  energy: "low" | "medium" | "high" | "escalating";
  comedyApproach: string;
  roastTechniques: string[];
  toneDescription: string;
  sentenceGuidance: string;
  antiPatterns: string[];
  /** Persona-specific topics to avoid, merged with GLOBAL_AVOID_TOPICS at prompt build time */
  avoidTopics?: string[];
  motionPreferences: MotionState[];
  /** The calm first beat before this comedian's opening visual roast. */
  visionOpening: VisionOpeningConfig;
  /** Character-specific LLM rules beyond the shared comedy policy. */
  jokeRules: string[];
  /** Character-specific spoken lines used only when normal generation fails. */
  scriptedLines: PersonaScriptedLines;
  cannedIntros: CannedIntros;
  /** Short "thinking" filler lines spoken while a roast is being written
   *  (covers LLM latency so there's no dead air). Spoken verbatim, not sent to
   *  the LLM. See the field docs above for the soft-onset / no-leading-"..." rule. */
  fillers: string[];
  /** Echo-style fillers: repeat the user's answer back once as active listening,
   *  then bridge into the joke. Every entry MUST contain the "{answer}" token.
   *  See the field docs above. */
  echoFillers: string[];
}

/**
 * Persona-owned controls for the first spoken line after a caller connects.
 * Keep the arrival concise and natural; the visual roast follows immediately.
 */
export interface VisionOpeningConfig {
  /** Prompt instruction used only while generating the first vision roast. */
  arrivalInstruction: string;
  /** Spoken verbatim only if the model returns a bare visual punchline. */
  fallbackArrival: string;
}

/** Short, verbatim recovery speech. These are never used for normal LLM jokes. */
export interface PersonaScriptedLines {
  /** Used when a vision-opening generation returns no usable joke. */
  greetingFallback: string;
  /** Used when an answer-roast generation fails; lines rotate without repeats. */
  answerFallbackRoasts: string[];
  /** Used when the model fails long enough that the caller must choose how to proceed. */
  technicalDifficulties: string[];
}

/** One pool of canned video-call intro lines. `early` (5-9am) and `late`
 *  (10pm-4am) add time-of-day flavor; `anytime` is the main pool. */
export interface CannedIntroBank {
  anytime: string[];
  early: string[];
  late: string[];
}

/** Per-persona canned intro pools, one per content mode. */
export interface CannedIntros {
  clean: CannedIntroBank;
  vulgar: CannedIntroBank;
}

/** Pick a canned intro for the user's local hour. When an early-morning (5-9)
 *  or late-night (22-4) bucket applies, there's a 50% chance of using a
 *  time-flavored line; otherwise (and the other 50%) it's the anytime pool.
 *  `rand` is injectable for tests. */
export function pickCannedIntro(
  intros: CannedIntros,
  hour: number,
  vulgar: boolean,
  rand: () => number = Math.random,
): string {
  const bank = vulgar ? intros.vulgar : intros.clean;
  const timed =
    hour >= 5 && hour < 10 ? bank.early : hour >= 22 || hour < 5 ? bank.late : null;
  if (timed && timed.length > 0 && rand() < 0.5) {
    return timed[Math.floor(rand() * timed.length)];
  }
  // Pools should never be empty (test-enforced per persona), but a new persona
  // with a sparse bank must not crash the instant-opener path — fall back to
  // the other buckets, then to a neutral line. The opener MUST still end with
  // an identity ask (it doubles as the name question).
  const pool = bank.anytime.length > 0 ? bank.anytime : [...bank.early, ...bank.late];
  if (pool.length === 0) return "Well, look at that — it connected. Who am I talking to?";
  return pool[Math.floor(rand() * pool.length)];
}
