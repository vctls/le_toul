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
  dragRegionBody,
  waveformPixelsPerSecond,
  expectRegionSelected,
  regionLocator,
  scrollWaveformIntoView,
  getCurrentTimings,
  expectTimingsToMatch,
} from "./utils";
import type { Page } from "@playwright/test";

// Segments 1 and 2 of the fixture are joined: segment 1 has no end marker, so
// it runs up to segment 2's start and has to stretch when segment 2 moves.
const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";

async function setupAdjustTab(page: Page) {
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
}

/**
 * Drags a box over the waveform from `from` to `to`, each a time in seconds and the segment whose
 * row it is level with.
 */
async function dragBox(
  page: Page,
  from: { time: number; row: number },
  to: { time: number; row: number },
): Promise<void> {
  const wrapper = await page
    .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
    .boundingBox();
  const pixelsPerSecond = await waveformPixelsPerSecond(page);
  const point = async ({ time, row }: { time: number; row: number }) => {
    const box = await regionLocator(page, row).boundingBox();
    return { x: wrapper!.x + time * pixelsPerSecond, y: box!.y + box!.height / 2 };
  };
  const start = await point(from);
  const end = await point(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

test.describe("Adjust tab region selection", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("drags every rectangle in the selection and stretches the joined neighbour", async ({
    page,
  }) => {
    await setupAdjustTab(page);

    // Clicking a second rectangle selects the run between the two.
    await clickRegion(page, 2);
    await clickRegion(page, 3);
    await expectRegionSelected(page, 2);
    await expectRegionSelected(page, 3);
    await expectRegionSelected(page, 0, false);

    await dragRegionBody(page, 2, -0.5 * (await waveformPixelsPerSecond(page)));

    // Segment 1 is open-ended, so it grows to meet segment 2 where it landed.
    const openEnded = await regionLocator(page, 1).boundingBox();
    const moved = await regionLocator(page, 2).boundingBox();
    expect(openEnded!.x + openEnded!.width).toBeCloseTo(moved!.x, 0);

    await expectTimingsToMatch(
      await getCurrentTimings(page),
      [
        [1, 1],
        [2, 2],
        [3, 1],
        [4.5, 1],
        [5.5, 2],
        [6.5, 1],
        [7.5, 2],
      ],
      0.1,
    );
  });

  test("stops the selection at the rectangle outside it", async ({ page }) => {
    await setupAdjustTab(page);

    await clickRegion(page, 2);
    await expectRegionSelected(page, 2);

    // Far more room than the one second of gap before segment 3.
    await dragRegionBody(page, 2, 5 * (await waveformPixelsPerSecond(page)));

    await expectTimingsToMatch(
      await getCurrentTimings(page),
      [
        [1, 1],
        [2, 2],
        [3, 1],
        [6, 1],
        [7, 2],
        [7, 1],
        [8, 2],
      ],
      0.1,
    );
  });

  test("clicking a selected rectangle clears the selection", async ({ page }) => {
    await setupAdjustTab(page);

    await clickRegion(page, 1);
    await clickRegion(page, 3);
    await expectRegionSelected(page, 2);

    await clickRegion(page, 2);
    await expectRegionSelected(page, 1, false);
    await expectRegionSelected(page, 2, false);
    await expectRegionSelected(page, 3, false);
  });

  test("dragging across the waveform selects the rectangles in that stretch of time", async ({
    page,
  }) => {
    await setupAdjustTab(page);

    // Nothing is drawn between segment 2's end at 6 s and segment 3's start at 7 s.
    // The drag stays in segment 3's row, which holds none of the others.
    await dragBox(page, { time: 6.5, row: 3 }, { time: 1.5, row: 3 });

    await expectRegionSelected(page, 0);
    await expectRegionSelected(page, 1);
    await expectRegionSelected(page, 2);
    await expectRegionSelected(page, 3, false);
    await expect(page.locator('[part="selection-marquee"]')).toHaveCount(0);

    // A box that touches nothing clears the selection.
    await dragBox(page, { time: 6.2, row: 0 }, { time: 6.8, row: 3 });
    await expectRegionSelected(page, 0, false);
    await expectRegionSelected(page, 2, false);
  });
});
