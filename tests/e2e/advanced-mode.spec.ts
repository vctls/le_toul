import { expect, test } from "@playwright/test";
import { enableAdvancedMode, navigateToTab, setupTestEnvironment, TabId } from "./utils";

test.describe("Advanced mode", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("shows the Karaoke Builder Studio files once turned on, and stays on", async ({ page }) => {
    const kbpInput = page.locator('[name="kbp-file-upload"]');
    await navigateToTab(page, TabId.SongInfo);
    await expect(kbpInput).toHaveCount(0);

    await enableAdvancedMode(page);
    await expect(kbpInput).toBeVisible();

    await page.reload();
    await navigateToTab(page, TabId.SongInfo);
    await expect(kbpInput).toBeVisible();
  });
});
