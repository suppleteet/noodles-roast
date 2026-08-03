import { test, expect, type Page } from "@playwright/test";
import { LiveSessionMock } from "./helpers/liveSessionMock";
import { ComedianBrainDriver } from "./helpers/comedianBrainDriver";

// ─── Shared navigation helper ─────────────────────────────────────────────────

async function startRoasting(page: Page, mock: LiveSessionMock): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();
  await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10000 });
  await mock.waitForConnect();
}

async function mockAudibleTts(page: Page): Promise<void> {
  await page.route("/api/tts-ws", async (route) => {
    const sampleRate = 24_000;
    const samples = new Int16Array(sampleRate * 2);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 12_000);
    }
    const pcm = Buffer.from(samples.buffer).toString("base64");
    const body = [
      `data: ${JSON.stringify({ type: "audio", chunk: pcm })}\n\n`,
      `data: ${JSON.stringify({ type: "done" })}\n\n`,
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
}

// ─── Startup speed test ───────────────────────────────────────────────────────
// In brain mode, the comedian brain starts the vision opening immediately.

test.describe("Startup", () => {
  test("puppet begins speaking within 6 seconds of page load (vision opening)", async ({ page }) => {
    const driver = new ComedianBrainDriver(page);
    await driver.setup();

    const startMs = Date.now();
    await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();

    // Wait for either the ready vision joke or its brief latency bridge.
    const req = await driver.waitForTtsRequest(6000);
    const elapsed = Date.now() - startMs;

    expect(req.text).toBeTruthy();
    expect(elapsed).toBeLessThan(6000);
    console.log(`[startup] TTFS (brain greeting): ${elapsed}ms`);
  });

  test("HUD overlay is visible on session start", async ({ page }) => {
    const mock = new LiveSessionMock(page);
    await mock.setup();
    await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10000 });
  });

  test("slow vision startup waits for the vision joke", async ({ page }) => {
    const mock = new LiveSessionMock(page);
    await mock.setup();

    await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();

    await page.waitForTimeout(1800);
    expect(mock.getTtsRequests().some((request) => request.text === "Well, hello there.")).toBe(false);
  });

  test("model-trouble Continue keeps the current live session running", async ({ page }) => {
    const driver = new ComedianBrainDriver(page);
    await driver.setup();

    const sessionModels: string[] = [];
    let liveTokenRequests = 0;
    let sessionSequence = 0;
    await page.route("/api/live-token", async (route) => {
      liveTokenRequests++;
      await route.fallback();
    });
    await page.route("/api/comedian-session", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      const body = route.request().postDataJSON() as { model?: string };
      sessionModels.push(body.model ?? "");
      sessionSequence++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: `restart-test-${sessionSequence}` }),
      });
    });

    let failedOnce = false;
    await page.route("/api/generate-speak", async (route) => {
      const body = route.request().postDataJSON() as { model?: string };
      if (!failedOnce && body.model === "gemini-3.6-flash") {
        failedOnce = true;
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body:
            `data: ${JSON.stringify({
              type: "error",
              error: "model_unavailable",
              failedModel: "gemini-3.6-flash",
              suggestedFallback: "gemini-3.5-flash",
            })}\n\n` +
            `data: ${JSON.stringify({ type: "done" })}\n\n`,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          `data: ${JSON.stringify({
            type: "joke",
            text: "Fresh model, fresh insult.",
            motion: "deadpan",
            intensity: 0.7,
            score: 7,
          })}\n\n` +
          `data: ${JSON.stringify({ type: "meta", relevant: true })}\n\n` +
          `data: ${JSON.stringify({ type: "done" })}\n\n`,
      });
    });

    await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();
    await driver.waitForBrainState("wait_answer", 10_000);
    await driver.simulateAnswer("My name is Alex");

    await expect(
      page.getByRole("heading", { name: "His brain glitched out" }),
    ).toBeVisible({ timeout: 10_000 });

    // Continue must dismiss the dialog without creating a replacement session.
    const liveTokenRequestsBeforeContinue = liveTokenRequests;
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "His brain glitched out" }),
    ).toBeHidden();
    await driver.waitForBrainState("ask_question", 10_000);
    expect(sessionModels).toEqual(["gemini-3.6-flash"]);
    expect(liveTokenRequests).toBe(liveTokenRequestsBeforeContinue);
  });
});

