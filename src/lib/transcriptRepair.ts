export interface TranscriptRepairRequest {
  transcript: string;
  question: string;
  questionId: string;
  knownFacts: string[];
  conversationSoFar: string[];
  model: string;
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

function numberTokens(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?/g) ?? [];
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
  if (questionId === "name" && !knownName(knownFacts)) return false;
  if (questionId === "age" && /^\D*\d{1,3}\D*$/.test(original)) return false;
  if (
    questionId === "single" &&
    /^(yes|yeah|yep|yup|no|nah|nope|single|married|divorced|taken)$/i.test(
      original,
    )
  ) {
    return false;
  }
  return true;
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
  if (numberTokens(original).join("|") !== numberTokens(corrected).join("|")) {
    return unchanged;
  }

  // A repair is an edit, not a paraphrase. Allow one changed word for short
  // answers and at most ~35% token edits for longer speech.
  const longest = Math.max(originalTokens.length, correctedTokens.length);
  const maxEdits = Math.max(1, Math.ceil(longest * 0.35));
  if (tokenEditDistance(originalTokens, correctedTokens) > maxEdits) {
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
