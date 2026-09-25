import { test, expect, Page } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturePath,
  loadFixtureFile,
  expectVideoCreationToBeEnabled,
} from "./utils";

// The title the folder's settings.yaml carries. Deliberately not the one in the song's own tags,
// so the Song Title field shows which of the two won.
const RESTORED_TITLE = "Prove It On Me Blues (restored)";

async function makeFolder(name: string): Promise<string> {
  const folder = test.info().outputPath(name);
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

// A folder shaped like an extracted export: every source file, plus the two the app has nothing to do with.
async function makeProjectFolder(): Promise<string> {
  const folder = await makeFolder("project");
  await fs.copyFile(getFixturePath(defaultTestConfig.audioFile), path.join(folder, "song.mp3"));
  await fs.copyFile(getFixturePath("lyrics.txt"), path.join(folder, "lyrics.txt"));
  await fs.copyFile(getFixturePath("timings.json"), path.join(folder, "timings.json"));
  await fs.writeFile(
    path.join(folder, "settings.yaml"),
    (await loadFixtureFile("settings.yaml")).replace(
      `title: ${defaultTestConfig.title}`,
      `title: ${RESTORED_TITLE}`,
    ),
  );
  await fs.writeFile(path.join(folder, "subtitles.ass"), "[Script Info]\n");
  await fs.writeFile(
    path.join(folder, `${defaultTestConfig.artist} - ${RESTORED_TITLE} [karaoke].mp4`),
    "",
  );
  return folder;
}

async function loadProjectFolder(page: Page, folder: string): Promise<void> {
  await navigateToTab(page, TabId.SongInfo);
  await page.locator('[name="project-folder-upload"] input[type="file"]').setInputFiles(folder);
}

test.describe("Project Folder Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("loading a project folder puts the whole song back together", async ({ page }) => {
    await loadProjectFolder(page, await makeProjectFolder());

    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();

    // The settings file's song details stand, rather than the tags inside the song file.
    await expect(page.locator('[name="title"]')).toHaveValue(RESTORED_TITLE);
    await expect(page.locator('[name="artist"]')).toHaveValue(defaultTestConfig.artist);
    await expect(
      page.locator('.separation-model-radios input[value="UVR-MDX-NET-Inst_HQ_3.onnx"]'),
    ).toBeChecked();

    // Each file lands in the field that would have taken it on its own.
    await expect(page.locator('[name="settings-file-upload"] .file-name')).toHaveText(
      "settings.yaml",
    );
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("song.mp3");

    await navigateToTab(page, TabId.LyricInput);
    await expect(page.locator(".lyric-input-tab .lyric-editor-textarea")).toHaveValue(
      await loadFixtureFile("lyrics.txt"),
    );

    // Song, lyrics and finished timings are all back, so the video can be built.
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);
  });

  test("a folder holding only some of the files loads just those", async ({ page }) => {
    const folder = await makeFolder("partial");
    await fs.copyFile(getFixturePath("lyrics.txt"), path.join(folder, "lyrics.txt"));

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Loaded lyrics.")')).toBeVisible();
    await expect(page.locator('[name="lyrics-file-upload"] .file-name')).toHaveText("lyrics.txt");
    await expect(page.locator('[name="settings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    await expect(page.locator('[name="song-file-upload"] .file-name')).toHaveText("No file chosen");
  });

  test("a folder with nothing to load says so", async ({ page }) => {
    const folder = await makeFolder("empty");
    await fs.writeFile(path.join(folder, "notes.docx"), "");

    await loadProjectFolder(page, folder);

    await expect(page.locator('.toast:has-text("Nothing to load")')).toBeVisible();
  });

  test("asks before a folder replaces loaded files, and offers them first", async ({ page }) => {
    const folder = await makeProjectFolder();
    await navigateToTab(page, TabId.SongInfo);
    await page
      .locator('[name="lyrics-file-upload"] input[type="file"]')
      .setInputFiles(getFixturePath("lyrics.txt"));

    await loadProjectFolder(page, folder);
    await expect(page.locator(".modal-card-title")).toHaveText("Load this project folder?");
    await expect(page.locator(".modal-card-body")).toContainText(
      "replace your lyrics and settings",
    );
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText("lyrics.txt");
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText(
      "settings.yaml",
    );
    await page.click('.modal-card-foot button:has-text("Keep what I have")');

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="project-folder-upload"] .file-name')).toHaveText(
      "No folder chosen",
    );
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "No file chosen",
    );

    await loadProjectFolder(page, folder);
    await page.click('.modal-card-foot button:has-text("Load folder")');

    await expect(page.locator('.toast:has-text("Loaded")')).toBeVisible();
    await expect(page.locator('[name="project-folder-upload"] .file-name')).toHaveText("project");
    await expect(page.locator('[name="timings-file-upload"] .file-name')).toHaveText(
      "timings.json",
    );
  });
});
