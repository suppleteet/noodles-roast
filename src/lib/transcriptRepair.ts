export interface TranscriptRepairRequest {
  transcript: string;
  question: string;
  questionId: string;
  knownFacts: string[];
  conversationSoFar: string[];
}

export interface TranscriptRepairCandidate {
  correctedText?: unknown;
  changed?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

export interface TranscriptRepairResult {
  text: string;
  changed: boolean;
  confidence: number;
  reason?: string;
}

const MIN_REPAIR_CONFIDENCE = 0.86;
const NEGATION_WORDS = new Set([
  "no",
  "not",
  "never",
  "none",
  "nobody",
  "nothing",
  "neither",
  "without",
  "dont",
  "doesnt",
  "didnt",
  "isnt",
  "wasnt",
  "werent",
  "cant",
  "cannot",
  "wont",
]);
const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
  "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
  "thousand", "million", "billion", "first", "second", "third", "fourth",
  "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
  "twelfth", "dozen", "couple",
]);

function cleanText(value: string): string {
  return value
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

function tokenEditDistance(left: string[], right: string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const above = previous[rightIndex];
      const substitution =
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const insertion = previous[rightIndex - 1] + 1;
      const deletion = above + 1;
      previous[rightIndex] = Math.min(substitution, insertion, deletion);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function hasNegation(value: string): boolean {
  return tokens(value).some((token) => NEGATION_WORDS.has(token));
}

function numberMeaningTokens(value: string): string[] {
  return (
    value
      .toLowerCase()
      .replace(/[’']/g, "")
      .match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []
  )
    .filter((token) => /^\d/.test(token) || NUMBER_WORDS.has(token))
    .map((token) => (/^\d/.test(token) ? `digit:${token}` : `word:${token}`));
}

function hasNumberMeaning(value: string): boolean {
  return numberMeaningTokens(value).length > 0;
}

export function isTranscriptRepairResult(
  value: unknown,
): value is TranscriptRepairResult {
  if (typeof value !== "object" || value === null) return false;
  // JSON boundary: every property is checked before this record is trusted.
  const record = value as Record<string, unknown>;
  return (
    typeof record.text === "string" &&
    record.text.length <= 500 &&
    typeof record.changed === "boolean" &&
    typeof record.confidence === "number" &&
    Number.isFinite(record.confidence) &&
    record.confidence >= 0 &&
    record.confidence <= 1 &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}

function knownName(knownFacts: string[]): string | null {
  for (const fact of knownFacts) {
    const match = fact.match(/^name\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return cleanText(match[1]);
  }
  return null;
}

/**
 * Skip calls where an LLM cannot improve on deterministic handling. In
 * particular, a model cannot infer the spelling of a brand-new name from the
 * same transcript; the existing spoken confirmation flow is safer there.
 */
export function shouldAttemptTranscriptRepair(
  transcript: string,
  questionId: string,
  knownFacts: string[],
): boolean {
  const original = cleanText(transcript);
  if (original.length < 2 || original.length > 500) return false;
  if (questionId === "name") return knownName(knownFacts) !== null;
  if (questionId === "age" && hasNumberMeaning(original)) return false;
  if (
    questionId === "single" &&
    /^(yes|yeah|yep|yup|no|nah|nope|single|married|divorced|taken)$/i.test(
      original,
    )
  ) {
    return false;
  }
  // Limit the utility-model hop to entity-heavy answers where homophone repair
  // can materially improve the roast. Free-form answers, complaints, and
  // conversational reactions are already useful as heard; delaying all of them
  // by a model call made healthy mobile turns feel like bad reception.
  const entityLikeSyntax = /^(?:(?:i am|i'm|im)\s+(?:an?\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3}|(?:i\s+)?(?:work|live|grew up)\s+(?:as|in|at|near|from)\b)/i;
  return (
    new Set(["job", "where_from", "hometown_now"]).has(questionId) ||
    entityLikeSyntax.test(original)
  );
}

/**
 * Apply a model suggestion only when it is a small, high-confidence repair.
 * The LLM is a detector/candidate generator; this function is the authority.
 */
export function chooseTranscriptRepair(
  transcript: string,
  questionId: string,
  knownFacts: string[],
  candidate: TranscriptRepairCandidate,
): TranscriptRepairResult {
  const original = cleanText(transcript);
  const confidence =
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence)
      ? Math.max(0, Math.min(1, candidate.confidence))
      : 0;
  const unchanged: TranscriptRepairResult = {
    text: original,
    changed: false,
    confidence,
  };

  if (candidate.changed !== true || confidence < MIN_REPAIR_CONFIDENCE) {
    return unchanged;
  }
  if (typeof candidate.correctedText !== "string") return unchanged;

  const corrected = cleanText(candidate.correctedText);
  if (!corrected || corrected.length > 500) return unchanged;

  const originalTokens = tokens(original);
  const correctedTokens = tokens(corrected);
  if (
    originalTokens.length === 0 ||
    correctedTokens.length === 0 ||
    originalTokens.join(" ") === correctedTokens.join(" ")
  ) {
    return unchanged;
  }

  // Never let correction introduce/remove a denial or alter explicit numbers.
  if (hasNegation(original) !== hasNegation(corrected)) return unchanged;
  if (
    numberMeaningTokens(original).join("|") !==
    numberMeaningTokens(corrected).join("|")
  ) {
    return unchanged;
  }

  // A repair is one obvious phonetic/segmentation edit, never a rewrite.
  if (tokenEditDistance(originalTokens, correctedTokens) > 1) {
    return unchanged;
  }
  const lengthRatio = corrected.length / Math.max(1, original.length);
  if (lengthRatio < 0.55 || lengthRatio > 1.75) return unchanged;

  // Do not guess a new name. A name correction must resolve to a name already
  // established earlier in the session.
  if (questionId === "name") {
    const establishedName = knownName(knownFacts);
    if (!establishedName) return unchanged;
    const establishedTokens = tokens(establishedName);
    if (!establishedTokens.every((token) => correctedTokens.includes(token))) {
      return unchanged;
    }
  }

  const reason =
    typeof candidate.reason === "string"
      ? cleanText(candidate.reason).slice(0, 120)
      : undefined;
  return {
    text: corrected,
    changed: true,
    confidence,
    ...(reason ? { reason } : {}),
  };
}
