const BRIDGE_WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

const APPROVED_ENDINGS = [
  ["thrilling", "stuff"],
  ["oh", "marvelous"],
  ["i", "see"],
  ["alright"],
  ["okay"],
  ["huh"],
] as const;

const JOKE_OR_QUESTION_RE = /\?|\b(?:because|bet|clearly|disaster|embarrassing|idiot|imagine|joke|loser|pathetic|punchline|roast|tragic|what|when|where|which|who|why)\b/i;

function words(text: string): string[] {
  return (text.match(BRIDGE_WORD_RE) ?? []).map((word) => word.toLowerCase());
}

function normalizeBridgeCandidate(text: string): string {
  return text
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*(?:bridge|response|acknowledgement|ack)\s*:\s*/i, "")
    .replace(/^\s*["“]|["”]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function endsWithWords(candidate: string[], ending: readonly string[]): boolean {
  if (ending.length > candidate.length) return false;
  const offset = candidate.length - ending.length;
  return ending.every((word, index) => candidate[offset + index] === word);
}

function containsContiguousWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_, start) =>
    start + needle.length <= haystack.length &&
    needle.every((word, index) => haystack[start + index] === word));
}

/**
 * Validate a dynamic bridge before any of it reaches TTS. Content words must
 * come from the repaired answer / established facts; everything else must be
 * low-information acknowledgement vocabulary. This deliberately fails closed
 * to the cached neutral clip.
 */
export function validateConversationBridge(
  candidate: string,
  evidence: { answer: string; knownFacts?: string[] },
): string | null {
  const text = normalizeBridgeCandidate(candidate);
  if (!text || /[\[\]{}<>]/.test(text) || JOKE_OR_QUESTION_RE.test(text)) return null;

  const candidateWords = words(text);
  if (candidateWords.length < 2 || candidateWords.length > 9) return null;

  const ending = APPROVED_ENDINGS.find((approved) => endsWithWords(candidateWords, approved));
  if (!ending) return null;

  const echoedWords = candidateWords.slice(0, -ending.length);
  // A two-word approved acknowledgement such as "I see" is safe by itself.
  if (echoedWords.length === 0) return ending.length >= 2 ? text : null;

  // Require the entire echoed phrase to occur verbatim and contiguously in one
  // evidence item. A bag-of-words check could turn separate facts like
  // "Tyler" and "Seattle" into the invented relationship "Tyler from Seattle."
  const evidenceItems = [evidence.answer, ...(evidence.knownFacts ?? [])].map(words);
  return evidenceItems.some((item) => containsContiguousWords(item, echoedWords)) ? text : null;
}

export function bridgeWordCount(text: string): number {
  return words(text).length;
}
