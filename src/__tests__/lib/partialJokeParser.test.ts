import { describe, it, expect } from "vitest";
import {
  createStreamingJokeParser,
  type JokeStreamEvent,
} from "@/lib/partialJokeParser";

/** Feed a string char-by-char (or in arbitrary chunks) and collect all events. */
function feedAll(parser: ReturnType<typeof createStreamingJokeParser>, chunks: string[]): JokeStreamEvent[] {
  const events: JokeStreamEvent[] = [];
  for (const c of chunks) events.push(...parser.feed(c));
  events.push(...parser.finish());
  return events;
}

function splitEveryChar(s: string): string[] {
  return s.split("");
}

const SINGLE_JOKE = `{
  "relevant": true,
  "jokes": [
    { "motion": "smug", "intensity": 0.7, "text": "Oh hello there.", "score": 8 }
  ]
}`;

const MULTI_JOKE = `{
  "relevant": true,
  "jokes": [
    { "motion": "smug", "intensity": 0.6, "text": "First joke.", "score": 7 },
    { "motion": "energetic", "intensity": 0.9, "text": "Second joke.", "score": 8 }
  ]
}`;

const JOKE_WITH_ESCAPES = `{"relevant":true,"jokes":[{"motion":"laugh","intensity":0.8,"text":"He said \\"hi\\" and walked away.","score":7}]}`;

const JOKE_WITH_NEWLINE = `{"relevant":true,"jokes":[{"motion":"emphasis","intensity":0.5,"text":"Line one\\nLine two.","score":6}]}`;

const TEXT_FIRST_JOKE = `{"relevant":true,"jokes":[{"text":"Wrong order.","motion":"smug","intensity":0.7,"score":8}]}`;

describe("createStreamingJokeParser — well-formed single joke", () => {
  it("emits joke-start, text-delta, joke-end in order when fed all at once", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, [SINGLE_JOKE]);

    const start = events.find((e) => e.type === "joke-start");
    const end = events.find((e) => e.type === "joke-end");
    const deltas = events.filter((e) => e.type === "joke-text-delta");

    expect(start).toEqual({ type: "joke-start", index: 0, motion: "smug", intensity: 0.7 });
    expect(end).toEqual({
      type: "joke-end",
      index: 0,
      motion: "smug",
      intensity: 0.7,
      text: "Oh hello there.",
      score: 8,
    });

    const fullText = deltas
      .filter((e) => e.type === "joke-text-delta")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(fullText).toBe("Oh hello there.");
  });

  it("emits joke-start BEFORE any text-delta even when fed char-by-char", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(SINGLE_JOKE));

    const startIdx = events.findIndex((e) => e.type === "joke-start");
    const firstDeltaIdx = events.findIndex((e) => e.type === "joke-text-delta");

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeltaIdx).toBeGreaterThan(startIdx);
  });

  it("emits joke-end with the full reconstructed text", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(SINGLE_JOKE));

    const end = events.find((e) => e.type === "joke-end");
    expect(end).toBeDefined();
    expect((end as { text: string }).text).toBe("Oh hello there.");
  });

  it("char-by-char produces multiple text-delta events", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(SINGLE_JOKE));
    const deltas = events.filter((e) => e.type === "joke-text-delta");
    expect(deltas.length).toBeGreaterThan(1);
  });
});

describe("createStreamingJokeParser — multi-joke array", () => {
  it("emits two joke-start / joke-end pairs with correct indices", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, [MULTI_JOKE]);

    const starts = events.filter((e) => e.type === "joke-start");
    const ends = events.filter((e) => e.type === "joke-end");

    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect((starts[0] as { index: number; motion: string }).index).toBe(0);
    expect((starts[0] as { index: number; motion: string }).motion).toBe("smug");
    expect((starts[1] as { index: number; motion: string }).index).toBe(1);
    expect((starts[1] as { index: number; motion: string }).motion).toBe("energetic");
  });

  it("text-deltas are correctly attributed to each joke index", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(MULTI_JOKE));

    const joke0Text = events
      .filter((e) => e.type === "joke-text-delta" && (e as { index: number }).index === 0)
      .map((e) => (e as { delta: string }).delta)
      .join("");
    const joke1Text = events
      .filter((e) => e.type === "joke-text-delta" && (e as { index: number }).index === 1)
      .map((e) => (e as { delta: string }).delta)
      .join("");

    expect(joke0Text).toBe("First joke.");
    expect(joke1Text).toBe("Second joke.");
  });
});

