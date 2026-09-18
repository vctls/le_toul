import { test, expect } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  setupBasicInputs,
  regionLocator,
  scrollWaveformIntoView,
} from "./utils";

// Segments start at 1, 3, 5 and 7 seconds, so consecutive rectangles sit two seconds apart.
const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";

// page.url() lags a history.replaceState, so read the fragment from the page itself.
const fragment = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.location.hash);

test.describe("Tab URL fragment", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("the fragment follows the active tab", async ({ page }) => {
    expect(await fragment(page)).toBe("");

    await navigateToTab(page, TabId.LyricInput);
    await expect.poll(() => fragment(page)).toBe("#lyrics");

    await navigateToTab(page, TabId.Submit);
    await expect.poll(() => fragment(page)).toBe("#submit");
  });

  test("an unknown fragment falls back to the first tab", async ({ page }) => {
    await page.goto("/#not-a-tab");

    await expect(page.locator("nav.tabs li.is-active")).toHaveText("Intro");
    await expect.poll(() => fragment(page)).toBe("#help");
  });

  // The Song Timing tab is gated on the song file, which comes back from IndexedDB after the first paint,
  // so this covers landing on a step that isn't reachable yet.
  test("a reload returns to the step named by the fragment", async ({ page }) => {
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );

    await navigateToTab(page, TabId.SongTiming);
    await expect.poll(() => fragment(page)).toBe("#timing");

    await page.reload();

    await expect(page.locator('h2:has-text("Song Timing")')).toBeVisible();
    expect(await fragment(page)).toBe("#timing");
  });

  test("reloading onto the Adjust tab lays its rectangles out against the audio", async ({
    page,
  }) => {
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
    await expect.poll(() => fragment(page)).toBe("#adjust");

    await page.reload();
    await expect(page.locator('h2:has-text("Adjust Timings")')).toBeVisible();
    await scrollWaveformIntoView(page);

    // The waveform has no duration to lay regions out against until the audio is decoded. Laid out too early,
    // they collapse onto the left edge or never render.
    const xs: number[] = [];
    for (let segment = 0; segment < 4; segment++) {
      const region = regionLocator(page, segment);
      await expect(region).toBeVisible();
      const box = await region.boundingBox();
      xs.push(box!.x);
    }
    // The fixture spaces every segment two seconds apart, so the rectangles are
    // evenly spread however wide the waveform ends up being.
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(gaps[0]).toBeGreaterThan(10);
    for (const gap of gaps.slice(1)) {
      expect(gap).toBeCloseTo(gaps[0], 0);
    }
  });
});
