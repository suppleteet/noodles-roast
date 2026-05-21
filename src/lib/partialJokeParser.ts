/**
 * Streaming partial-JSON parser for joke responses.
 *
 * Scans an accumulating string buffer and emits events as joke fields land:
 *   - joke-start: motion + intensity available (ready to open EL WS)
 *   - joke-text-delta: incremental text characters (pipe straight into EL WS)
 *   - joke-end: final score; full joke ready for transcript/logging
 *
 * Assumes the LLM emits fields in order: motion, intensity, text, score.
 * If text arrives before motion+intensity (LLM noncompliance), the parser
 * still works — joke-start fires only once motion+intensity are both present,
 * and any text already accumulated is delivered in the next joke-text-delta.
 */

export type JokeStreamEvent =
  | { type: "joke-start"; index: number; motion: string; intensity: number }
  | { type: "joke-text-delta"; index: number; delta: string }
  | {
      type: "joke-end";
      index: number;
      motion: string;
      intensity: number;
      text: string;
      score: number;
    };

export interface StreamingJokeParser {
  feed(chunk: string): JokeStreamEvent[];
  finish(): JokeStreamEvent[];
}

interface JokeBuilder {
  index: number;
  /** Position of the opening `{` in the buffer. */
  startPos: number;
  motion?: string;
  intensity?: number;
  /** Has `joke-start` been emitted? */
  startEmitted: boolean;
  /** Position in buffer of the opening `"` of the text value (if found). */
  textValueStart?: number;
  /** Position in buffer up to which text chars have already been emitted (exclusive). */
  textCursor: number;
  /** Accumulated decoded text (escape-resolved). */
  textAccum: string;
  /** Has the closing `"` of the text value been observed? */
  textEnded: boolean;
  /** Final score if parsed. */
  score?: number;
  /** Has joke-end been emitted? */
  endEmitted: boolean;
}

interface StringScanResult {
  /** Decoded delta characters since cursor. */
  delta: string;
  /** New cursor position in the buffer (one past the last char consumed). */
  newCursor: number;
  /** True if the closing `"` of the string was observed. */
  ended: boolean;
}

/**
 * Scan a JSON-string value starting at `cursor` (which points to the first
 * char AFTER the opening `"`). Returns decoded chars up to either the closing
 * `"` or the end of the buffer, plus the new cursor position.
 *
 * Handles JSON escape sequences. Conservative when escapes are split across
 * feeds: if we see a lone backslash at the end of the buffer, we stop and
 * resume next call.
 */
function scanStringValue(buffer: string, cursor: number): StringScanResult {
  let i = cursor;
  let delta = "";
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === '"') {
      return { delta, newCursor: i, ended: true };
    }
    if (ch === "\\") {
      // Need at least one more char to interpret the escape
      if (i + 1 >= buffer.length) {
        return { delta, newCursor: i, ended: false };
      }
      const next = buffer[i + 1];
      switch (next) {
        case '"':
          delta += '"';
          i += 2;
          break;
        case "\\":
          delta += "\\";
          i += 2;
          break;
        case "/":
          delta += "/";
          i += 2;
          break;
        case "n":
          delta += "\n";
          i += 2;
          break;
        case "t":
          delta += "\t";
          i += 2;
          break;
        case "r":
          delta += "\r";
          i += 2;
          break;
        case "b":
          delta += "\b";
          i += 2;
          break;
        case "f":
          delta += "\f";
          i += 2;
          break;
        case "u": {
          // \uXXXX — need 4 more hex chars
          if (i + 6 > buffer.length) {
            return { delta, newCursor: i, ended: false };
          }
          const hex = buffer.slice(i + 2, i + 6);
          const code = parseInt(hex, 16);
          if (Number.isFinite(code)) {
            delta += String.fromCharCode(code);
          }
          i += 6;
          break;
        }
        default:
          // Unknown escape — emit as-is and advance
          delta += next;
          i += 2;
      }
    } else {
      delta += ch;
      i += 1;
    }
  }
  return { delta, newCursor: i, ended: false };
}

/**
 * Find the position of the opening `{` of the next joke object in the jokes
 * array, starting from `from`. Skips whitespace/commas. Returns -1 if not yet
 * present in the buffer or if we've reached the closing `]` of the array.
 */
function findNextJokeOpenBrace(buffer: string, from: number): number {
  for (let i = from; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === "{") return i;
    if (ch === "]") return -1; // array closed
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === ",") continue;
    // Anything else (unexpected) — stop scanning, wait for more
    return -1;
  }
  return -1;
}

/**
 * Try to extract a string-valued field like `"motion": "smug"` from a slice
 * of the buffer. Returns the value and the position past the closing `"`,
 * or null if not yet fully present.
 */
function extractStringField(
  buffer: string,
  from: number,
  field: string,
): { value: string; endPos: number } | null {
  const slice = buffer.slice(from);
  const re = new RegExp(`"${field}"\\s*:\\s*"`, "");
  const m = re.exec(slice);
  if (!m) return null;
  const valueStart = from + m.index + m[0].length;
  const scan = scanStringValue(buffer, valueStart);
  if (!scan.ended) return null;
  return { value: scan.delta, endPos: scan.newCursor + 1 };
}

