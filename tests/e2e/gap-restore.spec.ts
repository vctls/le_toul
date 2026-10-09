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
  uploadTimingsFile,
  mockSeparateTrackApi,
  fieldFor,
} from "./utils";

// The last line ends at 8 s, so the rest of the song is a gap the default settings restore.
const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";

test.describe("Gap restore", () => {
  test.describe.configure({ timeout: 300000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("renders the restored backing track, with the plain one as an MKV alternate", async ({
    page,
    context,
  }) => {
    await mockSeparateTrackApi(context);

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, LYRICS);
    await navigateToTab(page, TabId.SongInfo);
    await uploadTimingsFile(page, FIXTURE_TIMINGS);

    await navigateToTab(page, TabId.Submit);
    await expect(fieldFor(page, "Restore Gaps").getByRole("checkbox")).not.toBeChecked();
    await fieldFor(page, "Restore Gaps").locator(".switch").click();
    await expect(fieldFor(page, "Restore Gaps").getByRole("checkbox")).toBeChecked();
    await fieldFor(page, "Video Format").locator("select").selectOption("mkv");

    const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
    await page.click('button:has-text("Create Video")');
    const download = await downloadPromise;

    const zip = await JSZip.loadAsync(await fs.readFile((await download.path()) as string));
    const videoName = Object.keys(zip.files).find((name) => name.endsWith(".mkv"));
    const video = await zip.file(videoName as string)!.async("nodebuffer");
    expect(video.includes("Backing track, gaps restored")).toBe(true);
    // The plain backing track's own title, which the restored one's also contains.
    expect(video.toString("latin1").split("Backing track").length - 1).toBe(2);
  });
});
