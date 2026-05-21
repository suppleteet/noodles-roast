/**
 * Vision observation diff — detects interesting changes between two observation sets.
 *
 * Used by ComedianBrain in check_vision to decide whether to interrupt the Q&A
 * flow with a vision_react moment.
 */

/** Keywords that make an observation automatically "interesting" — keep tight to avoid
 *  vision_react firing every cycle. Removed "moved", "changed", "different" (too broad). */
const HIGH_INTEREST_KEYWORDS = [
  "laugh", "smiling", "crying", "upset",
  "new person", "someone else", "another person", "walked in",
  "pet", "dog", "cat", "animal",
  "phone", "eating", "drinking",
  "hat", "glasses",
];

/** Fuzzy substring match — observation b is "similar" to a if either contains the other */
function isSimilar(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la.includes(lb) || lb.includes(la)) return true;

  const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "has", "have", "with", "and", "to", "of", "in",
    "on", "at", "looking", "wearing", "slightly",
  ]);
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .split(/[^a-z0-9]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    );

  const ta = tokenize(la);
  const tb = tokenize(lb);
  if (ta.size === 0 || tb.size === 0) return false;

  let shared = 0;
  for (const token of ta) {
    if (tb.has(token)) shared++;
  }
  if (shared === 0) return false;
  if (shared >= 2) return true;
  // Treat one-token overlap as similar when one side is a short phrase ("full beard" vs "has a beard")
  return ta.size <= 2 || tb.size <= 2;
}

export interface VisionDiffResult {
  isInteresting: boolean;
  changes: string[];
}

/** Observation traits that give the model something specific to roast.
 *  Generic appearance lines ("wearing black t-shirt", "thoughtful expression")
 *  get filtered behind these in `trimObservations`. */
const HIGH_VALUE_OBS_PATTERNS = [
  /\b(laugh|smil|grin|cry|wince|frown|sigh|grimac)/i,
  /\b(beard|glasses|hat|hood|cap|piercing|tattoo|earring|jewelry)/i,
  /\b(pet|dog|cat|child|kid|baby|partner|friend|person)/i,
  /\b(phone|laptop|drink|food|cup|bottle|book|controller|microphone|camera)/i,
  /\b(window|sunlight|dark|lit|messy|cluttered|empty|bare)/i,
];

/** Cap observations to `max` (default 4), prioritising high-value lines
 *  (expressions, props, people, room cues) over generic appearance. Drops
 *  observations that just restate `setting` (e.g. "home office setting" when
 *  setting is already "home office"). */
export function trimObservations(
  observations: string[],
  setting?: string | null,
  max = 4,
): string[] {
  const settingTokens = (setting ?? "")
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 4);
  const isJustSetting = (obs: string): boolean => {
    if (settingTokens.length === 0) return false;
    const lower = obs.toLowerCase();
    return settingTokens.every((t) => lower.includes(t)) && lower.length < 30;
  };
  const filtered = observations.filter((o) => !isJustSetting(o));
  const scored = filtered.map((o, i) => ({
    obs: o,
    score: HIGH_VALUE_OBS_PATTERNS.some((re) => re.test(o)) ? 1 : 0,
    originalIndex: i,
  }));
  // Stable sort: high-value first, ties broken by original order.
  scored.sort((a, b) => (b.score - a.score) || (a.originalIndex - b.originalIndex));
  return scored.slice(0, max).map((s) => s.obs);
}

/**
 * Compare two sets of vision observations.
 * Returns { isInteresting, changes } where changes are observations in `current`
 * that don't appear in `prev`.
 */
export function diffObservations(
  prev: string[],
  current: string[],
): VisionDiffResult {
  if (current.length === 0) return { isInteresting: false, changes: [] };

  const changes: string[] = [];
  for (const obs of current) {
    const alreadySeen = prev.some((p) => isSimilar(p, obs));
    if (!alreadySeen) {
      changes.push(obs);
    }
  }

  // High-interest if any new observation matches a keyword
  const hasHighInterest = changes.some((c) => {
    const cl = c.toLowerCase();
    return HIGH_INTEREST_KEYWORDS.some((kw) => cl.includes(kw));
  });

  // Also interesting if 4+ genuinely new observations (high bar to avoid constant vision interrupts)
  const isInteresting = hasHighInterest || changes.length >= 4;

  return { isInteresting, changes };
}
