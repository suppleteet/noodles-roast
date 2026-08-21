import { ThinkingLevel } from "@google/genai";
import { describe, expect, it } from "vitest";
import { geminiThinkingConfig } from "@/lib/geminiThinking";

describe("geminiThinkingConfig", () => {
  it("uses low thinking for creative Gemini 3 turns", () => {
    expect(geminiThinkingConfig("gemini-3.6-flash", "creative")).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
  });

  it("uses minimal thinking for latency-sensitive Gemini 3 utility calls", () => {
    expect(
      geminiThinkingConfig("gemini-3.6-flash", "realtime-utility"),
    ).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
  });

  it("uses medium thinking for deliberate Gemini 3 comedy turns", () => {
    expect(geminiThinkingConfig("gemini-3.6-flash", "comedy-deliberate")).toEqual({
      thinkingLevel: ThinkingLevel.MEDIUM,
    });
  });

  it("supports the retained Gemini 3.1 Flash-Lite option", () => {
    expect(geminiThinkingConfig("gemini-3.1-flash-lite", "realtime-utility")).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
  });

  it("keeps the legacy zero-token configuration for Gemini 2 fallbacks", () => {
    expect(geminiThinkingConfig("gemini-2.5-flash", "creative")).toEqual({
      thinkingBudget: 0,
    });
  });
});
