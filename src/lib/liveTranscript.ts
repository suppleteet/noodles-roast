/** Join Gemini Live's syllable/word deltas without corrupting boundaries. */
export function smartJoinLiveTranscript(buffer: string, chunk: string): string {
  if (!buffer) return chunk;
  if (!chunk) return buffer;
  const lastChar = buffer[buffer.length - 1];
  const firstChar = chunk[0];
  if (/^[\s,;:.!?'"\-)]/.test(firstChar)) return buffer + chunk;
  if (/[\s(["']$/.test(lastChar)) return buffer + chunk;
  if (/[a-zA-Z]$/.test(lastChar) && /^[a-z]/.test(firstChar)) return buffer + chunk;
  if (/[0-9]$/.test(lastChar) && /^[0-9]/.test(firstChar)) return buffer + chunk;
  if (/[a-zA-Z0-9]$/.test(lastChar) && /^[A-Z]$/.test(chunk)) return buffer + chunk;
  return buffer + " " + chunk;
}

function compactTranscript(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function transcriptWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Gemini normally streams deltas, including the event carrying `finished`.
 * Some revisions repeat a cumulative/corrected final string. Accept both.
 */
export function mergeLiveTranscript(
  buffer: string,
  chunk: string,
  finished: boolean,
): string {
  if (!finished || !buffer.trim() || !chunk.trim()) {
    return smartJoinLiveTranscript(buffer, chunk);
  }

  const previous = buffer.trim();
  const finalText = chunk.trim();
  const previousCompact = compactTranscript(previous);
  const finalCompact = compactTranscript(finalText);
  const previousWords = transcriptWordCount(previous);
  const finalWords = transcriptWordCount(finalText);
  // Gemini uses leading whitespace to mark a real word boundary on deltas.
  // Preserve that strong wire-format signal even when the final delta happens
  // to contain several words.
  if (/^\s/.test(chunk)) {
    return smartJoinLiveTranscript(buffer, chunk);
  }
  const compactEquivalent = previousCompact === finalCompact;
  const finalRepeatsBuffer = finalCompact.startsWith(previousCompact);
  const substantiallyCumulative =
    finalWords >= 2 && finalWords >= Math.ceil(previousWords * 0.6);

  if (compactEquivalent || finalRepeatsBuffer || substantiallyCumulative) {
    return chunk;
  }
  return smartJoinLiveTranscript(buffer, chunk);
}
