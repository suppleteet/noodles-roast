import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Inject a fake webcam stream so no real camera is needed
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, 640, 480);
    // @ts-ignore — override getUserMedia for testing
    navigator.mediaDevices.getUserMedia = async () =>
      (canvas as any).captureStream(5);
  });
});

test("landing screen renders start button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /start/i })).toBeVisible();
});

test("start button leads to consent screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start/i }).click();
  // Consent screen should appear
  await expect(page.getByText(/before we begin/i)).toBeVisible({ timeout: 5000 });
});

test("consent flow leads to roasting (with mocked API)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start/i }).click();
  await expect(page.getByText(/before we begin/i)).toBeVisible({ timeout: 5000 });

  // Mock the analyze API — no real API keys needed
  await page.route("/api/analyze", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        observations: ["test user"],
        sentences: [
          { text: "Oh look at you!", motion: "laugh", intensity: 0.8 },
        ],
      }),
    })
  );

  // Also mock TTS to avoid ElevenLabs calls
  await page.route("/api/tts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: Buffer.alloc(0),
    })
  );

  await page.getByRole("button", { name: /i agree/i }).click();
  // HUD overlay should appear indicating roasting mode is active
  await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({
    timeout: 8000,
  });
});
