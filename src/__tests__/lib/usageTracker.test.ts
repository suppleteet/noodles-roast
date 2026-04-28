import { beforeEach, describe, expect, it } from "vitest";
import {
  estimateTokenCount,
  getLlmUsageSnapshot,
  recordLlmUsage,
  resetLlmUsageForTests,
} from "@/lib/usageTracker";

beforeEach(() => {
  resetLlmUsageForTests();
});

describe("usageTracker", () => {
  it("estimates token counts from text", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
  });

  it("aggregates LLM cost and tokens", () => {
    recordLlmUsage({
      route: "test",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      exact: true,
    });
    const snapshot = getLlmUsageSnapshot();
    expect(snapshot.calls).toBe(1);
    expect(snapshot.inputTokens).toBe(1000);
    expect(snapshot.outputTokens).toBe(500);
    expect(snapshot.estimatedCostUsd).toBeCloseTo(0.0075);
  });
});
