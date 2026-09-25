import { expect, test, Page } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import { getFixturePath, navigateToTab, setupTestEnvironment, TabId } from "./utils";

const KBP_INPUT = '[name="kbp-file-upload"] input[type="file"]';
const IMPORTED_LYRICS = [
  "Pale_moon_ri/sing_slow",
  "o/ver_the_qui/et_hill",
  "Lan/terns_glow",
  "",
  "Wan/der_a/way",
  "Home_a/gain",
].join("\n");

async function lyricsEditorValue(page: Page): Promise<string> {
  await navigateToTab(page, TabId.LyricInput);
  const value = await page.locator(".lyric-input-tab .lyric-editor-textarea").inputValue();
  await navigateToTab(page, TabId.SongInfo);
  return value;
}

test.describe("Karaoke Builder Studio files", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
  });

  test("loading a KBP file fills in the lyrics, timings and song details", async ({ page }) => {
    await page.locator(KBP_INPUT).setInputFiles(getFixturePath("song.kbp"));

    // The lead-in syllable is dropped, which the box lists.
    await expect(page.locator(".toast")).toContainText("with a few changes");
    await expect(page.locator(".toast")).toContainText(
      "Its song is The Placeholders - Pale Moon.flac",
    );
    const warnings = page.locator(".kbp-files .kbp-warnings");
    await expect(warnings).toContainText("Some parts couldn't be carried over");
    await expect(warnings).toContainText('A lead-in syllable "➣➣➣" was dropped');
    await expect(page.locator('[name="kbp-file-upload"] .file-name')).toHaveText("song.kbp");
    await expect(page.locator('[name="title"]')).toHaveValue("Pale Moon");
    await expect(page.locator('[name="artist"]')).toHaveValue("The Placeholders");
    expect(await lyricsEditorValue(page)).toBe(IMPORTED_LYRICS);

    // Clearing the KBP input takes its list with it.
    await page.locator('[name="kbp-file-upload"] button.is-danger').click();
    await expect(warnings).toBeHidden();

    // A timings file now exists to replace, which the Timings File input asks about.
    await page
      .locator('[name="timings-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("timings.json"));
    await expect(page.locator(".modal-card-title")).toHaveText("Replace your timings?");
  });

  test("asks before a KBP file replaces loaded lyrics, and offers them first", async ({ page }) => {
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));
    const original = await lyricsEditorValue(page);

    await page.locator(KBP_INPUT).setInputFiles(getFixturePath("song.kbp"));
    await expect(page.locator(".modal-card-title")).toHaveText("Replace your lyrics and timings?");
    await expect(page.locator(".modal-card-body")).toContainText("song.kbp");
    const links = page.locator(".modal-card-body .source-file-links");
    await expect(links).toContainText("lyrics.txt");
    await expect(links).toContainText("settings.yaml");
    await page.click('.modal-card-foot button:has-text("Keep what I have")');

    await expect(page.locator('[name="kbp-file-upload"] .file-name')).toHaveText("No file chosen");
    expect(await lyricsEditorValue(page)).toBe(original);

    await page.locator(KBP_INPUT).setInputFiles(getFixturePath("song.kbp"));
    await page.click('.modal-card-foot button:has-text("Replace")');

    await expect(page.locator('[name="kbp-file-upload"] .file-name')).toHaveText("song.kbp");
    // The lyrics input no longer describes what is loaded.
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    expect(await lyricsEditorValue(page)).toBe(IMPORTED_LYRICS);
  });

  test("a project folder doesn't load a KBP file", async ({ page }) => {
    const folder = test.info().outputPath("kbp-only");
    await fs.mkdir(folder, { recursive: true });
    await fs.copyFile(getFixturePath("song.kbp"), path.join(folder, "song.kbp"));

    await page.locator('[name="project-folder-upload"] input[type="file"]').setInputFiles(folder);

    await expect(page.locator('.toast:has-text("Nothing to load")')).toBeVisible();
    expect(await lyricsEditorValue(page)).toBe("");
  });

  test("the Submit tab downloads the project as a KBP file of its own", async ({ page }) => {
    await page.locator(KBP_INPUT).setInputFiles(getFixturePath("song.kbp"));
    await navigateToTab(page, TabId.Submit);

    const downloading = page.waitForEvent("download");
    await page.click('a[title="download Karaoke Builder Studio project"]');
    const download = await downloading;

    expect(download.suggestedFilename()).toBe("project.kbp");
    const kbp = await fs.readFile((await download.path()) as string, "utf8");
    expect(kbp).toContain("\r\nTitle     Pale Moon\r\n");
    expect(kbp).toContain("\r\nPale /         420/438/0\r\n");
    // Not among the project's own files.
    await expect(page.locator(".source-file-links")).not.toContainText(".kbp");
  });
});
