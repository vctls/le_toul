import { expect, test } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApi,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectVideoCreationToBeEnabled,
} from './utils';

const RENDER_START_TIMEOUT = 120000;

test.describe('Cancelling video creation', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('stops the render and offers no download', async ({ page, context }) => {
    await mockSeparateTrackApi(context);

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);

    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    await navigateToTab(page, TabId.SongInfo);
    await navigateToTab(page, TabId.SongTiming);
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);
    await expectSuccessMessage(page, '.song-timing-tab');

    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);
    await page.click('button:has-text("Create Video")');

    const indicator = page.locator('.video-creation-progress-indicator');
    await expect(indicator).toContainText('Rendering the video', { timeout: RENDER_START_TIMEOUT });

    await page.click('button:has-text("Cancel")');

    await expect(indicator).toBeHidden();
    // A cancel is not a failure, so nothing is reported to the user.
    await expect(page.locator('.submit-button-container .message.is-danger')).toBeHidden();

    const download = await page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    expect(download).toBeNull();
  });
});
