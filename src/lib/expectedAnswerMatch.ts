/**
 * Fuzzy-match a raw STT transcript to one of a question's expected-answer
 * keys. Used by Rapid Fire flow to look up pre-generated jokes by the answer
 * the user gave.
 *
 * The matcher is intentionally biased toward HIGH-CONFIDENCE matches — when
 * uncertain it returns null so the brain falls back to fresh joke generation
 * rather than firing the wrong pre-gen'd joke. False misses are cheap (a
 * little extra latency); false matches are bad (puppet jokes about the
 * opposite of what was said).
 *
 * Strategy, in order of confidence:
 *   1. yes/no affinity — common across many binary questions, worth a fast
 *      path that recognizes "yeah", "nope", "uh huh", etc.
 *   2. Exact match after normalization
 *   3. Key substring contained in STT  (e.g., key "cats", STT "I have cats")
 *   4. STT substring contained in key  (e.g., STT "complicated", key
 *      "it's complicated")
 *   5. Word-set overlap (Jaccard-ish) — last resort
 *
 * No stemming, no edit distance. Both add cost and complexity for marginal
 * recall. If a question's expected answers don't cover the actual STT, we
 * accept the miss and fall back.
 */

/** Affirmative variants — matched to a "yes" key when present. */
const YES_VARIANTS = new Set([
  "yes", "yeah", "yep", "yup", "yah",
  "uh huh", "mhm", "mmhm", "mmhmm",
  "of course", "absolutely", "definitely", "for sure", "sure",
  "yes i am", "yeah i am", "yep i am",
  "i am", "i do",
]);

/** Negative variants — matched to a "no" key when present. */
const NO_VARIANTS = new Set([
  "no", "nope", "nah", "naw", "no way",
  "uh uh", "mm mm",
  "not really", "definitely not", "absolutely not",
  "no i am not", "nope i am not",
  "i am not", "i do not", "i don't",
]);

/** Lowercase, strip non-alphanumeric (keep apostrophes for "don't"/"it's"), collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find an expected key that normalizes to the given canonical form. */
function findKeyMatching(expected: string[], canonical: string): string | null {
  for (const key of expected) {
    if (normalize(key) === canonical) return key;
  }
  return null;
}

/**
 * Score how well a normalized STT matches a normalized expected-answer key.
 * Returns a value in [0, 1]. Caller picks the highest scorer and applies a
 * confidence threshold.
 */
function scoreMatch(sttNorm: string, keyNorm: string): number {
  if (!sttNorm || !keyNorm) return 0;
  if (sttNorm === keyNorm) return 1.0;
  // Key fully contained in STT — strong signal. e.g., key "cats", STT "i have cats".
  if (sttNorm.includes(keyNorm)) return 0.9;
  // STT fully contained in key — only count if STT is meaningful (3+ chars).
  // e.g., STT "complicated", key "it's complicated".
  if (keyNorm.includes(sttNorm) && sttNorm.length >= 3) return 0.8;

  // Word-set overlap. Useful when STT and key share content words but not
  // structure. e.g., STT "with my parents", key "with parents" → "with" +
  // "parents" overlap.
  const sttWords = new Set(sttNorm.split(" ").filter(Boolean));
  const keyWords = new Set(keyNorm.split(" ").filter(Boolean));
  if (keyWords.size === 0) return 0;
  let overlap = 0;
  for (const w of keyWords) {
    if (sttWords.has(w)) overlap++;
  }
  // Cap word-overlap at 0.7 — it's the weakest signal and we want exact /
  // substring matches to outrank it.
  return Math.min(0.7, (overlap / keyWords.size) * 0.85);
}

/**
 * Pick the best-matching expected key for the given STT transcript, or null
 * if no expected key clears the confidence threshold.
 */
export function matchExpectedAnswer(
  stt: string,
  expectedAnswers: string[],
): string | null {
  if (!stt || expectedAnswers.length === 0) return null;
  const sttNorm = normalize(stt);
  if (!sttNorm) return null;

  // Yes/no fast path — checked before scoring because "yeah I am" should map
  // to "yes" even though the literal word "yes" doesn't appear.
  if (YES_VARIANTS.has(sttNorm) || sttNorm.startsWith("yes ") || sttNorm.startsWith("yeah ")) {
    const yesKey = findKeyMatching(expectedAnswers, "yes");
    if (yesKey) return yesKey;
  }
  if (NO_VARIANTS.has(sttNorm) || sttNorm.startsWith("no ") || sttNorm.startsWith("nope ") || sttNorm.startsWith("nah ")) {
    const noKey = findKeyMatching(expectedAnswers, "no");
    if (noKey) return noKey;
  }

  // Score each expected key, pick the highest.
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const key of expectedAnswers) {
    const score = scoreMatch(sttNorm, normalize(key));
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  // Confidence threshold — must clear 0.5 to avoid firing the wrong cached
  // joke. Tuned by the unit tests; raise if false positives appear in real
  // sessions, lower if real answers are missing common matches.
  return bestScore >= 0.5 ? bestKey : null;
}
