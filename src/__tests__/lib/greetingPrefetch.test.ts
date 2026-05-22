import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JokeResponse } from "@/app/api/generate-joke/route";
import { useSessionStore } from "@/store/useSessionStore";

const DEFAULT_SNAPSHOT = {
  activePersona: "kvetch" as const,
  burnIntensity: 3 as const,
  contentMode: "clean" as const,
};

const DIRECT_JOKE: JokeResponse = {
  relevant: true,
  jokes: [
    { text: "Look at this magnificent disaster.", motion: "smug", intensity: 0.8, score: 7 },
  ],
};

const VISION_JOKE: JokeResponse = {
  relevant: true,
  jokes: [
    { text: "Working from a converted broom closet, are we?", motion: "smug", intensity: 0.8, score: 7 },
  ],
};

/**
 * Build a fetch mock that routes by URL pattern. Each route takes a delay
 * (ms) and a handler that returns either a payload object or null (to make
 * fetch resolve with !ok). Use `delay` to simulate latency races.
 */
function makeFetch(routes: Record<string, { delayMs: number; payload: unknown | null }>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    const { delayMs, payload } = routes[key];
    return new Promise((resolve) => {
      setTimeout(() => {
        if (payload === null) {
          resolve({ ok: false, json: () => Promise.resolve({}) });
        } else {
          resolve({ ok: true, json: () => Promise.resolve(payload) });
        }
      }, delayMs);
    });
  });
}

describe("prefetchParallelVisionAndGreeting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store between tests so existing observations don't leak.
    useSessionStore.setState({ observations: [], visionSetting: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the direct-image joke and does NOT wait for vision", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        "/api/generate-joke": { delayMs: 500, payload: DIRECT_JOKE },
        "/api/analyze": { delayMs: 5000, payload: { observations: ["wearing a hat"] } },
      }),
    );

    const { prefetchParallelVisionAndGreeting } = await import("@/lib/greetingPrefetch");
    const promise = prefetchParallelVisionAndGreeting("FAKE_IMAGE_BASE64", DEFAULT_SNAPSHOT);

    // Advance just past the direct-image latency, NOT vision's latency.
    await vi.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(result?.jokes[0]?.text).toBe(DIRECT_JOKE.jokes[0].text);
  });

  it("settles vision observations into the store even when direct-image won the race", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        "/api/generate-joke": { delayMs: 200, payload: DIRECT_JOKE },
        "/api/analyze": { delayMs: 1500, payload: { observations: ["wearing aviators", "thick beard"], setting: "home office" } },
      }),
    );

    const { prefetchParallelVisionAndGreeting } = await import("@/lib/greetingPrefetch");
    const promise = prefetchParallelVisionAndGreeting("FAKE_IMAGE_BASE64", DEFAULT_SNAPSHOT);

    await vi.advanceTimersByTimeAsync(300);
    const greeting = await promise;
    expect(greeting?.jokes[0]?.text).toBe(DIRECT_JOKE.jokes[0].text);

    // Vision hasn't finished yet — observations not in store.
    expect(useSessionStore.getState().observations).toEqual([]);

    // Let vision finish in the background.
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runAllTimersAsync();

    expect(useSessionStore.getState().observations).toEqual([
      "wearing aviators",
      "thick beard",
    ]);
    expect(useSessionStore.getState().visionSetting).toBe("home office");
  });

  it("falls back to vision-based joke when direct-image fails", async () => {
    let callIdx = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/analyze")) {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ observations: ["bedhead", "tired eyes"] }),
              }),
            300,
          );
        });
      }
      if (url.includes("/api/generate-joke")) {
        callIdx++;
        // First call (direct-image) fails; second call (from observations) succeeds.
        return new Promise((resolve) => {
          setTimeout(() => {
            if (callIdx === 1) {
              resolve({ ok: false, json: () => Promise.resolve({}) });
            } else {
              resolve({ ok: true, json: () => Promise.resolve(VISION_JOKE) });
            }
          }, 100);
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prefetchParallelVisionAndGreeting } = await import("@/lib/greetingPrefetch");
    const promise = prefetchParallelVisionAndGreeting("FAKE_IMAGE_BASE64", DEFAULT_SNAPSHOT);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result?.jokes[0]?.text).toBe(VISION_JOKE.jokes[0].text);
  });

  it("uses pre-scanned observations without firing any new requests", async () => {
    useSessionStore.setState({ observations: ["red flannel shirt", "messy desk"] });

    const fetchMock = makeFetch({
      "/api/generate-joke": { delayMs: 100, payload: DIRECT_JOKE },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prefetchParallelVisionAndGreeting } = await import("@/lib/greetingPrefetch");
    const promise = prefetchParallelVisionAndGreeting("FAKE_IMAGE_BASE64", DEFAULT_SNAPSHOT);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result?.jokes[0]?.text).toBe(DIRECT_JOKE.jokes[0].text);
    // Only one fetch call (the observations-based one) — no analyze, no direct-image.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/api/generate-joke");
  });

  it("returns generic fallback when there is no frame", async () => {
    const fetchMock = makeFetch({
      "/api/generate-joke": { delayMs: 100, payload: DIRECT_JOKE },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prefetchParallelVisionAndGreeting } = await import("@/lib/greetingPrefetch");
    const promise = prefetchParallelVisionAndGreeting(undefined, DEFAULT_SNAPSHOT);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result?.jokes[0]?.text).toBe(DIRECT_JOKE.jokes[0].text);
    // No /api/analyze call.
    const analyzeCalls = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes("/api/analyze"),
    );
    expect(analyzeCalls).toHaveLength(0);
  });
});
