/**
 * Timing helpers for Playwright tests
 */
import { Page, Locator, expect } from '@playwright/test';
import { TabId, navigateToTab } from './navigation';
import { loadFixtureJson } from './setupHelpers';
import { DEFAULT_VOICE_ID } from '../../../frontend/lib/voices';

// Define the format of a timing entry
export interface TimingEntry {
  time: number;
  type: 1 | 2; // 1 = Space (start), 2 = Enter (end)
}

/**
 * Toggles playback in the timing tab
 */
export async function togglePlayback(page: Page): Promise<void> {
  if (!await page.locator('.song-timing-tab').isVisible()) {
    await navigateToTab(page, TabId.SongTiming);
  }

  await page.click(".song-timing-tab button[name='song-timing-play-pause']");
}

/**
 * Enters a series of timings based on provided timing data
 * Each timing entry contains a time and a type (1 = Space for start, 2 = Enter for end)
 */
export async function enterTimings(page: Page, timings: TimingEntry[]): Promise<void> {
  if (!await page.locator('.song-timing-tab').isVisible()) {
    await navigateToTab(page, TabId.SongTiming);
  }

  // Start playback
  await togglePlayback(page);

  // Schedule against the batch start, not the previous press: cumulative
  // scheduling lets key-press latency drift into the recorded timestamps.
  const startedAt = Date.now();
  for (const timing of timings) {
    const key = timing.type === 1 ? 'Space' : 'Enter';
    const remaining = timing.time * 1000 - (Date.now() - startedAt);
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    await page.keyboard.press(key);
  }

  // Stop playback
  await togglePlayback(page);
}

/**
 * Loads timings from a JSON file and enters them
 * The file should contain an array of [time, type] tuples
 */
export async function loadAndEnterTimings(page: Page, timingsFilename: string): Promise<void> {
  // Load the timings file
  const timingsData = await loadFixtureJson<[number, number][]>(timingsFilename);

  // Convert to TimingEntry format
  const timings: TimingEntry[] = timingsData.map(([time, type]) => ({
    time,
    type: type as 1 | 2
  }));

  // Enter the timings
  await enterTimings(page, timings);
}

/**
 * Drags one edge of a region by `offset` pixels and waits for it to land.
 */
async function dragRegionHandle(
  page: Page,
  region: Locator,
  side: 'left' | 'right',
  offset: number
): Promise<void> {
  const handle = region.locator(`[part="region-handle region-handle-${side}"]`);
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error(`Could not get boundingBox for the ${side} handle`);
  }

  const edgeOf = (b: { x: number; width: number } | null) =>
    b === null ? undefined : side === 'left' ? b.x : b.x + b.width;
  const before = edgeOf(await region.boundingBox());

  const fromX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const toX = fromX + offset;
  if (toX < 0) {
    throw new Error(`Drag target ${toX}px is off-screen; offset ${offset} is too large`);
  }

  await page.mouse.move(fromX, y);
  await page.mouse.down();
  // wavesurfer's makeDraggable accumulates per-move deltas and ignores anything
  // under its threshold, so step the pointer instead of jumping in one move.
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(() => region.boundingBox().then(edgeOf), {
      message: `region ${side} edge should move by ${offset}px`,
    })
    .not.toBe(before);
}

/**
 * Adjusts timing for a specific segment by dragging its region handles.
 * Offsets are in pixels: the Adjust tab renders one second as `zoom` pixels
 * (50 by default), so -25 moves a start a half second earlier.
 */
export async function adjustTiming(
  page: Page,
  segmentIndex: number,
  startOffset: number = 0,
  endOffset: number = 0
): Promise<void> {
  if (!await page.locator('.timing-adjustment-tab').isVisible()) {
    await navigateToTab(page, TabId.TimingAdjustment);
  }

  const region = page.locator(`[part="region segment_${segmentIndex}"]`);
  await expect(region).toBeVisible();

  if (startOffset !== 0) {
    await dragRegionHandle(page, region, 'left', startOffset);
  }

  if (endOffset !== 0) {
    await dragRegionHandle(page, region, 'right', endOffset);
  }
}

/**
 * Gets the current timings by navigating to Submit tab and copying timings.json to clipboard
 */
export async function getCurrentTimings(page: Page): Promise<any> {
  // Navigate to Submit tab
  await navigateToTab(page, TabId.Submit);

  // Click the "copy to clipboard" button for timings.json
  const timingsClipboardButton = page.locator('a[title="copy timings to clipboard"]');
  await timingsClipboardButton.click();

  // Wait for toast notification confirming copy
  await page.locator('.toast.is-success').waitFor({ state: 'visible' });

  // Read clipboard content
  const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());

  const exported = JSON.parse(clipboardContent);
  // The export is a per-voice map; these helpers assert against one voice's stream.
  // Older exports were a bare array.
  return Array.isArray(exported) ? exported : (exported[DEFAULT_VOICE_ID] ?? []);
}
