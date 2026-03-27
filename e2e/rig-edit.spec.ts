import { test, expect } from "@playwright/test";

/**
 * Rig Edit Mode tests.
 * Dev server must be running on :3000.
 */

test.beforeEach(async ({ page }) => {
  // Collect console errors for assertions
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  (page as unknown as Record<string, unknown>)["_errors"] = errors;

  await page.goto("/");
});

function getErrors(page: import("@playwright/test").Page): string[] {
  return (page as unknown as Record<string, unknown>)["_errors"] as string[];
}

test("Edit Rig button is visible in dev mode", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Edit Rig" })).toBeVisible({ timeout: 5000 });
});

test("clicking Edit Rig opens the edit mode overlay", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Rig" }).click();

  // Back button and "No Config" state should appear
  await expect(page.getByRole("button", { name: /← Back|Back/ })).toBeVisible({ timeout: 5000 });

  // No React/JS errors
  const errors = getErrors(page).filter(
    (e) => !e.includes("Warning:") && !e.includes("Download the React DevTools")
  );
  expect(errors, `Console errors: ${errors.join("\n")}`).toHaveLength(0);
});

test("edit mode shows no-config panel when no config is loaded", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Rig" }).click();
  await expect(page.getByText("No rig config loaded")).toBeVisible({ timeout: 5000 });
});

test("Back button exits edit mode", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Rig" }).click();
  await expect(page.getByRole("button", { name: /← Back|Back/ })).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: /← Back|Back/ }).click();

  // Should return to main app — Edit Rig button visible again
  await expect(page.getByRole("button", { name: "Edit Rig" })).toBeVisible({ timeout: 5000 });

  const errors = getErrors(page).filter(
    (e) => !e.includes("Warning:") && !e.includes("Download the React DevTools")
  );
  expect(errors, `Console errors after back: ${errors.join("\n")}`).toHaveLength(0);
});
