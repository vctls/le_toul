import { expect, test, Page } from "@playwright/test";
import {
  getFixturePath,
  loadFixtureFile,
  navigateToTab,
  setupTestEnvironment,
  TabId,
} from "./utils";

const LYRICS_INPUT = '[name="lyrics-file-upload"] input[type="file"]';
const TIMINGS_INPUT = '[name="timings-file-upload"] input[type="file"]';
const OTHER_LYRICS = {
  name: "other.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Other words"),
};

async function lyricsEditorValue(page: Page): Promise<string> {
  await navigateToTab(page, TabId.LyricInput);
  const value = await page.locator(".lyric-input-tab .lyric-editor-textarea").inputValue();
  await navigateToTab(page, TabId.SongInfo);
  return value;
}

test.describe("Replacing loaded lyrics or timings from a file", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
  });

  test("loads lyrics without asking when there are none", async ({ page }) => {
    await page.locator(LYRICS_INPUT).setInputFiles(getFixturePath("lyrics.txt"));

    await expect(page.locator('.toast:has-text("Lyrics loaded!")')).toBeVisible();
    await expect(page.locator(".modal-card")).toBeHidden();
  });

  test("offers the current lyrics, and keeps them when declined", async ({ page }) => {
    await page.locator(LYRICS_INPUT).setInputFiles(getFixturePath("lyrics.txt"));
    const original = await loadFixtureFile("lyrics.txt");

    await page.locator(LYRICS_INPUT).setInputFiles(OTHER_LYRICS);
    await expect(page.locator(".modal-card-title")).toHaveText("Replace your lyrics?");
    await expect(page.locator(".modal-card-body")).toContainText("other.txt");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("lyrics.txt");
    await page.click('.modal-card-foot button:has-text("Keep what I have")');

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
    expect(await lyricsEditorValue(page)).toBe(original);
  });

  test("asks again for the same file after a decline, and replaces once confirmed", async ({
    page,
  }) => {
    await page.locator(LYRICS_INPUT).setInputFiles(getFixturePath("lyrics.txt"));

    await page.locator(LYRICS_INPUT).setInputFiles(OTHER_LYRICS);
    await page.click('.modal-card-foot button:has-text("Keep what I have")');
    await expect(page.locator(".modal-card")).toBeHidden();

    await page.locator(LYRICS_INPUT).setInputFiles(OTHER_LYRICS);
    await expect(page.locator(".modal-card-title")).toHaveText("Replace your lyrics?");
    await page.click('.modal-card-foot button:has-text("Replace")');

    await expect(page.locator('.toast:has-text("Lyrics loaded!")')).toBeVisible();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("other.txt");
    expect(await lyricsEditorValue(page)).toBe("Other words");
  });

  test("asks before replacing timings, and offers the current ones", async ({ page }) => {
    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("timings.json"));
    await expect(page.locator(".modal-card")).toBeHidden();

    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("timings-adjust-group.json"));
    await expect(page.locator(".modal-card-title")).toHaveText("Replace your timings?");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("timings.json");
    await page.click('.modal-card-foot button:has-text("Keep what I have")');
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );

    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("timings-adjust-group.json"));
    await page.click('.modal-card-foot button:has-text("Replace")');
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings-adjust-group.json",
    );
  });

  test("asks before the trash button clears the timings", async ({ page }) => {
    const trash = page.locator('[name="timings-file-upload"] button.is-danger');
    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("timings.json"));

    await trash.click();
    await expect(page.locator(".modal-card-title")).toHaveText("Clear your timings?");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("timings.json");
    await page.click('.modal-card-foot button:has-text("Keep what I have")');
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );

    await trash.click();
    await page.click('.modal-card-foot button:has-text("Clear")');
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );

    // Nothing is left to lose, so loading timings again goes straight through.
    await page.locator(TIMINGS_INPUT).setInputFiles(getFixturePath("timings.json"));
    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );
  });
});
