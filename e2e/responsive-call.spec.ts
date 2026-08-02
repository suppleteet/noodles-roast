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

test("short landscape viewports reflow setup and live-call controls side by side", async ({ page }) => {
  const driver = new ComedianBrainDriver(page);
  await driver.setup();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");

  const frame = page.getByTestId("call-frame");
  expectInside(await frame.boundingBox(), 844, 390);
  const hero = await page.locator(".landing-identity").boundingBox();
  const actions = await page.locator(".landing-actions").boundingBox();
  expectInside(hero, 844, 390);
  expectInside(actions, 844, 390);
  expect(hero!.x + hero!.width).toBeLessThanOrEqual(actions!.x + 1);

  await page.setViewportSize({ width: 568, height: 320 });
  expectInside(await frame.boundingBox(), 568, 320);
  expectInside(await page.locator(".landing-identity").boundingBox(), 568, 320);
  expectInside(await page.locator(".landing-actions").boundingBox(), 568, 320);
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 844, height: 390 });

  // Geometry is available from server-rendered HTML before React has attached
  // the landing handlers. Wait for the client to settle before exercising the
  // live-call transition so this layout assertion does not race hydration.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /roast me/i }).click();
  await expect(page.getByTestId("call-surface")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("self-view")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("call-controls")).toBeVisible();
  await driver.waitForConnect();

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
  await expectNoPageOverflow(page);
});
