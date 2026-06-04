import { test, expect, Page } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  mockSeparateTrackApiDirect,
  waitForTabToBeEnabled,
} from './utils';

const PREVIEW_AUDIO = '.preview-container audio';
const TRACK_SELECT = '.field:has(label:has-text("Preview audio")) select';

interface PreviewAudioState {
  currentTime: number;
  paused: boolean;
  error: string | null;
  src: string;
  readyState: number;
}

function previewAudioState(page: Page): Promise<PreviewAudioState> {
  return page.locator(PREVIEW_AUDIO).evaluate((el: HTMLAudioElement) => ({
    currentTime: el.currentTime,
    paused: el.paused,
    error: el.error ? `${el.error.code}: ${el.error.message}` : null,
    src: el.currentSrc,
    readyState: el.readyState,
  }));
}

// Starts playback the way a user does: a real click on the native play
// control (which also satisfies autoplay policies). Falls back to a direct
// play() call if the coordinate click missed the button.
async function startPreviewPlayback(page: Page): Promise<void> {
  const audio = page.locator(PREVIEW_AUDIO);
  // Mute first: the dockerized browsers have no audio output device, and
  // unmuted playback fails in Firefox with MEDIA_ERR_DECODE
  // (OnMediaSinkAudioError) when it tries to open the missing sink.
  await audio.evaluate((el: HTMLAudioElement) => {
    el.muted = true;
  });
  const box = await audio.boundingBox();
  if (box) {
    // The play button sits at the far left of the native controls
    await audio.click({ position: { x: 20, y: box.height / 2 } });
  }
  const paused = await audio.evaluate((el: HTMLAudioElement) => el.paused);
  if (paused) {
    await audio.evaluate((el: HTMLAudioElement) => el.play());
  }
}

function seekPreview(page: Page, time: number): Promise<void> {
  return page.locator(PREVIEW_AUDIO).evaluate((el: HTMLAudioElement, t) => {
    el.currentTime = t;
  }, time);
}

async function expectPlayingAndAdvancing(page: Page, label: string) {
  await expect
    .poll(async () => (await previewAudioState(page)).paused, {
      message: `audio should be playing: ${label}`,
      timeout: 10000,
    })
    .toBe(false);
  const state = await previewAudioState(page);
  expect(state.error, `audio element error: ${label}`).toBeNull();
  await expect
    .poll(async () => (await previewAudioState(page)).currentTime, {
      message: `playback should advance: ${label}`,
      timeout: 10000,
    })
    .toBeGreaterThan(state.currentTime);
}

test.describe('Submit preview track switching', () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('preview keeps playing across track switches, seeks, and reload', async ({ page, context }) => {
    await mockSeparateTrackApiDirect(context);

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);
    await page.click('button:has-text("Separate Track")');
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);

    await navigateToTab(page, TabId.Submit);
    await expect(page.locator(PREVIEW_AUDIO)).toBeVisible();
    // The track selector appears once separation has finished
    await expect(page.locator(TRACK_SELECT)).toBeVisible({ timeout: 15000 });
    // Wait for the preview audio source to be ready
    await expect
      .poll(async () => (await previewAudioState(page)).src, { timeout: 15000 })
      .not.toBe('');

    await startPreviewPlayback(page);
    await expectPlayingAndAdvancing(page, 'initial playback');

    // Switch to the backing track mid-playback and listen there
    await page.locator(TRACK_SELECT).selectOption('backing');
    await expectPlayingAndAdvancing(page, 'after switching to backing');

    // Seek around manually a few times, like a user dragging the scrubber
    await seekPreview(page, 5);
    await page.waitForTimeout(300);
    await seekPreview(page, 2);
    await page.waitForTimeout(300);
    await seekPreview(page, 8);
    await expectPlayingAndAdvancing(page, 'after manual seeks on backing');

    // Switch back to the full track mid-playback (the reported bug)
    await page.locator(TRACK_SELECT).selectOption('full');
    await expectPlayingAndAdvancing(page, 'after switching back to full');

    // And once more to backing, to catch wedging on repeat switches
    await page.locator(TRACK_SELECT).selectOption('backing');
    await expectPlayingAndAdvancing(page, 'after second switch to backing');

    // Reload the page: the preview must still be playable from restored state
    await page.reload();
    await waitForTabToBeEnabled(page, TabId.Submit, 15000);
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator(PREVIEW_AUDIO)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => (await previewAudioState(page)).src, { timeout: 15000 })
      .not.toBe('');
    await startPreviewPlayback(page);
    await expectPlayingAndAdvancing(page, 'after page reload');
  });
});
