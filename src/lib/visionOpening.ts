import type { VisionOpeningConfig } from "@/lib/comedians/types";

/** Roastie's first visual line begins in a controlled, conversational register. */
export const ROAST_VISION_OPENING_MOTION = "deadpan" as const;
export const ROAST_VISION_OPENING_INTENSITY = 0.45;

const CALM_ARRIVAL_RE = /^(?:well(?:[,.! ]+well)?[,.! ]+)?hello\b|^hey(?:\s+there)?\b|^oh[,.! ]+(?:hi|hello)\b|^hi(?:\s+there)?\b|^wow[,.! ]+look at you[-—– ]+hello\b/i;

/**
 * Prompts are the primary control. This narrow fallback protects the first
 * impression if a model returns only a visual punchline despite that rule.
 */
export function ensureVisionOpeningArrival(text: string, opening: VisionOpeningConfig): string {
  const trimmed = text.trim();
  const fallbackArrival = opening.fallbackArrival.trim();
  if (!fallbackArrival) return trimmed;
  if (!trimmed) return fallbackArrival;
  return CALM_ARRIVAL_RE.test(trimmed)
    ? trimmed
    : `${fallbackArrival} ${trimmed}`;
}
