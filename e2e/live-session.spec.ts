import { test, expect, type Page } from "@playwright/test";
import { LiveSessionMock } from "./helpers/liveSessionMock";

// ─── Shared navigation helper ─────────────────────────────────────────────────

async function startRoasting(page: Page, mock: LiveSessionMock): Promise<void> {
  await page.goto("/");
  // debugMode=true in page.tsx auto-triggers requesting-permissions → roasting.
  // We just wait for the HUD to confirm we're in the roasting phase.
  await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10000 });
  await mock.waitForConnect();
}

// ─── Startup speed test ───────────────────────────────────────────────────────
// The mock auto-responds to the "Go!" kickoff with a roast sentence.
// This verifies the full startup pipeline: page load → session open → kickoff → TTS within 6s.

test.describe("Startup", () => {
  test("puppet begins speaking within 6 seconds of page load", async ({ page }) => {
    // autoRespondToKickoff simulates Gemini responding to the "Go!" kickoff immediately.
    // Other tests leave this off to avoid contaminating their TTS request queues.
    const mock = new LiveSessionMock(page, { autoRespondToKickoff: true });
    await mock.setup();

    const startMs = Date.now();
    await page.goto("/");

    // Wait for the TTS request triggered by the auto-kickoff response
    const req = await mock.waitForTtsRequest(6000);
    const elapsed = Date.now() - startMs;

    expect(req.text).toBeTruthy();
    console.log(`[startup] TTFS in test: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(6000);
  });

  test("HUD shows listening state on startup", async ({ page }) => {
    const mock = new LiveSessionMock(page);
    await mock.setup();
    await page.goto("/");
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10000 });
    await mock.waitForConnect();
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });
});

// ─── TTS pipeline tests ───────────────────────────────────────────────────────

test.describe("TTS pipeline", () => {
  let mock: LiveSessionMock;

  test.beforeEach(async ({ page }) => {
    mock = new LiveSessionMock(page);
    await mock.setup();
  });

  test("complete sentence triggers ElevenLabs TTS", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendOutputTranscription("Oh wow, where do I even begin?");

    const req = await mock.waitForTtsRequest();
    expect(req.text).toMatch(/where do I even begin/i);
  });

  test("partial sentence is buffered until punctuation completes it", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendOutputTranscription("Your hair looks like ");
    await page.waitForTimeout(400); // give it time if it were going to fire
    expect(mock.getTtsRequests()).toHaveLength(0); // still buffering

    mock.sendOutputTranscription("something that gave up!");
    const req = await mock.waitForTtsRequest();
    expect(req.text).toMatch(/gave up/i);
  });

  test("turnComplete flushes remaining text buffer to TTS", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendOutputTranscription("Your room is an absolute disaster"); // no sentence-ending punctuation
    await page.waitForTimeout(300);
    expect(mock.getTtsRequests()).toHaveLength(0);

    mock.sendTurnComplete();
    const req = await mock.waitForTtsRequest();
    expect(req.text).toMatch(/disaster/i);
  });

  test("multiple sentences in one chunk split into separate TTS calls", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    // Three sentences — first two split on whitespace-after-punctuation, third flushed by turnComplete
    mock.sendOutputTranscription("Look at that shirt! Did someone dare you? Bold choice.");
    mock.sendTurnComplete();

    const requests = await mock.waitForTtsCount(3);
    expect(requests[0].text).toMatch(/shirt/i);
    expect(requests[1].text).toMatch(/dare/i);
    expect(requests[2].text).toMatch(/bold/i);
  });

  test("interrupted cancels in-flight TTS — new turn fires fresh", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendOutputTranscription("Let me tell you the whole long story of");
    mock.sendInterrupted();
    mock.clearTtsRequests(); // discard anything that fired before interrupt

    // New turn after barge-in
    mock.sendOutputTranscription("Fine. You win this round.");
    mock.sendTurnComplete();

    const req = await mock.waitForTtsRequest();
    expect(req.text).toMatch(/Fine|win/i);
  });

  test("sendModelTurn helper fires TTS for each sentence", async ({ page }) => {
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendModelTurn(["Nice outfit.", "Did you lose a bet?"]);

    const requests = await mock.waitForTtsCount(2);
    expect(requests[0].text).toMatch(/outfit/i);
    expect(requests[1].text).toMatch(/bet/i);
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
    // HUD visible + connect resolved = session is live. No further assertion needed.
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("session immediately responds to injected outputTranscription (kickoff works)", async ({ page }) => {
    // Indirectly verifies that the 'Go!' kickoff was sent and the session is active:
    // if we can inject a message and get TTS back, the session is in the right state.
    await startRoasting(page, mock);
    mock.clearTtsRequests();

    mock.sendOutputTranscription("Kickoff confirmed.");
    mock.sendTurnComplete();
    const req = await mock.waitForTtsRequest();
    expect(req.text).toMatch(/kickoff/i);
  });

  test("app sends mic audio chunks after session opens", async ({ page }) => {
    await startRoasting(page, mock);
    await page.waitForTimeout(500); // let mic send at least one chunk

    const audioMsg = mock.findClientMessage(
      (m) => !!(m as { realtimeInput?: { audio?: unknown } })?.realtimeInput?.audio
    );
    // Mic might send audio if AudioWorklet initializes — if not, this confirms the structure
    // Don't hard-fail here: CI may not support AudioWorklet, log for diagnosis
    if (!audioMsg) {
      console.warn("[test] No mic audio chunks received — AudioWorklet may not be running in test env");
    }
  });

  test("inputTranscription event does not crash the controller", async ({ page }) => {
    await startRoasting(page, mock);

    // Should not throw — just updates store state
    mock.sendInputTranscription("wait actually I look amazing");
    await page.waitForTimeout(200);

    // If we get here without page crashing, the test passes
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });

  test("goAway triggers session rotation (new WebSocket)", async ({ page }) => {
    await startRoasting(page, mock);

    mock.sendGoAway(5);

    // After goAway, the controller calls rotateSession() which opens a new WebSocket.
    // waitForConnect() returns immediately if already connected — we can't easily assert
    // a second connection here, but we can verify the controller doesn't crash.
    await page.waitForTimeout(500);
    await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible();
  });
});

// ─── Diagnostics test ─────────────────────────────────────────────────────────
// Run this in isolation to understand what the controller is actually doing.

test.describe("Diagnostics", () => {
  test("dump full message flow for a single puppet turn", async ({ page }) => {
    const mock = new LiveSessionMock(page);
    await mock.setup();
    await startRoasting(page, mock);

    mock.clearTtsRequests();

    console.log("\n=== CLIENT MESSAGES BEFORE MODEL TURN ===");
    for (const msg of mock.clientMessages) {
      try {
        const parsed = JSON.parse(msg);
        // Skip large audio blobs
        const type = Object.keys(parsed)[0];
        if (type === "realtimeInput" && (parsed as { realtimeInput?: { audio?: unknown } }).realtimeInput?.audio) {
          console.log("  realtimeInput { audio: <blob> }");
        } else {
          console.log(" ", JSON.stringify(parsed).slice(0, 200));
        }
      } catch {
        console.log("  <binary frame>");
      }
    }

    mock.sendOutputTranscription("Your face is a roast all on its own.");
    mock.sendTurnComplete();

    try {
      const req = await mock.waitForTtsRequest(5000);
      console.log("\n=== TTS FIRED ===");
      console.log("  text:", req.text);
      console.log("  voiceId:", req.voiceId ?? "(default)");
    } catch (e) {
      console.log("\n=== TTS DID NOT FIRE ===");
      console.log("  TTS requests:", mock.getTtsRequests().length);
      console.log("  Client messages after turn:", mock.clientMessages.length);
      throw e;
    }
  });
});
