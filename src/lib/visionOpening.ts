/**
 * The first spoken beat of a Puppet Line call. Keep this distinct from the
 * roast itself: the caller should hear that the puppet has arrived before the
 * first visual punchline lands.
 */
export const VISION_OPENING_ARRIVAL_RULE = `## Arrival Beat (HARD)
Your very first spoken words must be a brief, calm, natural greeting before the visual roast.
Use 2-6 words such as "Well, hello.", "Hey there.", or "Wow, look at you—hello."
The greeting may carry gentle character attitude, but it must not be shouted, highly aggressive,
or a punchline. After that short beat, pivot directly into the specific visual observation.`;

/** Roastie's first visual line begins in a controlled, conversational register. */
export const ROAST_VISION_OPENING_MOTION = "deadpan" as const;
export const ROAST_VISION_OPENING_INTENSITY = 0.45;

const CALM_ARRIVAL_RE = /^(?:well[,.! ]+)?hello\b|^hey(?:\s+there)?\b|^oh[,.! ]+hi\b|^wow[,.! ]+look at you[-—– ]+hello\b/i;
const FALLBACK_ARRIVAL = "Well, hello.";

/**
 * Prompts are the primary control. This narrow fallback protects the first
 * impression if a model returns only a visual punchline despite that rule.
 */
export function ensureVisionOpeningArrival(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return FALLBACK_ARRIVAL;
  return CALM_ARRIVAL_RE.test(trimmed)
    ? trimmed
    : `${FALLBACK_ARRIVAL} ${trimmed}`;
}
