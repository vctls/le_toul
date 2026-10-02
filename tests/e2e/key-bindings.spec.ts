import { expect, test } from "@playwright/test";
import { setupTestEnvironment } from "./utils";

test.describe("Keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("opens from the navbar and from ?", async ({ page }) => {
    await page.getByRole("navigation").getByRole("button", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).first().click();
    // ? is ignored while any modal is in the page, and a closed one stays hidden there a moment.
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts", includeHidden: true }),
    ).toHaveCount(0);
    await page.keyboard.press("?");
    await expect(dialog).toBeVisible();
  });

  test("rebinds a key, keeps the dialog open on Esc, and resets", async ({ page }) => {
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    const playPause = dialog.getByRole("button", { name: "Play or pause: Space" });
    const reset = dialog.getByRole("button", { name: "Reset all to defaults" });
    await expect(reset).toBeDisabled();

    await playPause.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    await playPause.click();
    await page.keyboard.press("p");
    await expect(dialog.getByRole("button", { name: "Play or pause: P" })).toBeVisible();
    await expect(dialog).not.toContainText("In Tap mode, P");

    await reset.click();
    await expect(dialog.getByRole("button", { name: "Play or pause: Space" })).toBeVisible();
    await expect(reset).toBeDisabled();
  });
});
