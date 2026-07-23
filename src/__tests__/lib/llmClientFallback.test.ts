import { describe, expect, it } from "vitest";
import { suggestedFallbackFor } from "@/lib/llmClient";

describe("suggestedFallbackFor", () => {
  it("falls back one stable Gemini tier at a time", () => {
    expect(suggestedFallbackFor("gemini-3.6-flash")).toBe("gemini-3.5-flash");
    expect(suggestedFallbackFor("gemini-3.5-flash")).toBe("gemini-2.5-flash");
    expect(suggestedFallbackFor("gemini-2.5-flash")).toBeNull();
  });

  it("does not silently cross providers", () => {
    expect(suggestedFallbackFor("gpt-5.6-terra")).toBeNull();
    expect(suggestedFallbackFor("claude-sonnet-4-6")).toBeNull();
  });
});
