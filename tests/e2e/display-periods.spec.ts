import { test, expect, Page } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  scrollWaveformIntoView,
  waveformPixelsPerSecond,
  adjustTiming,
} from "./utils";
import { DEFAULT_VOICE_ID } from "../../frontend/lib/voices";

// One screen of four lines: One 1-2 s, Two 3-5 s, Three 5-6 s and Four 7-8 s.
const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";

/**
 * The Adjust tab's switch field.
 * The Submit tab has a field with the same words once a bound is stored.
 */
function displayTimesField(page: Page) {
  return page.locator(".timing-adjustment-tab .field.is-horizontal", {
    hasText: "Line display times",
  });
}

async function setupDisplayMode(page: Page) {
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
  await displayTimesField(page).locator(".switch").click();
  await scrollWaveformIntoView(page);
  await expect(page.locator('[part="display-band"]')).toHaveCount(4);
}

function firstSegment(page: Page) {
  return page.evaluate(
    (voice) => JSON.parse(localStorage.getItem("timings._segments")!)[voice][0],
    DEFAULT_VOICE_ID,
  );
}

/**
 * Drag the first line's end edge ten seconds back.
 */
async function dragFirstEndEdgeBack(page: Page) {
  // The first line shows until its screen ends at 8 s. Far more than the six seconds back to its
  // own end at 2 s.
  const endEdge = page
    .locator('[part="display-band"]')
    .first()
    .locator('[part~="display-band-end"]');
  const pixelsPerSecond = await waveformPixelsPerSecond(page);
  const box = (await endEdge.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 10 * pixelsPerSecond, y, { steps: 10 });
  await page.mouse.up();
}

function playhead(page: Page) {
  return page.locator(".timing-adjustment-tab audio[controls]").evaluate((audio) => {
    return (audio as HTMLAudioElement).currentTime;
  });
}

test.describe("Adjust tab display mode", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("stores a dragged edge, stopped at the line's syllables, and resets it on a double-click", async ({
    page,
  }) => {
    await setupDisplayMode(page);
    await expect(page.locator('[part~="region"]')).toHaveCount(0);

    const frame = page.locator('[part="display-band"]').first();
    const endEdge = frame.locator('[part~="display-band-end"]');
    const borderRight = () => frame.evaluate((el) => getComputedStyle(el).borderRightStyle);
    await expect.poll(borderRight).toBe("dashed");

    await dragFirstEndEdgeBack(page);

    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });
    await expect.poll(borderRight).toBe("solid");

    const before = await playhead(page);
    await endEdge.dblclick();

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBe(undefined);
    await expect.poll(borderRight).toBe("dashed");
    expect(await playhead(page)).toBe(before);
  });

  test("puts every line back on the automatic times once Reset all is confirmed", async ({
    page,
  }) => {
    await setupDisplayMode(page);
    const resetAll = displayTimesField(page).getByRole("button", {
      name: "Reset all",
    });
    await expect(resetAll).toBeDisabled();

    await dragFirstEndEdgeBack(page);
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });

    await resetAll.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reset all" }).click();

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBe(undefined);
    const frame = page.locator('[part="display-band"]').first();
    await expect
      .poll(() => frame.evaluate((el) => getComputedStyle(el).borderRightStyle))
      .toBe("dashed");
    await expect(resetAll).toBeDisabled();
  });

  test("pushes a stored end along when a syllable is dragged past it", async ({ page }) => {
    await setupDisplayMode(page);
    await dragFirstEndEdgeBack(page);
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });

    const displayTimes = displayTimesField(page).locator(".switch");
    await displayTimes.click();
    // The next line starts at 3 s, which leaves room to end the first one half a second later.
    await adjustTiming(page, 0, 0, 0.5 * (await waveformPixelsPerSecond(page)));

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBeGreaterThan(2.4);
    const { end, displayEnd } = await firstSegment(page);
    expect(displayEnd).toBeCloseTo(end, 5);

    await displayTimes.click();
    await scrollWaveformIntoView(page);
    const frame = page.locator('[part="display-band"]').first();
    const wrapper = page.locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]');
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const frameBox = (await frame.boundingBox())!;
    const wrapperBox = (await wrapper.boundingBox())!;
    const frameEnd = (frameBox.x + frameBox.width - wrapperBox.x) / pixelsPerSecond;
    expect(frameEnd).toBeCloseTo(displayEnd, 1);
    expect(await frame.evaluate((el) => getComputedStyle(el).borderRightStyle)).toBe("solid");
  });
});
