/**
 * Extracts the first JSON value matching `pattern` from `text`.
 * Returns `fallback` if no match or parse fails.
 */
export function extractJson<T>(text: string, pattern: RegExp, fallback: T): T {
  try {
    const match = text.match(pattern);
    return match ? (JSON.parse(match[0]) as T) : fallback;
  } catch {
    return fallback;
  }
}
