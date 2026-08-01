import { expect, test, type Page } from "@playwright/test";
import { ComedianBrainDriver } from "./helpers/comedianBrainDriver";

async function timingLog(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("roastie-timing-log") ?? "[]") as string[],
  );
}

test("closing prefetch waits for the final answer and stops about one second after goodbye", async ({ page }) => {
  const driver = new ComedianBrainDriver(page);
  await driver.setup();
  await page.addInitScript(() => {
    const win = window as unknown as {
      __COMEDIAN_CONFIG__?: Record<string, number | boolean>;
    };
    win.__COMEDIAN_CONFIG__ = {
      ...win.__COMEDIAN_CONFIG__,
      answerWaitMs: 10_000,
      wrapupAfterMs: 2_500,
      wrapupGuardMs: 2_000,
      wrapupPostLinePauseMs: 350,
      confirmationEnabled: false,
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: /roast me/i }).click();
  await expect(page.locator("[data-testid='hud-overlay']")).toBeVisible({ timeout: 10_000 });
  await driver.waitForConnect();
  await driver.waitForBrainState("wait_answer", 10_000);

  await page.waitForFunction(() => {
    const log = JSON.parse(localStorage.getItem("roastie-timing-log") ?? "[]") as string[];
    return log.some((line) => line.includes("brain: wrapup requested"));
  }, { timeout: 8_000 });

  expect(driver.getJokeRequests().filter((request) => request.context === "wrapup"))
    .toHaveLength(0);

  await driver.simulateAnswer("My name is Alex");
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible({ timeout: 15_000 });

  const log = await timingLog(page);
  expect(log.some((line) => line.includes("wrapup prefetch deferred — state=wait_answer")))
    .toBe(true);
  expect(log.some((line) => line.includes("wrapup prefetch started during final playback")))
    .toBe(true);
  expect(log.some((line) => line.includes("wrapup bridge skipped — closing ready")))
    .toBe(true);
  expect(driver.getJokeRequests().filter((request) => request.context === "wrapup"))
    .toHaveLength(1);

  const fade = log.find((line) => line.includes("live: wrapup fade started"));
  const stopped = log.find((line) => line.includes("live: phase stopped"));
  const recordingStoppedIndex = log.findIndex((line) => line.includes("live: recording stopped"));
  const phaseStoppedIndex = log.findIndex((line) => line.includes("live: phase stopped"));

  expect(fade).toMatch(/3\d\dms after final drain/);
  expect(stopped).toMatch(/1\d{3}ms after final drain/);
  expect(recordingStoppedIndex).toBeGreaterThan(phaseStoppedIndex);
});
