import { test, expect, Page } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  enableAdvancedMode,
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

async function setupDisplayMode(page: Page, lyrics = LYRICS, timings = FIXTURE_TIMINGS) {
  await navigateToTab(page, TabId.SongInfo);
  await uploadAudioFile(
    page,
    defaultTestConfig.audioFile,
    defaultTestConfig.artist,
    defaultTestConfig.title,
  );
  await navigateToTab(page, TabId.LyricInput);
  await loadAndEnterLyrics(page, lyrics);
  await navigateToTab(page, TabId.SongInfo);
  await uploadTimingsFile(page, timings);
  await navigateToTab(page, TabId.TimingAdjustment);
  await displayTimesField(page).locator(".switch").click();
  await scrollWaveformIntoView(page);
  await expect(page.locator('[part="display-band"]')).toHaveCount(lyrics.split(/\n+/).length);
}

/**
 * The handle on one side of a line's frame. The handles are drawn apart from the frames.
 */
function handle(page: Page, side: "start" | "end", line = 0) {
  return page.locator(`[part~="display-band-${side}"]`).nth(line);
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
  const endEdge = handle(page, "end");
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
    await enableAdvancedMode(page);
  });

  test("stores a dragged edge, stopped at the line's syllables, and resets it on a double-click", async ({
    page,
  }) => {
    await setupDisplayMode(page);
    await expect(page.locator('[part~="region"]')).toHaveCount(0);

    const frame = page.locator('[part="display-band"]').first();
    const endEdge = handle(page, "end");
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

  test("tints the hovered or dragged frame, and the frames of lines at its height", async ({
    page,
  }) => {
    // Two screens of two lines, so One and Three share a height, and so do Two and Four.
    await setupDisplayMode(page, "One\nTwo\n\nThree\nFour");
    const frames = page.locator('[part="display-band"]');
    const fills = () =>
      frames.evaluateAll((all) => all.map((frame) => getComputedStyle(frame).backgroundColor));
    const none = "rgba(0, 0, 0, 0)";
    await expect.poll(fills).toEqual([none, none, none, none]);

    await frames.nth(1).hover();
    const [, active, , sameHeight] = await fills();
    expect(active).not.toBe(none);
    expect(sameHeight).not.toBe(none);
    expect(sameHeight).not.toBe(active);
    await expect.poll(fills).toEqual([none, active, none, sameHeight]);

    // The tint follows a drag after the pointer has left the frame.
    const box = (await handle(page, "end").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 10 });
    await expect.poll(fills).toEqual([active, none, sameHeight, none]);

    await page.mouse.up();
    await page.mouse.move(0, 0);
    await expect.poll(fills).toEqual([none, none, none, none]);
  });

  test("stops a dragged end at the line at its height, which then appears as it ends", async ({
    page,
  }) => {
    // Two screens of two lines, so One and Three share a height. Three is sung from 5 s.
    await setupDisplayMode(page, "One\nTwo\n\nThree\nFour");
    const frames = page.locator('[part="display-band"]');
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const box = (await handle(page, "end").boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 5 });
    const wrapper = page.locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]');
    const threeStart = async () => {
      const [frame, waveform] = [await frames.nth(2).boundingBox(), await wrapper.boundingBox()];
      return (frame!.x - waveform!.x) / pixelsPerSecond;
    };
    await expect.poll(threeStart).toBeCloseTo(5, 1);
    await expect(page.locator("[data-overlaps]")).toHaveCount(0);
  });

  test("keeps a handle within reach under the frame of another line in its row", async ({
    page,
  }) => {
    // One and Six share the first row. Six's screen shows from when One's ends until 12 s,
    // and Four, at One's height, is sung from 7 s.
    await setupDisplayMode(
      page,
      "One\nTwo\n\nThree\nFour\nFive\nSix",
      "timings-adjust-six-lines.json",
    );
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const endEdge = handle(page, "end");
    // One's end meets Six's start, so this grabs the half of the edge inside One's frame.
    let box = (await endEdge.boundingBox())!;
    let x = box.x + box.width / 4;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 4 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 7 });

    box = (await endEdge.boundingBox())!;
    x = box.x + box.width / 2;
    const topmost = await endEdge.evaluate(
      (edge, [x, y]) => edge.contains((edge.getRootNode() as ShadowRoot).elementFromPoint(x, y)),
      [x, y],
    );
    expect(topmost).toBe(true);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 10 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });
  });
});