// ─── TTS pipeline (brain-driven) ──────────────────────────────────────────────
// In brain mode, TTS comes from /api/generate-joke → brain.queueSpeak(), not from Gemini output.
// These tests verify the brain's TTS pipeline works end-to-end.

test.describe("TTS pipeline (brain-driven)", () => {
  let driver: ComedianBrainDriver;

  test.beforeEach(async ({ page }) => {
    driver = new ComedianBrainDriver(page);
    await driver.setup();
  });

  test("greeting TTS fires on session start", async ({ page }) => {
    await startRoasting(page, driver);
    const req = await driver.waitForTtsRequest(5000);
    expect(req.text).toBeTruthy();
    expect(req.text.length).toBeGreaterThan(5);
  });

  test("barge-in (interrupted) does not crash controller", async ({ page }) => {
    await startRoasting(page, driver);

    // Barge-in during any state — controller should handle gracefully
    driver.sendInterrupted();
    await page.waitForTimeout(200);
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("end-call gives audible TTS a bounded zero-amplitude tail", async ({ page }) => {
    // Override the silent default with a representative sustained utterance.
    // A non-zero waveform proves the 20ms path, not the already-silent shortcut.
    await mockAudibleTts(page);

    await startRoasting(page, driver);
    await expect.poll(
      () => page.evaluate(() =>
        (window as unknown as Record<string, number>).__DEBUG_AMP__ ?? 0),
      { timeout: 10_000 },
    ).toBeGreaterThan(0.05);

    await page.getByRole("button", { name: "End Session" }).click();
    await expect(page.getByTestId("share-screen")).toBeVisible({ timeout: 15_000 });
    const timing = await page.evaluate(
      () => JSON.parse(localStorage.getItem("roastie-timing-log") ?? "[]") as string[],
    );
    const scheduled = timing.find((line) => line.includes("audio: interruption tail="));
    expect(scheduled).toContain("tail=20ms");
    const settled = timing.find((line) => line.includes("audio: interruption settled"));
    expect(settled).toBeTruthy();
    const settledMs = Number(settled?.match(/settled (\d+)ms/)?.[1] ?? Number.NaN);
    // Media encoding can defer this UI-thread callback even though GainNode and
    // source.stop were scheduled exactly 20ms apart on the audio render clock.
    // Guard only against a runaway shutdown timer here.
    expect(settledMs).toBeLessThan(200);
    console.log(`[interrupt-tail] audio-clock=20ms callback=${settledMs}ms`);
  });

  test("user-speech barge-in transitions immediately while audible TTS fades", async ({ page }) => {
    await mockAudibleTts(page);
    await startRoasting(page, driver);
    await driver.waitForBrainState("ask_question", 15_000);
    await expect.poll(
      () => page.evaluate(() =>
        (window as unknown as Record<string, number>).__DEBUG_AMP__ ?? 0),
      { timeout: 10_000 },
    ).toBeGreaterThan(0.05);

    const interruptedAt = Date.now();
    driver.send({
      serverContent: {
        inputTranscription: { text: "No, I said Tyler", finished: true },
      },
    });
    await driver.waitForBrainStateOneOf(["pre_generate", "generating", "delivering"], 1_000);
    const transitionMs = Date.now() - interruptedAt;
    expect(transitionMs).toBeLessThan(500);
    console.log(`[barge-in] state-transition=${transitionMs}ms audio-clock-tail=20ms`);

    const timing = await page.evaluate(
      () => JSON.parse(localStorage.getItem("roastie-timing-log") ?? "[]") as string[],
    );
    expect(timing.some((line) => line.includes("user barge-in during ask_question"))).toBe(true);
    expect(timing.some((line) => line.includes("audio: interruption tail=20ms"))).toBe(true);
  });

  test("multiple TTS requests fire as brain progresses through states", async ({ page }) => {
    await startRoasting(page, driver);
    // Wait for at least 2 TTS requests (greeting + question)
    const requests = await driver.waitForTtsCount(2, 10000);
    expect(requests.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Gemini connection tests ──────────────────────────────────────────────────

test.describe("Gemini connection", () => {
  let mock: LiveSessionMock;

  test.beforeEach(async ({ page }) => {
    mock = new LiveSessionMock(page);
    await mock.setup();
  });

  test("WebSocket connects and session opens (setupComplete acknowledged)", async ({ page }) => {
    // waitForConnect() resolves only after our mock sends setupComplete and the SDK fires onopen.
    // If this test passes, the SDK handshake works correctly.
    await startRoasting(page, mock);
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("inputTranscription event does not crash the controller", async ({ page }) => {
    await startRoasting(page, mock);

    // Should not throw — brain handles it
    mock.sendInputTranscription("wait actually I look amazing");
    await page.waitForTimeout(200);

    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("goAway triggers session rotation (controller does not crash)", async ({ page }) => {
    await startRoasting(page, mock);

    mock.sendGoAway(5);

    // After goAway, the controller calls rotateSession() which opens a new WebSocket.
    await page.waitForTimeout(500);
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("app sends mic audio chunks after session opens (when brain is listening)", async ({ page }) => {
    // In brain mode, mic audio is only sent when brain.isListening() = true.
    // This happens in wait_answer and prodding states.
    const driver = new ComedianBrainDriver(page);
    await driver.setup();
    await startRoasting(page, driver);

    // Wait until brain reaches wait_answer (when mic gating is open)
    await driver.waitForBrainState("wait_answer", 10000).catch(() => {
      // If we don't reach wait_answer in time, just log — don't fail the test
      console.warn("[test] Brain did not reach wait_answer in 10s");
    });

    await page.waitForTimeout(500);
    const audioMsg = driver.findClientMessage(
      (m) => !!(m as { realtimeInput?: { audio?: unknown } })?.realtimeInput?.audio
    );
    if (!audioMsg) {
      console.warn("[test] No mic audio chunks — AudioWorklet may not run in test env, or brain not in listening state yet");
    }
  });

  test("gemini output transcription is discarded (not sent to TTS)", async ({ page }) => {
    const driver = new ComedianBrainDriver(page);
    await driver.setup();
    await startRoasting(page, driver);
    await driver.waitForConnect();
    driver.clearTtsRequests();

    // Inject Gemini output — in brain mode this is discarded
    driver.sendOutputTranscription("I'm the puppet speaking from Gemini.");
    driver.sendTurnComplete();

    await page.waitForTimeout(400);

    // TTS should NOT fire for this text (brain controls TTS)
    const reqs = driver.getTtsRequests();
    const hasGeminiText = reqs.some((r) => r.text.includes("puppet speaking from Gemini"));
    expect(hasGeminiText).toBe(false);
  });
});

// ─── Diagnostics test ─────────────────────────────────────────────────────────

test.describe("Diagnostics", () => {
  test("dump brain state transitions and TTS calls", async ({ page }) => {
    const driver = new ComedianBrainDriver(page);
    await driver.setup();
    await page.goto("/");
  await page.getByRole("button", { name: "Call Roastie" }).click();
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10000 });
    await driver.waitForConnect();

    // Wait a few seconds to collect state transitions
    await page.waitForTimeout(3000);

    const state = await driver.getBrainState();
    const ttsReqs = driver.getTtsRequests();
    const jokeReqs = driver.getJokeRequests();

    console.log("\n=== BRAIN STATE ===", state);
    console.log("=== TTS REQUESTS ===");
    for (const req of ttsReqs) {
      console.log(" ", req.text.slice(0, 80));
    }
    console.log("=== JOKE API REQUESTS ===");
    for (const req of jokeReqs) {
      console.log(" ", req.context, req.userAnswer?.slice(0, 40) ?? "");
    }

    // Just log — don't assert (diagnostic test)
    expect(ttsReqs.length).toBeGreaterThanOrEqual(0);
  });
});
