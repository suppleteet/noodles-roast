import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JokeResponse } from "@/app/api/generate-joke/route";
import { DEFAULT_VOICE_SETTINGS, useSessionStore } from "@/store/useSessionStore";
import {
  ROAST_OPENER_SPEED_CAP,
  ROAST_OPENER_STYLE_CAP,
} from "@/lib/voiceMotionPresets";
import { kvetch } from "@/lib/comedians/kvetch";

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

describe("prefetchGreetingAudio", () => {
  // Use REAL timers — the async stream reader uses real Promises that
  // don't make progress under vi.useFakeTimers().
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BASE_VOICE = {
    stability: 0.72,
    similarity_boost: 0.7,
    style: 1,
    speed: 1.0,
    use_speaker_boost: true,
  };

  it("populates buffer with chunks from SSE stream and marks done at end", async () => {
    // Build an SSE response body that emits two audio chunks then done.
    const sseBody = [
      `data: ${JSON.stringify({ type: "audio", chunk: "AAAA" })}\n\n`,
      `data: ${JSON.stringify({ type: "audio", chunk: "BBBB" })}\n\n`,
      `data: ${JSON.stringify({ type: "done" })}\n\n`,
    ].join("");
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      }),
    );

    const { prefetchGreetingAudio } = await import("@/lib/greetingPrefetch");
    const buffer = prefetchGreetingAudio("Hello there.", "smug", 0.7, BASE_VOICE);

    // Wait for the async SSE reader to finish populating the buffer.
    while (!buffer.done) {
      await new Promise<void>((r) => setTimeout(r, 10));
    }

    expect(buffer.chunks).toEqual(["AAAA", "BBBB"]);
    expect(buffer.done).toBe(true);
    expect(buffer.failed).toBe(false);
  });

  it("marks buffer failed when fetch returns !ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }),
    );

    const { prefetchGreetingAudio } = await import("@/lib/greetingPrefetch");
    const buffer = prefetchGreetingAudio("Hi.", "smug", 0.7, BASE_VOICE);

    while (!buffer.done) {
      await new Promise<void>((r) => setTimeout(r, 10));
    }

    expect(buffer.failed).toBe(true);
    expect(buffer.done).toBe(true);
  });

  it("returns immediately-failed buffer for empty text", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Re-import is unnecessary — we just need the function.
    return import("@/lib/greetingPrefetch").then(({ prefetchGreetingAudio }) => {
      const buffer = prefetchGreetingAudio("   ", "smug", 0.7, BASE_VOICE);
      expect(buffer.failed).toBe(true);
      expect(buffer.done).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe("prefetchCannedOpener", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Kvetch startup TTS with a canned opener and final opener voice settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null });
    vi.stubGlobal("fetch", fetchMock);
    useSessionStore.setState({
      cannedIntro: true,
      experienceType: "roast",
      activePersona: "kvetch",
      contentMode: "clean",
      voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
    });

    const { prefetchCannedOpener } = await import("@/lib/greetingPrefetch");
    const opener = prefetchCannedOpener();

    expect(opener).not.toBeNull();
    // The opener is one of kvetch's clean canned intros (each ends on a
    // who-are-you ask, enforced by personas.test.ts).
    const clean = kvetch.cannedIntros.clean;
    expect([...clean.anytime, ...clean.early, ...clean.late]).toContain(opener?.text);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tts-ws",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toBe(opener?.text);
    expect(body.previousText).toBeUndefined();
    expect(body.voiceSettings).toMatchObject({
      style: ROAST_OPENER_STYLE_CAP,
      speed: ROAST_OPENER_SPEED_CAP,
      // Kvetch opens deadpan (stability delta +0.22) at opener intensity 0.6,
      // applied to the base default stability — derive it so this survives a
      // default-stability change.
      stability: DEFAULT_VOICE_SETTINGS.stability + 0.22 * 0.6,
      similarity_boost: DEFAULT_VOICE_SETTINGS.similarity_boost,
    });
    expect(body.experienceType).toBe("roast");
  });
});
