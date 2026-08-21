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

/** The name turn does not need an LLM to invent a neutral reaction. Building
 * the old “Tyler, huh...” beat directly from the repaired answer removes a
 * model round-trip while retaining the same fail-closed evidence validation. */
export function deterministicNameBridge(answer: string): string | null {
  const normalized = answer
    .trim()
    .replace(/[.?!,]+$/g, "")
    .trim();
  const nameToken = "([\\p{L}][\\p{L}'’\\-]{1,19})";
  // Full-string matches only. Capturing the first token of a longer phrase
  // turned “I'm not sure” into “not, huh...”, which reinforced uncertainty as
  // a fact. Multiword or dangling material must use the neutral cache instead.
  const introduced = normalized.match(new RegExp(
    `^(?:my name is|my name['’]s|call me|this is|i['’]m|i am|it['’]s|it is)\\s+${nameToken}$`,
    "iu",
  ));
  const direct = normalized.match(new RegExp(`^${nameToken}$`, "iu"));
  const firstName = introduced?.[1] ?? direct?.[1] ?? "";
  if (!/^[\p{L}][\p{L}'’\-]{1,19}$/u.test(firstName)) return null;
  if (/^(?:a|an|the|not|no|none|is|are|am|it|this|that|what|who|why|how|yes|yeah|yep|okay|sorry|sure|unsure|maybe|unknown|uh|um|huh)$/i.test(firstName)) {
    return null;
  }
  const candidate = `${firstName}, huh...`;
  return validateConversationBridge(candidate, { answer }) ? candidate : null;
}
