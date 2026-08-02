export type YesNoAnswer = "yes" | "no";

const LEADING_AUXILIARY = /^(?:are|aren't|is|isn't|am|was|wasn't|were|weren't|do|don't|does|doesn't|did|didn't|can|can't|could|couldn't|would|wouldn't|will|won't|have|haven't|has|hasn't|had|hadn't|should|shouldn't)\b/i;
const OPEN_QUESTION_WORD = /\b(?:what|where|when|who|whom|whose|which|why|how)\b/i;
const EITHER_OR = /\b(?:or|versus|vs\.?|either)\b/i;

/**
 * Conservative gate for speculative yes/no branches. False negatives merely
 * use the normal generation path; false positives would waste two calls and
 * risk selecting an ill-fitting response, so wh/either-or questions are out.
 */
export function isGenuinelyYesNoQuestion(question: string): boolean {
  const normalized = question
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, "")
    .replace(/^(?:okay|alright|anyway|moving on|but seriously|so|now|let me ask you this)[,.!?\s-]+/i, "")
    .trim();
  if (!normalized.endsWith("?")) return false;
  if (OPEN_QUESTION_WORD.test(normalized) || EITHER_OR.test(normalized)) return false;
  if (LEADING_AUXILIARY.test(normalized)) return true;

  // Natural contextual questions are often elliptical: "You actually married?"
  // Keep this deliberately narrow so ordinary statement-shaped prompts do not
  // become binary by accident.
  return /^(?:you|they|he|she)\s+(?:(?:actually|really|still|ever)\s+)?(?:single|married|dating|working|living|from\b|got\b|have\b|like\b|want\b|need\b|own\b|know\b|remember\b|care\b)/i.test(normalized);
}

const AMBIGUOUS = /\b(?:maybe|perhaps|possibly|probably|sort of|kind of|kinda|depends|not sure|i don't know|i do not know|yes and no|both)\b/i;
const YES_CUE = /^(?:yes|yeah|yep|yup|sure|absolutely|definitely|correct|right|uh[ -]?huh|i am|i do|i did|i have|i can|i would|i will|that's right|that is right)\b/i;
const NO_CUE = /^(?:no|nope|nah|negative|not really|i'm not|im not|i am not|i don't|i dont|i do not|i didn't|i didnt|i did not|i haven't|i havent|i have not|i can't|i cant|i cannot|i wouldn't|i wouldnt|i would not|that's wrong|that is wrong)\b/i;

/** Classify only an explicit, unambiguous binary answer. */
export function classifyClearYesNoAnswer(answer: string): YesNoAnswer | null {
  const normalized = answer
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[\s,.!?;:—–-]*(?:uh+(?![ -]?huh)|um+|er+|ah+|well|okay|ok)\b[\s,.!?;:—–-]*/i, "")
    .trim();
  if (!normalized || AMBIGUOUS.test(normalized)) return null;

  const yes = YES_CUE.test(normalized);
  const no = NO_CUE.test(normalized);
  if (yes === no) return null;

  // A later contradiction makes the answer unsafe even when it began clearly.
  const rest = normalized
    .replace(yes ? YES_CUE : NO_CUE, "")
    .replace(/^[\s,.!?;:—–-]+/, "");
  if (yes && NO_CUE.test(rest.trim())) return null;
  if (no && YES_CUE.test(rest.trim())) return null;
  const lowInformationTail = rest
    .replace(/[\s,.!?;:—–-]+$/g, "")
    .trim();
  if (
    lowInformationTail &&
    !/^(?:i(?:'m| am) not|i (?:am|do|did|have|can|would|will)|that(?:'s| is) right|for sure|of course|really|actually|yes|yeah|yep|no|nope)$/i.test(lowInformationTail)
  ) {
    return null;
  }
  return yes ? "yes" : "no";
}