/**
 * Try to extract a numeric field like `"intensity": 0.7`. Returns value and
 * position past the number, or null if not yet complete.
 */
function extractNumberField(
  buffer: string,
  from: number,
  field: string,
): { value: number; endPos: number } | null {
  const slice = buffer.slice(from);
  // Number must be followed by , } ] whitespace — otherwise we can't know it's complete.
  const re = new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\s*[,}\\]\\s]`, "");
  const m = re.exec(slice);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  // endPos is just past the matched number (not the terminator after it)
  const numberEnd = from + m.index + m[0].lastIndexOf(m[1]) + m[1].length;
  return { value: val, endPos: numberEnd };
}

/** Find position of the `"text"` field opener `"text"\s*:\s*"` after `from`. */
function findTextValueStart(buffer: string, from: number): number {
  const slice = buffer.slice(from);
  const m = /"text"\s*:\s*"/.exec(slice);
  if (!m) return -1;
  return from + m.index + m[0].length;
}

export function createStreamingJokeParser(): StreamingJokeParser {
  let buffer = "";
  let jokesArrayContentStart: number | null = null;
  let scanCursor = 0; // where to start searching for the next joke
  let currentJoke: JokeBuilder | null = null;
  let nextIndex = 0;

  function tryParseCurrentJoke(): JokeStreamEvent[] {
    const events: JokeStreamEvent[] = [];
    if (!currentJoke) return events;
    const joke = currentJoke;

    // 1. motion
    if (joke.motion === undefined) {
      const r = extractStringField(buffer, joke.startPos, "motion");
      if (!r) return events;
      joke.motion = r.value;
    }

    // 2. intensity
    if (joke.intensity === undefined) {
      const r = extractNumberField(buffer, joke.startPos, "intensity");
      if (!r) return events;
      joke.intensity = r.value;
    }

    // 3. Emit joke-start once both are known
    if (!joke.startEmitted) {
      events.push({
        type: "joke-start",
        index: joke.index,
        motion: joke.motion,
        intensity: joke.intensity,
      });
      joke.startEmitted = true;
    }

    // 4. Locate text value opener
    if (joke.textValueStart === undefined) {
      const pos = findTextValueStart(buffer, joke.startPos);
      if (pos === -1) return events;
      joke.textValueStart = pos;
      joke.textCursor = pos;
    }

    // 5. Stream text deltas until closing `"`
    if (!joke.textEnded) {
      const scan = scanStringValue(buffer, joke.textCursor);
      if (scan.delta.length > 0) {
        events.push({ type: "joke-text-delta", index: joke.index, delta: scan.delta });
        joke.textAccum += scan.delta;
      }
      joke.textCursor = scan.newCursor;
      if (!scan.ended) return events;
      joke.textEnded = true;
      joke.textCursor = scan.newCursor + 1; // skip past closing "
    }

    // 6. Score → joke-end
    if (joke.score === undefined) {
      const r = extractNumberField(buffer, joke.textCursor, "score");
      if (!r) return events;
      joke.score = r.value;
    }

    if (!joke.endEmitted) {
      events.push({
        type: "joke-end",
        index: joke.index,
        motion: joke.motion,
        intensity: joke.intensity,
        text: joke.textAccum,
        score: joke.score,
      });
      joke.endEmitted = true;
      // Advance scan cursor past this joke's `}` so we can find the next one.
      // We approximate by skipping past the score value position; findNextJokeOpenBrace
      // will skip commas/whitespace/`}` chars cleanly.
      let p = joke.textCursor;
      while (p < buffer.length && buffer[p] !== "}") p++;
      scanCursor = p + 1;
      currentJoke = null;
    }

    return events;
  }

  function feed(chunk: string): JokeStreamEvent[] {
    buffer += chunk;
    const events: JokeStreamEvent[] = [];

    // Locate `"jokes": [` if not yet.
    if (jokesArrayContentStart === null) {
      const m = /"jokes"\s*:\s*\[/.exec(buffer);
      if (!m) return events;
      jokesArrayContentStart = m.index + m[0].length;
      scanCursor = jokesArrayContentStart;
    }

    // Loop: progress as many jokes as possible per feed.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!currentJoke) {
        const open = findNextJokeOpenBrace(buffer, scanCursor);
        if (open === -1) break;
        currentJoke = {
          index: nextIndex++,
          startPos: open,
          startEmitted: false,
          textCursor: open,
          textAccum: "",
          textEnded: false,
          endEmitted: false,
        };
      }
      const before = events.length;
      const more = tryParseCurrentJoke();
      events.push(...more);
      // If currentJoke is still set (meaning joke-end not emitted), we need more data.
      if (currentJoke) break;
      // If currentJoke cleared, loop and try the next one.
      // Safety: if no progress was made and joke didn't clear, also break (shouldn't happen).
      if (events.length === before) break;
    }

    return events;
  }

  function finish(): JokeStreamEvent[] {
    // Last-ditch try in case there's data we haven't processed yet.
    if (currentJoke) {
      return tryParseCurrentJoke();
    }
    return [];
  }

  return { feed, finish };
}
