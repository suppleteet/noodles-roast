import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelUnavailableError,
  retryUnavailableModel,
  suggestedFallbackFor,
} from "@/lib/llmClient";

afterEach(() => {
  vi.useRealTimers();
});

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

describe("retryUnavailableModel", () => {
  const unavailable = Object.assign(
    new Error("503 UNAVAILABLE: model is overloaded"),
    { status: 503 },
  );

  it("retries a transient model outage before surfacing fallback UI", async () => {
    vi.useFakeTimers();
    const retry = retryUnavailableModel("gemini-3.6-flash", unavailable, 0);
    await vi.runAllTimersAsync();
    await expect(retry).resolves.toBe(true);
  });

  it("throws the structured fallback error after retries are exhausted", async () => {
    await expect(
      retryUnavailableModel("gemini-3.6-flash", unavailable, 2),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("ignores errors that are not model-unavailable responses", async () => {
    await expect(
      retryUnavailableModel("gemini-3.6-flash", new Error("bad request"), 0),
    ).resolves.toBe(false);
  });
});
