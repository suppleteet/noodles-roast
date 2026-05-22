import type { MotionState } from "@/lib/motionStates";

/**
 * Infer puppet motion state from the model's output transcript and audio energy.
 *
 * In conversation mode, motion states can't come from structured JSON (the model
 * outputs audio, not JSON). Instead we use heuristics on the transcript text and
 * the RMS energy of the outgoing audio to pick an appropriate animation.
 */
export function inferMotionFromTranscript(
  text: string,
  audioEnergy: number,
): [MotionState, number] {
  const lower = text.toLowerCase();

  // Laughter indicators
  if (/(ha(ha)+|heh|lol|bwah|cackle|rofl)/i.test(lower) || /😂|🤣/.test(text)) {
    return ["laugh", Math.min(0.6 + audioEnergy, 1)];
  }

  // Shock / surprise
  if (/\b(oh my|what\??!|no way|holy|whoa|wow|yikes)\b/.test(lower) || /!{2,}/.test(text)) {
    return ["shocked", 0.8];
  }

  // Conspiratorial / whispering — low energy + certain phrases
  if (
    audioEnergy < 0.25 &&
    /\b(between you and me|don't tell|secret|psst|honestly|real talk)\b/.test(lower)
  ) {
    return ["conspiratorial", 0.6];
  }

  // Smug / sarcasm — require multi-word phrases to avoid false positives on "right", "sure"
  if (/\b(oh really|oh sure|yeah right|clearly|obviously|of course|I mean come on)\b/.test(lower)) {
    return ["smug", 0.6];
  }

  // Thinking / pondering
  if (/\b(hmm|well|let me|think|interesting|hold on|wait)\b/.test(lower)) {
    return ["thinking", 0.5];
  }

  // Emphasis — exclamations or high energy
  if (audioEnergy > 0.6 || /!/.test(text)) {
    return ["emphasis", Math.min(0.5 + audioEnergy, 1)];
  }

  // Energetic — moderate-high energy
  if (audioEnergy > 0.35) {
    return ["energetic", 0.5 + audioEnergy * 0.5];
  }

  // Default: idle, scaled by energy
  return ["idle", 0.3 + audioEnergy * 0.4];
}

/**
 * Infer puppet REACTION motion from the user's answer text, used to drive the filler
 * animation while the LLM generates the joke. The filler is a non-verbal reaction
 * (think "uh-huh, mm-okay") so its motion should reflect how the puppet is processing
 * what the user just said — not what the puppet is about to say.
 *
 * Patterns are deliberately narrow (insult / laughter / question-back / refusal / earnest)
 * with conservative regexes — the default falls through to "thinking" which matches the
 * comedian's processing-the-input headspace.
 */
const INSULT_RE = /\b(fuck\s*(you|off)|shut\s*(up|the|your)|piss\s*off|asshole|jerk|loser|idiot|stupid|dumb|sucks?|shitty|stfu)\b/i;
// 2+ reps of "ha"/"he"/"ho" or "lol"/"lolol" or literal "heh"/"hah"/"lmao"/"rofl".
// Avoid false positives on "hello"/"hey"/"happy" (single rep only).
const LAUGHTER_RE = /^\s*((ha){2,}|(he){2,}|(ho){2,}|(lo)+l|lmao|rofl|heh|hah)/i;
const QUESTION_BACK_RE = /^\s*(why|what|how|who|when|where|huh|excuse\s*me|what\s*about\s*you|are\s*you|do\s*you)\b/i;
// "sort of" / "kind of" are hedges — handled by HEDGE_RE.
const REFUSAL_RE = /\b(whatever|i\s*don'?t\s*(know|care)|none\s*of\s*your|not\s*telling|maybe|kinda)\b/i;
// Bragging / self-aggrandizing — comedian's read is amused-skeptical → smug.
// "best" alone is too generic (kills "best thing ever" via enthusiasm); require "best X" via brag-y nouns.
const BRAG_RE = /\b(millionaire|billionaire|six\s*figures|seven\s*figures|rich|wealthy|famous|greatest|number\s*one|elite|expert|genius|crushing\s*it|killing\s*it|legendary|baller)\b/i;
// Self-deprecating — puppet leans in conspiratorially to roast alongside.
// Includes vocabulary that overlaps with INSULT ("loser"/"suck") so this MUST run before INSULT.
const SELF_DEP_RE = /\b(i'?m\s*(a|an)?\s*(loser|disaster|mess|wreck|failure|piece\s*of\s*shit|disappointment|idiot|stupid|trash|garbage|terrible)|i\s*suck\b|i\s*hate\s*myself|i'?m\s*bad\s*at|i'?m\s*terrible\s*at)/i;
// Sad / vulnerable — soft lean in.
const SAD_RE = /\b(depressed|alone|lonely|miserable|lost|empty|exhausted|burnt\s*out|broken|hurting|crying|grief|grieving|divorced|fired)\b/i;
// Genuine enthusiasm / excitement — comedian rides the energy.
const ENTHUSIASM_RE = /\b(amazing|awesome|incredible|love\s*(it|that)|best\s*(thing|day)|so\s*(good|fun|cool)|hell\s*yes|fuck\s*yes)\b|!!/i;
// Hedging / hesitation cues — pondering / thinking.
const HEDGE_RE = /^\s*(uh+,|um+,|er+,|well,|so,|i\s*guess|i\s*think|probably|maybe|sort\s*of|kind\s*of)\b/i;
const SHORT_FACTUAL_WORDS = 3;

export function inferFillerMotionFromAnswer(answer: string): [MotionState, number] {
  const trimmed = answer.trim();
  if (!trimmed) return ["thinking", 0.6];

  // Order matters. Patterns with overlapping vocab go first when narrower:
  //   SELF_DEP before INSULT  (loser/suck in both)
  //   ENTHUSIASM before BRAG  (best thing → enthusiasm; bare "best" no longer in BRAG)
  //   HEDGE before REFUSAL   (sort of → hedge; sort of removed from REFUSAL)
  if (LAUGHTER_RE.test(trimmed)) return ["energetic", 0.7];
  if (SELF_DEP_RE.test(trimmed)) return ["conspiratorial", 0.75];
  if (INSULT_RE.test(trimmed)) return ["smug", 0.85];
  if (SAD_RE.test(trimmed)) return ["conspiratorial", 0.7];
  if (QUESTION_BACK_RE.test(trimmed) && trimmed.endsWith("?")) return ["shocked", 0.6];
  if (ENTHUSIASM_RE.test(trimmed)) return ["energetic", 0.75];
  if (BRAG_RE.test(trimmed)) return ["smug", 0.8];
  if (HEDGE_RE.test(trimmed)) return ["thinking", 0.7];
  if (REFUSAL_RE.test(trimmed)) return ["smug", 0.7];

  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words <= SHORT_FACTUAL_WORDS) return ["conspiratorial", 0.6];

  return ["thinking", 0.6];
}
