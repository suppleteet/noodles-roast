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
