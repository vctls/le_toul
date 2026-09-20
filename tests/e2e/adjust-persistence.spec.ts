import { test, expect } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApi,
  enterTimings,
} from "./utils";

// The Adjust view is where the slow work happens, so a reload has to put you back where you were
// rather than at 0:00 with the default zoom.
test.describe("Adjust tab persistence", () => {
  test.describe.configure({ timeout: 180000 });

  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page);
    await mockSeparateTrackApi(context);
  });

  test("restores the playhead and player settings across a reload", async ({ page }) => {
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, "one_two_three");
    await enterTimings(page, [
      { time: 1.0, type: 1 },
      { time: 2.0, type: 1 },
      { time: 3.0, type: 1 },
      { time: 4.0, type: 2 },
    ]);

    await navigateToTab(page, TabId.TimingAdjustment);
    const audio = page.locator(".timing-adjustment-tab audio[controls]");
    await audio.waitFor({ state: "attached" });
    await expect
      .poll(async () => audio.evaluate((el: HTMLAudioElement) => el.readyState), { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    await audio.evaluate((el: HTMLAudioElement) => {
      el.currentTime = 2.75;
    });

    // Zoom in far enough that the waveform overflows its viewport.
    const zoomInput = page
      .locator(".timing-adjustment-tab .field", { hasText: "Waveform zoom" })
      .locator('input[type="number"]');
    await zoomInput.fill("300");
    await zoomInput.blur();

    const scroller = page
      .locator(".timing-adjustment-tab .wavesurfer-container div.scroll")
      .first();
    await expect
      .poll(async () => scroller.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth), {
        timeout: 15000,
      })
      .toBeGreaterThan(0);

    // Scroll the waveform away from the start, which a reload used to throw away.
    await scroller.evaluate((el: HTMLElement) => {
      el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
      el.dispatchEvent(new Event("scroll"));
    });
    const scrolledTo = await scroller.evaluate((el: HTMLElement) => el.scrollLeft);
    expect(scrolledTo).toBeGreaterThan(0);
    // The save is throttled to a second.
    await page.waitForTimeout(1500);

    await page.reload();
    await navigateToTab(page, TabId.TimingAdjustment);

    const restored = page.locator(".timing-adjustment-tab audio[controls]");
    await restored.waitFor({ state: "attached" });
    await expect
      .poll(async () => restored.evaluate((el: HTMLAudioElement) => el.currentTime), {
        timeout: 15000,
      })
      .toBeCloseTo(2.75, 1);

    const restoredScroller = page
      .locator(".timing-adjustment-tab .wavesurfer-container div.scroll")
      .first();
    await expect
      .poll(async () => restoredScroller.evaluate((el: HTMLElement) => el.scrollLeft), {
        timeout: 15000,
      })
      .toBeGreaterThan(scrolledTo * 0.8);
  });
});
