import { expect, test, type Page } from "@playwright/test";
import { ComedianBrainDriver } from "./helpers/comedianBrainDriver";

type Box = { x: number; y: number; width: number; height: number };

function expectInside(box: Box | null, width: number, height: number): void {
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.height);
}

test("call shell is full-screen on mobile and a portrait handset on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const frame = page.getByTestId("call-frame");
  await expect(frame).toBeVisible();
  expectInside(await frame.boundingBox(), 390, 844);
  const mobileBox = (await frame.boundingBox())!;
  expect(mobileBox.width).toBeCloseTo(390, 0);
  expect(mobileBox.height).toBeCloseTo(844, 0);
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopBox = (await frame.boundingBox())!;
  expect(desktopBox.height).toBeGreaterThan(desktopBox.width * 1.8);
  expect(desktopBox.width).toBeLessThanOrEqual(442);
  expect(desktopBox.height).toBeLessThanOrEqual(882);
  expect(Math.abs(desktopBox.x + desktopBox.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(desktopBox.y + desktopBox.height / 2 - 500)).toBeLessThan(2);
  await expectNoPageOverflow(page);
});

test("Puppet Line centers real puppet contacts and updates the single call target", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Puppet Line" })).toBeVisible();
  await expect(page.getByText("Incoming call")).toHaveCount(0);
  await expect(page.getByText("Roastie video")).toHaveCount(0);

  const carousel = page.getByTestId("puppet-carousel");
  const roastie = page.getByTestId("puppet-profile-roastie");
  const toastie = page.getByTestId("puppet-profile-toastie");
  const call = page.getByTestId("call-selected-puppet");
  await expect(carousel).toBeVisible();
  await expect(roastie).toHaveAttribute("aria-pressed", "true");
  await expect(call).toHaveAttribute("aria-label", "Call Roastie");
  // Next/Image URL-encodes the public path in its optimizer URL, so assert the
  // renderer-derived asset filename rather than the literal slash-delimited path.
  await expect(page.locator('img[src*="roastie.png"]')).toBeVisible();
  await expect(page.locator('img[src*="toastie.png"]')).toBeVisible();
  await expect(call).toHaveCount(1);
  await expect(call).toBeEnabled();
  await page.waitForTimeout(400);

  // Exercise an actual Chromium touch gesture rather than a synthetic scroll;
  // the centered card after native overflow + scroll-snap owns selection.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const carouselBox = (await carousel.boundingBox())!;
  const startX = carouselBox.x + carouselBox.width * 0.8;
  const endX = carouselBox.x + carouselBox.width * 0.2;
  const touchY = carouselBox.y + carouselBox.height * 0.5;
  const swipeTowardToastie = async (): Promise<void> => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: touchY }],
    });
    await page.waitForTimeout(50);
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX + ((endX - startX) * step) / 8, y: touchY }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(350);
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await swipeTowardToastie();
    if ((await toastie.getAttribute("aria-pressed")) === "true") break;
  }
  await expect(toastie).toHaveAttribute("aria-pressed", "true");
  await expect(call).toHaveAttribute("aria-label", "Call Toastie");

  // Non-gesture selection remains available for keyboard/switch users.
  await page.getByRole("button", { name: "Show Roastie" }).click();
  await expect(roastie).toHaveAttribute("aria-pressed", "true");
  await expect(call).toHaveAttribute("aria-label", "Call Roastie");
  await expectNoPageOverflow(page);
  await context.close();
});

test("short landscape viewports reflow setup and live-call controls side by side", async ({ page }) => {
  const recorderLogs: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("[recorder]")) recorderLogs.push(message.text());
  });
  const driver = new ComedianBrainDriver(page);
  await driver.setup();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");

  const frame = page.getByTestId("call-frame");
  expectInside(await frame.boundingBox(), 844, 390);
  const carousel = await page.getByTestId("puppet-carousel").boundingBox();
  const actions = await page.locator(".puppet-line-controls").boundingBox();
  expectInside(carousel, 844, 390);
  expectInside(actions, 844, 390);
  expect(carousel!.x + carousel!.width).toBeLessThanOrEqual(actions!.x + 1);

  await page.setViewportSize({ width: 568, height: 320 });
  expectInside(await frame.boundingBox(), 568, 320);
  expectInside(await page.getByTestId("puppet-carousel").boundingBox(), 568, 320);
  expectInside(await page.locator(".puppet-line-controls").boundingBox(), 568, 320);
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 844, height: 390 });

  // Geometry is available from server-rendered HTML before React has attached
  // the landing handlers. Wait for the client to settle before exercising the
  // live-call transition so this layout assertion does not race hydration.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Call Roastie" }).click();
  await expect(page.getByTestId("call-surface")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("self-view")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("call-controls")).toBeVisible();
  await driver.waitForConnect();
  await expect.poll(() => recorderLogs.join("\n"), { timeout: 10_000 }).toContain(
    "size=1280x592",
  );

  expectInside(await page.getByTestId("call-surface").boundingBox(), 844, 390);
  expectInside(await page.getByTestId("self-view").boundingBox(), 844, 390);
  expectInside(await page.getByTestId("call-controls").boundingBox(), 844, 390);
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  expectInside(await page.getByTestId("call-surface").boundingBox(), 390, 844);
  expectInside(await page.getByTestId("self-view").boundingBox(), 390, 844);
  expectInside(await page.getByTestId("call-controls").boundingBox(), 390, 844);
  await expectNoPageOverflow(page);

  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page.getByTestId("share-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("share-video-shell").locator("video")).toHaveClass(/object-contain/);
  await expect.poll(
    () => page.getByTestId("share-video-shell").locator("video").evaluate((video) => ({
      width: (video as HTMLVideoElement).videoWidth,
      height: (video as HTMLVideoElement).videoHeight,
    })),
    { timeout: 10_000 },
  ).toEqual({ width: 1280, height: 592 });
  const portraitShareShell = await page.getByTestId("share-video-shell").boundingBox();
  const portraitShareActions = await page.getByTestId("share-actions").boundingBox();
  expectInside(portraitShareShell, 390, 844);
  expectInside(portraitShareActions, 390, 844);
  expect(portraitShareShell!.height).toBeLessThanOrEqual(372);
  await page.setViewportSize({ width: 568, height: 320 });
  const shareMetrics = await page.getByTestId("share-screen").evaluate((element) => {
    const screen = element as HTMLElement;
    const preview = screen.querySelector<HTMLElement>("[data-testid='share-preview']");
    return {
      screenTop: screen.getBoundingClientRect().top,
      previewTop: preview?.getBoundingClientRect().top ?? -1,
      scrollHeight: screen.scrollHeight,
      clientHeight: screen.clientHeight,
    };
  });
  expect(shareMetrics.screenTop).toBeGreaterThanOrEqual(-1);
  expect(shareMetrics.previewTop).toBeGreaterThanOrEqual(0);
  expect(shareMetrics.scrollHeight).toBeGreaterThan(shareMetrics.clientHeight);
  const shareShell = await page.getByTestId("share-video-shell").boundingBox();
  const shareActions = await page.getByTestId("share-actions").boundingBox();
  expectInside(shareShell, 568, 320);
  expectInside(shareActions, 568, 320);
  expect(shareShell!.height).toBeLessThanOrEqual(104);
  await expectNoPageOverflow(page);
});
