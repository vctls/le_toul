import { expect, test } from "@playwright/test";
import path from "path";
import {
  getFixturePath,
  getFixturesDir,
  navigateToTab,
  setupTestEnvironment,
  TabId,
  expectLyricsText,
} from "./utils";

test.describe("Starting over", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));
    await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
  });

  test("offers the current files for download before discarding them", async ({ page }) => {
    await expect(page.locator(".modal-card-title")).toHaveText("Start over?");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("lyrics.txt");

    await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, "");
  });

  test("keeps everything when declined", async ({ page }) => {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
  });

  test("discards an uploaded font too, after offering it", async ({ page }) => {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await navigateToTab(page, TabId.Submit);
    await page
      .locator('[name="custom-font-upload"] input[type="file"]')
      .setInputFiles(path.join(getFixturesDir(), "../../api/assets/fonts/MetalMania.ttf"));
    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");

    await page.getByRole("navigation").getByRole("button", { name: "Start Over" }).click();
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText(
      "MetalMania.ttf",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Start over" }).click();

    await expect(page).toHaveURL(/#song$/);
    await expect(page.locator(".custom-font-help")).toHaveCount(0);
    await page.reload();
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator(".custom-font-help")).toHaveCount(0);
  });
});