describe("createStreamingJokeParser — escapes", () => {
  it("decodes escaped quotes in text", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, [JOKE_WITH_ESCAPES]);
    const end = events.find((e) => e.type === "joke-end");
    expect((end as { text: string }).text).toBe('He said "hi" and walked away.');
  });

  it("decodes escaped quotes when fed char-by-char (escape spans feeds)", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(JOKE_WITH_ESCAPES));
    const end = events.find((e) => e.type === "joke-end");
    expect((end as { text: string }).text).toBe('He said "hi" and walked away.');
  });

  it("decodes \\n as a real newline", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, [JOKE_WITH_NEWLINE]);
    const end = events.find((e) => e.type === "joke-end");
    expect((end as { text: string }).text).toBe("Line one\nLine two.");
  });

  it("handles a lone backslash at end of feed (escape split across feeds)", () => {
    const parser = createStreamingJokeParser();
    // Split RIGHT after the backslash so the escape `\"` spans two feeds.
    const idx = JOKE_WITH_ESCAPES.indexOf("\\");
    const a = JOKE_WITH_ESCAPES.slice(0, idx + 1);
    const b = JOKE_WITH_ESCAPES.slice(idx + 1);
    const events = feedAll(createStreamingJokeParser(), [a, b]);
    const end = events.find((e) => e.type === "joke-end");
    expect((end as { text: string }).text).toBe('He said "hi" and walked away.');
  });
});

describe("createStreamingJokeParser — noncompliant ordering", () => {
  it('still extracts everything when "text" appears before "motion"', () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(TEXT_FIRST_JOKE));

    const start = events.find((e) => e.type === "joke-start");
    const end = events.find((e) => e.type === "joke-end");

    expect(start).toBeDefined();
    expect((start as { motion: string; intensity: number }).motion).toBe("smug");
    expect((start as { motion: string; intensity: number }).intensity).toBe(0.7);
    expect(end).toBeDefined();
    expect((end as { text: string; score: number }).text).toBe("Wrong order.");
    expect((end as { text: string; score: number }).score).toBe(8);
  });

  it("buffers text and emits it only AFTER joke-start when ordering is wrong", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, splitEveryChar(TEXT_FIRST_JOKE));

    const startIdx = events.findIndex((e) => e.type === "joke-start");
    const firstDeltaIdx = events.findIndex((e) => e.type === "joke-text-delta");

    // joke-start fires only when motion+intensity land — which in this input
    // comes AFTER text — so the first text-delta must be after joke-start.
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeltaIdx).toBeGreaterThan(startIdx);
  });
});

describe("createStreamingJokeParser — robustness", () => {
  it("yields no events for empty or partial input", () => {
    const parser = createStreamingJokeParser();
    const events = parser.feed('{"relevant":true,"joke');
    expect(events).toEqual([]);
  });

  it("yields no events when input has no jokes array", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, ['{"relevant": true}']);
    expect(events).toEqual([]);
  });

  it("does not emit joke-end if score never arrives", () => {
    const parser = createStreamingJokeParser();
    const events = feedAll(parser, [
      '{"jokes":[{"motion":"smug","intensity":0.7,"text":"Half a joke."',
    ]);
    expect(events.some((e) => e.type === "joke-start")).toBe(true);
    expect(events.some((e) => e.type === "joke-end")).toBe(false);
  });

  it("emits deltas as they arrive (no all-at-end batch)", () => {
    const parser = createStreamingJokeParser();
    const e1 = parser.feed('{"jokes":[{"motion":"smug","intensity":0.7,"text":"Hello');
    const e2 = parser.feed(' world');
    const e3 = parser.feed('","score":8}]}');

    // After feed 1: joke-start + some delta of "Hello"
    expect(e1.some((e) => e.type === "joke-start")).toBe(true);
    expect(e1.some((e) => e.type === "joke-text-delta")).toBe(true);

    // After feed 2: another delta for " world"
    expect(e2.some((e) => e.type === "joke-text-delta")).toBe(true);

    // After feed 3: joke-end
    expect(e3.some((e) => e.type === "joke-end")).toBe(true);
  });
});
