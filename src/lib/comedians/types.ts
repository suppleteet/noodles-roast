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
 * - fillers → short "thinking" lines spoken (not LLM-generated) to cover the
 *   1-4s while a roast is being written, so there's never dead air. Not injected
 *   into the prompt. Keep them a few words long and lead with a soft/voiced
 *   sound (a vowel, an "Mm/Oh/Yeah" hum) — the breath beat before each is added
 *   in code, so don't bake in a leading "...". (Toast has its own pool.)
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
  cannedIntros: CannedIntros;
  /** Short "thinking" filler lines spoken while a roast is being written
   *  (covers LLM latency so there's no dead air). Spoken verbatim, not sent to
   *  the LLM. See the field docs above for the soft-onset / no-leading-"..." rule. */
  fillers: string[];
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
