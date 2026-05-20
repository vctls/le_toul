/**
 * Assertion helpers for Playwright tests
 */
import { Page, expect } from '@playwright/test';
import { TabId, isTabEnabled } from './navigation';
import { getCurrentTimings } from './timings';

/**
 * Checks if lyrics have been successfully loaded
 */
export async function expectLyricsToBeLoaded(page: Page): Promise<void> {
  // Check if the lyrics textarea has content
  const textArea = page.locator('.lyric-input-tab .lyric-editor-textarea');
  await expect(textArea).not.toHaveValue('');
}

/**
 * Checks if song info (artist and title) has been loaded
 */
export async function expectSongInfoToBeLoaded(page: Page, artist: string, title: string): Promise<void> {
  await expect(page.locator('[name="artist"]')).toHaveValue(artist);
  await expect(page.locator('[name="title"]')).toHaveValue(title);
}

/**
 * Verifies that a success message is displayed in a specific tab
 */
export async function expectSuccessMessage(page: Page, tabSelector: string): Promise<void> {
  await expect(page.locator(`${tabSelector} .message.is-success`)).toBeVisible();
}

/**
 * Verifies that an error message is displayed in a specific tab
 */
export async function expectErrorMessage(page: Page, tabSelector: string): Promise<void> {
  await expect(page.locator(`${tabSelector} .message.is-danger`)).toBeVisible();
}

/**
 * Verifies that timings have been created by checking if the Submit tab is enabled
 */
export async function expectTimingsToBeCreated(page: Page): Promise<void> {
  expect(await isTabEnabled(page, TabId.Submit)).toBeTruthy();
}

/**
 * Verifies that a specific number of lyric segments have been created
 */
export async function expectLyricSegmentsCount(page: Page, count: number): Promise<void> {
  // This will need to be adjusted based on how segments are represented in the UI
  const segments = page.locator('.timing-adjustment-tab .segment');
  await expect(segments).toHaveCount(count);
}

/**
 * Verifies that a download event occurs and returns the downloaded file path
 */
export async function expectFileDownload(page: Page, timeoutMs: number = 60000): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
  const download = await downloadPromise;
  const filePath = await download.path();

  expect(filePath).not.toBeNull();
  return filePath as string;
}

/**
 * Verifies that a specific form input has a value
 */
export async function expectInputToHaveValue(page: Page, selector: string, value: string): Promise<void> {
  await expect(page.locator(selector)).toHaveValue(value);
}

/**
 * Verifies that the video preview is visible and loaded
 */
export async function expectVideoPreviewToBeLoaded(page: Page): Promise<void> {
  const videoPreview = page.locator('.video-preview-tab video');
  await expect(videoPreview).toBeVisible();

  // Check if video has loaded by verifying it has a valid duration
  const hasDuration = await videoPreview.evaluate((el: HTMLVideoElement) => {
    return el.duration > 0 && !isNaN(el.duration);
  });

  expect(hasDuration).toBeTruthy();
}

/**
 * Compares the actual timings with expected timings
 */
export async function expectTimingsToMatch(
  actualTimings: any[],
  expectedTimings: any[],
  tolerance: number = 0.5
): Promise<void> {
  // Check the overall length of the timings array
  expect(actualTimings.length).toBe(expectedTimings.length);

  // Check each timing entry
  for (let i = 0; i < actualTimings.length; i++) {
    const actual = actualTimings[i];
    const expected = expectedTimings[i];

    // Check the structure of each timing (time and marker)
    expect(actual.length).toBe(2);
    expect(expected.length).toBe(2);

    // Check the marker is exactly the same
    expect(actual[1]).toBe(expected[1]);

    // Check the time is within tolerance
    const actualTime = actual[0];
    const expectedTime = expected[0];
    expect(Math.abs(actualTime - expectedTime), `Actual ${actualTime} - Expected ${expectedTime} is greater than tolerance ${tolerance}`).toBeLessThanOrEqual(tolerance);
  }
}

/**
 * Checks that the timing segment at the given index has expected start and end times
 */
export async function expectSegmentTimingsToBe(
  page: Page,
  segmentIndex: number,
  expectedStartTime: number,
  expectedEndTime: number,
  tolerance: number = 0.5
): Promise<void> {
  // Get current timings from clipboard
  const timings = await getCurrentTimings(page);

  // Process the timings to extract segment information
  const processedTimings = [];
  let currentSegment = { startTime: 0, endTime: 0 };

  for (let i = 0; i < timings.length; i++) {
    const [time, marker] = timings[i];
    if (marker === 1) { // Start marker
      if (i > 0 && currentSegment.startTime > 0) {
        processedTimings.push(currentSegment);
      }
      currentSegment = { startTime: time, endTime: 0 };
    } else if (marker === 2) { // End marker
      currentSegment.endTime = time;
    }
  }

  // Add the last segment if it exists
  if (currentSegment.startTime > 0) {
    processedTimings.push(currentSegment);
  }

  const timingData = segmentIndex < processedTimings.length ? processedTimings[segmentIndex] : null;

  expect(timingData).not.toBeNull();
  expect(Math.abs(timingData.startTime - expectedStartTime)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(timingData.endTime - expectedEndTime)).toBeLessThanOrEqual(tolerance);
}
