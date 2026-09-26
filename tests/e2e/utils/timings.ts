/**
 * Timing helpers for Playwright tests
 */
import { Page, Locator, expect } from "@playwright/test";
import { TabId, navigateToTab } from "./navigation";
import { loadFixtureJson } from "./setupHelpers";
import { DEFAULT_VOICE_ID } from "../../../frontend/lib/voices";

// Define the format of a timing entry
export interface TimingEntry {
  time: number;
  type: 1 | 2; // 1 = Space (start), 2 = Enter (end)
}

/**
 * Toggles playback in the timing tab
 */
export async function togglePlayback(page: Page): Promise<void> {
  if (!(await page.locator(".song-timing-tab").isVisible())) {
    await navigateToTab(page, TabId.SongTiming);
  }

  await page.click(".song-timing-tab button[name='song-timing-play-pause']");
}

/**
 * Enters a series of timings based on provided timing data
 * Each timing entry contains a time and a type (1 = Space for start, 2 = Enter for end)
 */
export async function enterTimings(page: Page, timings: TimingEntry[]): Promise<void> {
  if (!(await page.locator(".song-timing-tab").isVisible())) {
    await navigateToTab(page, TabId.SongTiming);
  }

  // Start playback
  await togglePlayback(page);

  // Schedule against the batch start, not the previous press: cumulative
  // scheduling lets key-press latency drift into the recorded timestamps.
  const startedAt = Date.now();
  for (const timing of timings) {
    const key = timing.type === 1 ? "Space" : "Enter";
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
    type: type as 1 | 2,
  }));

  // Enter the timings
  await enterTimings(page, timings);
}

async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("Could not get boundingBox for the drag target");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Grabs `grab` at its centre, drags it `offset` pixels sideways and waits for
 * `measure` to report a different position.
 */
async function dragBy(
  page: Page,
  grab: Locator,
  offset: number,
  measure: () => Promise<number | undefined>,
  message: string,
): Promise<void> {
  const before = await measure();
  const { x, y } = await centreOf(grab);
  const toX = x + offset;
  if (toX < 0) {
    throw new Error(`Drag target ${toX}px is off-screen; offset ${offset} is too large`);
  }

  await page.mouse.move(x, y);
  await page.mouse.down();
  // wavesurfer's drag stream accumulates per-move deltas and ignores anything under its threshold,
  // so step the pointer instead of jumping in one move.
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(measure, { message }).not.toBe(before);
}

/**
 * Drags one edge of a region by `offset` pixels and waits for it to land.
 */
async function dragRegionHandle(
  page: Page,
  region: Locator,
  side: "left" | "right",
  offset: number,
): Promise<void> {
  const edge = () =>
    region
      .boundingBox()
      .then((box) => (box === null ? undefined : side === "left" ? box.x : box.x + box.width));

  await dragBy(
    page,
    region.locator(`[part="region-handle region-handle-${side}"]`),
    offset,
    edge,
    `region ${side} edge should move by ${offset}px`,
  );
}

/**
 * Brings the Adjust tab's waveform on screen. Its regions are only rendered
 * while it is in the viewport, so nothing is clickable until it has scrolled
 * into view.
 */
export async function scrollWaveformIntoView(page: Page): Promise<void> {
  await page.locator(".timing-adjustment-tab .wavesurfer-container").scrollIntoViewIfNeeded();
}

/** The Adjust tab's rectangle for one lyric segment. */
export function regionLocator(page: Page, segmentIndex: number): Locator {
  return page.locator(`[part="region segment_${segmentIndex}"]`);
}

/**
 * Clicks a rectangle's body, which toggles it into the Adjust tab's selection
 * (or extends the selection to it, if one is already started).
 */
export async function clickRegion(page: Page, segmentIndex: number): Promise<void> {
  const region = regionLocator(page, segmentIndex);
  await expect(region).toBeVisible();
  const { x, y } = await centreOf(region);
  await page.mouse.click(x, y);
}

// Buefy's primary, which a selected rectangle is filled with.
const SELECTED_REGION_COLOR = "rgb(121, 87, 213)";

export async function expectRegionSelected(
  page: Page,
  segmentIndex: number,
  selected = true,
): Promise<void> {
  const fill = expect.poll(
    () => regionLocator(page, segmentIndex).evaluate((el) => el.style.backgroundColor),
    {
      message: `segment ${segmentIndex} should ${selected ? "" : "not "}look selected`,
    },
  );
  if (selected) {
    await fill.toBe(SELECTED_REGION_COLOR);
  } else {
    await fill.not.toBe(SELECTED_REGION_COLOR);
  }
}

/**
 * Drags a rectangle by its body, which moves the whole selection it belongs to.
 * The offset is in pixels; the Adjust tab renders one second as `zoom` pixels.
 */
export async function dragRegionBody(
  page: Page,
  segmentIndex: number,
  offset: number,
): Promise<void> {
  const region = regionLocator(page, segmentIndex);
  await dragBy(
    page,
    region,
    offset,
    () => region.boundingBox().then((box) => box?.x),
    `segment ${segmentIndex} should have moved`,
  );
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
  endOffset: number = 0,
): Promise<void> {
  if (!(await page.locator(".timing-adjustment-tab").isVisible())) {
    await navigateToTab(page, TabId.TimingAdjustment);
  }
  await scrollWaveformIntoView(page);

  const region = regionLocator(page, segmentIndex);
  await expect(region).toBeVisible();

  if (startOffset !== 0) {
    await dragRegionHandle(page, region, "left", startOffset);
  }

  if (endOffset !== 0) {
    await dragRegionHandle(page, region, "right", endOffset);
  }
}

/**
 * Gets the default voice's timings as events, by copying timings.txt from the Submit tab.
 */
export async function getCurrentTimings(page: Page): Promise<any> {
  await navigateToTab(page, TabId.Submit);

  const timingsClipboardButton = page.locator('a[title="copy timings to clipboard"]');
  await timingsClipboardButton.click();
  await page.locator(".toast.is-success").waitFor({ state: "visible" });

  const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
  return eventsFromTimingsText(clipboardContent, DEFAULT_VOICE_ID);
}

/**
 * This reads just the syllable rows, rather than importing the app's parser,
 * because frontend/lib/timingsText pulls in timing.ts and its buefy dependency,
 * which won't resolve in Playwright's Node runtime.
 */
function eventsFromTimingsText(text: string, voice: string): [number, number][] {
  const seconds = (time: string) => {
    const [minutes, rest] = time.split(":");
    return Number(minutes) * 60 + Number(rest);
  };
  const events: [number, number][] = [];
  let current = voice;
  for (const row of text.split("\n")) {
    const voiceRow = row.match(/^voice "((?:[^"\\]|\\.)*)"$/);
    if (voiceRow) {
      current = voiceRow[1].replace(/\\(["\\])/g, "$1");
      continue;
    }
    const syllable = row.match(/^"(?:[^"\\]|\\.)*"\s*(.*)$/);
    if (current !== voice || !syllable) {
      continue;
    }
    const [start, end] = syllable[1].split(/\s+/).filter((value) => value !== "");
    if (start === undefined || start === "-") {
      continue;
    }
    events.push([seconds(start), 1]);
    if (end !== undefined && end !== "-") {
      events.push([seconds(end), 2]);
    }
  }
  return events;
}
