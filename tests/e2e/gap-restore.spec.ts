import { test, expect, Page } from "@playwright/test";
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
  enableAdvancedMode,
  scrollWaveformIntoView,
  waveformPixelsPerSecond,
} from "./utils";
import { DEFAULT_VOICE_ID } from "../../frontend/lib/voices";

// One 1-2 s, Two 3-5 s, Three 5-6 s and Four 7-8 s. The rest of the song is a gap the default
// settings restore.
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

async function setupMixMode(page: Page) {
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
  await navigateToTab(page, TabId.TimingAdjustment);
  await page.getByRole("button", { name: "Mix", exact: true }).click();
  const restoreGaps = page.getByRole("checkbox", { name: "Restore gaps", exact: true });
  // Buefy hides the input under its switch.
  await restoreGaps.check({ force: true });
  await expect(restoreGaps).toBeChecked();
  await scrollWaveformIntoView(page);
  await expect(page.locator('[part~="mix-frame"]')).toHaveCount(4);
}

function firstSegment(page: Page) {
  return page.evaluate(
    (voice) => JSON.parse(localStorage.getItem("timings._segments")!)[voice][0],
    DEFAULT_VOICE_ID,
  );
}

test.describe("Mix mode frames", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await enableAdvancedMode(page);
  });

  test("stores a dragged edge, stopped at the line's end, through a reload, and resets it", async ({
    page,
  }) => {
    await setupMixMode(page);
    const frame = page.locator('[part~="mix-frame"]').first();
    const borderRight = () => frame.evaluate((el) => getComputedStyle(el).borderRightStyle);
    await expect.poll(borderRight).toBe("dashed");

    // The first line's frame ends 1.5 s after its line, far less than ten seconds back.
    const endEdge = page.locator('[part~="mix-frame-end"]').first();
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const box = (await endEdge.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 10 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => firstSegment(page)).toMatchObject({ muteEnd: 2 });
    await expect.poll(borderRight).toBe("solid");

    await page.reload();
    await navigateToTab(page, TabId.TimingAdjustment);
    await scrollWaveformIntoView(page);
    await expect.poll(borderRight).toBe("solid");

    const reset = page.getByRole("button", { name: "Reset mute times" });
    await expect(reset).toBeEnabled();
    await page.locator('[part~="mix-frame-end"]').first().dblclick();
    await expect.poll(() => firstSegment(page).then((segment) => segment.muteEnd)).toBe(undefined);
    await expect.poll(borderRight).toBe("dashed");
    await expect(reset).toBeDisabled();
  });
});
