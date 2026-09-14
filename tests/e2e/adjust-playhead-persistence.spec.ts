import { test, expect, Page } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  regionLocator,
  scrollWaveformIntoView,
} from "./utils";

const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";
const PLAYER = ".timing-adjustment-tab audio[controls]";
const WAVEFORM = ".timing-adjustment-tab .wavesurfer-container";
// Enough that the waveform has to scroll to show the playhead.
const ZOOM = 300;
const SEEK_SECONDS = 15;

interface WaveformView {
  cursorLeft: string;
  cursorPx: number;
  scrollLeft: number;
  clientWidth: number;
}

function waveformView(page: Page): Promise<WaveformView> {
  return page.locator(WAVEFORM).evaluate((el) => {
    const shadow = (el.querySelector("div") as HTMLElement & { shadowRoot?: ShadowRoot })
      .shadowRoot!;
    const cursor = shadow.querySelector(".cursor") as HTMLElement;
    const scroll = shadow.querySelector(".scroll") as HTMLElement;
    return {
      cursorLeft: cursor.style.left,
      cursorPx:
        cursor.getBoundingClientRect().left -
        scroll.getBoundingClientRect().left +
        scroll.scrollLeft,
      scrollLeft: scroll.scrollLeft,
      clientWidth: scroll.clientWidth,
    };
  });
}

function cursorIsOnScreen(v: WaveformView): boolean {
  return v.cursorPx >= v.scrollLeft && v.cursorPx <= v.scrollLeft + v.clientWidth;
}

test.describe("Adjust tab playhead", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("stays in sync with the player after leaving and returning to the tab", async ({ page }) => {
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
    await scrollWaveformIntoView(page);
    await expect(regionLocator(page, 0)).toBeVisible();

    const zoom = page
      .locator(".adjustment-form .field.is-horizontal", { hasText: "Waveform zoom" })
      .locator("input");
    await zoom.fill(String(ZOOM));
    await zoom.blur();

    await page.locator(PLAYER).evaluate((el: HTMLAudioElement, time) => {
      el.currentTime = time;
    }, SEEK_SECONDS);
    await expect.poll(() => waveformView(page).then((v) => v.scrollLeft)).toBeGreaterThan(0);
    const before = await waveformView(page);

    await navigateToTab(page, TabId.LyricInput);
    await navigateToTab(page, TabId.TimingAdjustment);
    await scrollWaveformIntoView(page);

    // WaveSurfer centers the cursor only when the redraw beats the seek, so after the round
    // trip the offset is either centered or merely far enough to bring the cursor on screen.
    await expect.poll(() => waveformView(page).then(cursorIsOnScreen)).toBe(true);
    const after = await waveformView(page);
    expect(after.scrollLeft).toBeGreaterThan(0);
    expect(after.cursorLeft).toBe(before.cursorLeft);
    expect(
      await page.locator(PLAYER).evaluate((el: HTMLAudioElement) => el.currentTime),
    ).toBeCloseTo(SEEK_SECONDS, 1);
  });
});
