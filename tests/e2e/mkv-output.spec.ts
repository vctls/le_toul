import { test, expect } from "@playwright/test";
import { promises as fs } from "fs";
import JSZip from "jszip";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  loadAndEnterTimings,
  mockSeparateTrackApi,
  fieldFor,
} from "./utils";

test.describe("MKV Output", () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  // The song carries cover art, which ffmpeg picks up as a video stream unless the
  // alternate tracks are mapped to audio alone.
  const COVER_ART_SONG = "Ma Rainey - Prove It on Me Blues, cover art.mp3";

  test("Create a karaoke MKV carrying the vocal and original tracks", async ({ page, context }) => {
    await mockSeparateTrackApi(context);

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, COVER_ART_SONG, defaultTestConfig.artist, defaultTestConfig.title);

    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    await navigateToTab(page, TabId.Submit);
    // An MKV keeps the vocals, so the preview's warning about losing them goes away.
    const previewNote = page.locator(".preview-container .message");
    await expect(previewNote).toContainText("the finished video won't");
    await fieldFor(page, "Video Format").locator("select").selectOption("mkv");
    await expect(previewNote).toBeHidden();

    // Record every step the progress bar names, so the MKV's extra runs are shown to
    // carry it forward instead of leaving it parked at 100%.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as any).__progressSteps = seen;
      const record = () => {
        const shown = document
          .querySelector(".video-creation-progress-indicator")
          ?.textContent?.match(/([A-Za-z ]+): \d+%/);
        if (shown && seen[seen.length - 1] !== shown[1]) seen.push(shown[1]);
      };
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
    await page.click('button:has-text("Create Video")');
    const download = await downloadPromise;

    const steps: string[] = await page.evaluate(() => (window as any).__progressSteps);
    expect(steps).toEqual([
      "Separating the vocals",
      // Named before the first run reports, while the FFmpeg core is still loading.
      "Creating video",
      "Rendering the video",
      "Encoding the vocals track",
      "Encoding the original mix track",
      "Writing the MKV",
      "Packaging the files",
    ]);

    expect(download.suggestedFilename()).toContain("[karaoke].mkv");

    const zipPath = await download.path();
    const zip = await JSZip.loadAsync(await fs.readFile(zipPath as string));
    const videoName = Object.keys(zip.files).find((name) => name.endsWith(".mkv"));
    expect(videoName).toBeDefined();

    const video = await zip.file(videoName as string)!.async("nodebuffer");
    // EBML magic: what ffmpeg writes when the Matroska muxer really ran.
    expect(video.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    // Matroska stores each track's name as UTF-8, so the alternates are visible in the bytes.
    expect(video.includes("Backing track")).toBe(true);
    expect(video.includes("Vocals")).toBe(true);
    expect(video.includes("Original mix")).toBe(true);
  });
});
