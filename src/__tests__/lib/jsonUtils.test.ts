import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/jsonUtils";

describe("extractJson", () => {
  it("extracts and parses a JSON object from surrounding text", () => {
    const text = 'Here is the result: {"name": "test", "value": 42} trailing text';
    const result = extractJson<{ name: string; value: number }>(
      text,
      /\{[\s\S]*\}/,
      { name: "", value: 0 }
    );
    expect(result.name).toBe("test");
    expect(result.value).toBe(42);
  });

  it("extracts a JSON array from text", () => {
    const text = 'Response: [{"text": "hello", "motion": "idle", "intensity": 0.5}]';
    const result = extractJson<Array<{ text: string }>>(
      text,
      /\[[\s\S]*\]/,
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello");
  });

  it("returns fallback when pattern has no match", () => {
    const fallback = { error: "none" };
    const result = extractJson(
      "This has no JSON object in it",
      /\{[\s\S]*\}/,
      fallback
    );
    expect(result).toBe(fallback);
  });

  it("returns fallback when matched text is not valid JSON", () => {
    const fallback = { error: "none" };
    const result = extractJson(
      "{ this is not valid JSON }",
      /\{[\s\S]*\}/,
      fallback
    );
    expect(result).toBe(fallback);
  });

  it("handles nested JSON objects", () => {
    const text = '{"person": {"name": "Alice"}, "score": 5}';
    const result = extractJson<{ person: { name: string }; score: number }>(
      text,
      /\{[\s\S]*\}/,
      { person: { name: "" }, score: 0 }
    );
    expect(result.person.name).toBe("Alice");
    expect(result.score).toBe(5);
  });

  it("returns fallback on empty string input", () => {
    const fallback = { x: 1 };
    expect(extractJson("", /\{[\s\S]*\}/, fallback)).toBe(fallback);
  });
});
