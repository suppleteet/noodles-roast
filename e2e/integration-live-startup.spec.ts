/**
 * Real startup smoke test.
 *
 * Only camera/microphone hardware is substituted with deterministic browser
 * streams. Gemini Live, the selected joke provider, ElevenLabs TTS, and every
 * application route remain real. Opt in because it makes paid API calls.
 */
import { expect, test } from "@playwright/test";

const RUN = process.env.RUN_LIVE_STARTUP_TEST === "1";
const TEST_MODEL = process.env.INTEGRATION_ROAST_MODEL ?? "gemini-3.6-flash";

test.describe("Real live startup", () => {
  test.skip(!RUN, "Set RUN_LIVE_STARTUP_TEST=1 to use real Live/LLM/TTS APIs.");

  test("opens, speaks, hears a typed answer, and completes one roast turn", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      const originalGetUserMedia =
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const wantsAudio = Boolean(constraints?.audio);
        const wantsVideo = Boolean(constraints?.video);

        const makeAudio = (): MediaStream => {
          const context = new AudioContext();
          const destination = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          oscillator.frequency.value = 0;
          oscillator.connect(destination);
          oscillator.start();
          return destination.stream;
        };

        const makeVideo = (): MediaStream => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas 2D unavailable");
          context.fillStyle = "#222";
          context.fillRect(0, 0, canvas.width, canvas.height);
          return canvas.captureStream(5);
        };

        if (wantsAudio && wantsVideo) {
          const audio = makeAudio();
          const video = makeVideo();
          return new MediaStream([
            ...video.getVideoTracks(),
            ...audio.getAudioTracks(),
          ]);
        }
        if (wantsAudio) return makeAudio();
        if (wantsVideo) return makeVideo();
        return originalGetUserMedia(constraints);
      };

      (window as unknown as Record<string, unknown>).__COMEDIAN_CONFIG__ = {
        answerWaitMs: 20_000,
        answerSilenceMs: 500,
        unfinalizedAnswerSilenceMs: 700,
        confirmationEnabled: false,
        visionIntervalMs: 30_000,
        firstSpeechBeatMs: 50,
      };
      (window as unknown as Record<string, unknown>).__SESSION_ROTATE_MS__ =
        600_000;
    });

    const pageErrors: string[] = [];
    const apiFailures: string[] = [];
    const successfulRoutes = new Set<string>();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/")) return;
      if (response.status() >= 500) {
        apiFailures.push(`${response.status()} ${url.pathname}`);
      } else if (
        url.pathname === "/api/live-token" ||
        url.pathname === "/api/comedian-session" ||
        url.pathname === "/api/generate-speak" ||
        url.pathname === "/api/tts-ws"
      ) {
        successfulRoutes.add(url.pathname);
      }
    });

    await page.goto("/");
    await page.getByTestId("build-timestamp").click();
    await page.getByTestId("roast-model-select").selectOption(TEST_MODEL);
    await page.getByRole("button", { name: "Call Roastie" }).click();

    const hud = page.getByTestId("hud-overlay");
    await expect(hud).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => hud.getAttribute("data-brain-state"), { timeout: 45_000 })
      .toBe("wait_answer");

    const input = page.getByPlaceholder("type answer (enter to submit)…");
    await input.fill("My name is Alex");
    await input.press("Enter");
    await expect
      .poll(() => hud.getAttribute("data-brain-state"), { timeout: 15_000 })
      .not.toBe("wait_answer");
    await expect
      .poll(() => hud.getAttribute("data-brain-state"), { timeout: 90_000 })
      .toBe("wait_answer");

    const transcript = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("roastie-transcript") ?? "[]") as Array<{
          role: string;
          text: string;
        }>,
    );
    expect(transcript.some((entry) => entry.role === "puppet")).toBe(true);
    expect(transcript.some((entry) => entry.role === "user")).toBe(true);
    expect([...successfulRoutes]).toEqual(
      expect.arrayContaining([
        "/api/live-token",
        "/api/comedian-session",
        "/api/generate-speak",
        "/api/tts-ws",
      ]),
    );
    expect(apiFailures).toEqual([]);
    expect(pageErrors).toEqual([]);

    // The unlocked debug timeline can overlap the fixed call controls in test
    // viewports. Cleanup is not the behavior under test, so bypass hit testing.
    await page.getByRole("button", { name: "End Session" }).click({ force: true });
  });
});
