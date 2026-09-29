import { test, expect } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  clickRegion,
  scrollWaveformIntoView,
  regionLocator,
  savedSegments,
  pressAtSongTime,
  SavedSegment,
} from "./utils";

// One segment per line, each starting on an odd second and ending a second later.
const SIX_LINES = "One\nTwo\nThree\nFour\nFive\nSix";
const SIX_LINES_TIMINGS = "timings-adjust-six-lines.json";

// A tap lands this far after the song time it waits for, from key and event latency.
const TAP_TOLERANCE = 0.15;

async function loadSong(page: import("@playwright/test").Page, lyrics: string) {
  await navigateToTab(page, TabId.SongInfo);
  await uploadAudioFile(
    page,
    defaultTestConfig.audioFile,
    defaultTestConfig.artist,
    defaultTestConfig.title,
  );
  await navigateToTab(page, TabId.LyricInput);
  await loadAndEnterLyrics(page, lyrics);
}

function expectTimedNear(segment: SavedSegment, start: number, end?: number) {
  expect(segment.start).toBeGreaterThanOrEqual(start);
  expect(segment.start).toBeLessThan(start + TAP_TOLERANCE);
  if (end === undefined) {
    expect(segment.end).toBeUndefined();
  } else {
    expect(segment.end).toBeGreaterThanOrEqual(end);
    expect(segment.end).toBeLessThan(end + TAP_TOLERANCE);
  }
}

test.describe("Tap mode", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("re-taps a line in the middle, leaves the lines around it, and undoes tap by tap", async ({
    page,
  }) => {
    await loadSong(page, SIX_LINES);
    await uploadTimingsFile(page, SIX_LINES_TIMINGS);
    await navigateToTab(page, TabId.TimingAdjustment);
    await page.getByRole("button", { name: "Tap", exact: true }).click();
    // Tap mode has more settings, which push the waveform down, so it is scrolled to after.
    await scrollWaveformIntoView(page);
    await expect(regionLocator(page, 2)).toBeVisible();
    const before = await savedSegments(page);

    // Three is sung from 5 s to 6 s. Clicking it cues the playhead before it, so the start key
    // plays from there.
    await clickRegion(page, 2);
    await page.keyboard.press("Space");
    await pressAtSongTime(page, 5.4, "Space");
    await pressAtSongTime(page, 5.8, "Enter");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await savedSegments(page))[2].start).not.toBe(5);
    const after = await savedSegments(page);
    expectTimedNear(after[2], 5.4, 5.8);
    expect([...after.slice(0, 2), ...after.slice(3)]).toEqual([
      ...before.slice(0, 2),
      ...before.slice(3),
    ]);

    // The end tap comes off first, then the start tap, which gives Three back its old timing.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await savedSegments(page))[2].end).toBeUndefined();
    expectTimedNear((await savedSegments(page))[2], 5.4);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedSegments(page)).toEqual(before);
  });

  test("keeps the taps of a pass when the page is reloaded mid-song", async ({ page }) => {
    await loadSong(page, SIX_LINES);
    await uploadTimingsFile(page, SIX_LINES_TIMINGS);
    await navigateToTab(page, TabId.TimingAdjustment);
    await page.getByRole("button", { name: "Tap", exact: true }).click();
    await scrollWaveformIntoView(page);
    await expect(regionLocator(page, 2)).toBeVisible();

    await clickRegion(page, 2);
    await page.keyboard.press("Space");
    await pressAtSongTime(page, 5.4, "Space");
    await page.reload();

    await navigateToTab(page, TabId.TimingAdjustment);
    expectTimedNear((await savedSegments(page))[2], 5.4);
    // The tap is also an undo step, which a reload keeps.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await savedSegments(page))[2].start).toBe(5);
  });

  test("times a fresh voice from its first line", async ({ page }) => {
    await loadSong(page, "One\nTwo\nThree");
    await navigateToTab(page, TabId.TimingAdjustment);
    await scrollWaveformIntoView(page);

    // With no timings there is nothing to adjust, so the tab is in Tap mode.
    await expect(page.getByRole("button", { name: "Tap", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Adjust", exact: true })).toBeDisabled();

    await page.keyboard.press("Space");
    await pressAtSongTime(page, 0.5, "Space");
    await pressAtSongTime(page, 1.2, "Space");
    await pressAtSongTime(page, 1.8, "Enter");
    await pressAtSongTime(page, 2.3, "Space");
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await savedSegments(page))[2]?.start).toBeDefined();
    const segments = await savedSegments(page);
    expectTimedNear(segments[0], 0.5);
    expectTimedNear(segments[1], 1.2, 1.8);
    expectTimedNear(segments[2], 2.3);
    await expect(page.getByRole("button", { name: "Adjust", exact: true })).toBeEnabled();
    // Every line has a start, and the last one still needs its end.
    await expect(page.locator(".timing-adjustment-tab").getByText("Almost done!")).toBeVisible();
  });

  test("taps with the on-screen buttons", async ({ page }) => {
    await loadSong(page, "One\nTwo");
    await navigateToTab(page, TabId.TimingAdjustment);
    await page.getByRole("button", { name: "Timing buttons", exact: true }).click();
    const buttons = page.getByRole("group", { name: "Timing buttons" });
    await buttons.scrollIntoViewIfNeeded();

    await buttons.getByRole("button", { name: "Play" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLAudioElement>(".timing-adjustment-tab audio[controls]")!
          .currentTime >= 0.5,
    );
    await buttons.getByRole("button", { name: /^Start/ }).click();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLAudioElement>(".timing-adjustment-tab audio[controls]")!
          .currentTime >= 1.2,
    );
    await buttons.getByRole("button", { name: /^Start/ }).click();
    await buttons.getByRole("button", { name: "Pause" }).click();

    await expect.poll(async () => (await savedSegments(page))[1]?.start).toBeDefined();
    const segments = await savedSegments(page);
    expectTimedNear(segments[0], 0.5);
    expectTimedNear(segments[1], 1.2);
  });
});
