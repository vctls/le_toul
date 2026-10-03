import { test, expect } from "@playwright/test";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturePath,
  loadFixtureFile,
  expectLyricsText,
} from "./utils";

test.describe("Lyrics File Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("uploading a lyrics file fills the lyrics editor", async ({ page }) => {
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));

    await expect(page.locator('.toast:has-text("Lyrics loaded!")')).toBeVisible();

    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, await loadFixtureFile("lyrics.txt"));
  });
});
