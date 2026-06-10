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
 * - greetings → canned greeting pool (fallbacks only; greetings are normally
 *   LLM-generated).
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
  greetings: string[];
}
