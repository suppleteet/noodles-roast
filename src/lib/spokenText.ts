/**
 * Remove non-spoken stage directions and repair punctuation they leave behind
 * before text reaches either TTS or the visible transcript.
 */
export function sanitizeSpokenText(text: string): string {
  return text
    .replace(/\(\s*\*[^*\n]*\*\s*\)\s*[.,;:!?]?/g, "")
    .replace(/\*[^*\n]*\*/g, "")
    .replace(/\s*—\s*—\s*/g, " — ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    // "okay, *sip*." used to become the audible malformed "okay,.".
    .replace(/[,;:]+([.!?])/g, "$1")
    // A direction after a pause can otherwise leave "Wait —. What?".
    .replace(/\s*[—–]\s*([.!?])/g, "$1")
    .replace(/\(\s*\)\s*[.,;:!?]?/g, "")
    .replace(/^[\s.,;:!?—–-]+$/g, "")
    .trim();
}
