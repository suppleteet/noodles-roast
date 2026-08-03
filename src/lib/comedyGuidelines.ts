/**
 * Distilled comedy guidelines learned from audience feedback.
 *
 * GLOBAL_COMEDY_GUIDELINES apply to all personas. Character-only rules live
 * beside the rest of that character in src/lib/comedians/*.ts (`jokeRules`).
 *
 * Keep the list short so system prompts stay focused.
 */

export const GLOBAL_COMEDY_GUIDELINES: string[] = [
  "Questions should feel like a comedian setting up a roast, not a job interview; avoid earnest prompts like 'What are you most proud of?' in favor of questions that naturally produce roastable answers",
  "Prefer one specific premise with a hard turn over broad insult soup; the funniest line usually names a concrete detail, then twists it",
  "Avoid reusable openers like 'you look like', 'of course', and 'classic' unless the comparison is fresh and specific",
  "When delivering two jokes in one answer, make the second a topper that escalates the first instead of restarting the setup",
  "Mean-generic doesn't land ('you miserable bastard', 'pale screen-lit complexion'); the laugh comes from an observation so specific the target recognizes themselves in it — earn the meanness with accuracy first",
];

/**
 * Returns a formatted guidelines block ready for system prompt injection.
 * Returns empty string if no guidelines exist.
 */
export function getComedyGuidelinesBlock(): string {
  if (GLOBAL_COMEDY_GUIDELINES.length === 0) return "";
  return GLOBAL_COMEDY_GUIDELINES.map((g) => `- ${g}`).join("\n");
}
