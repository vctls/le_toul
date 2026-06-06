import { test } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockSeparateTrackApiDirect,
  expectTabToBeDisabled,
  expectTabToBeEnabled,
  expectVideoCreationToBeDisabled,
  expectVideoCreationToBeEnabled,
  loadAndEnterTimings,
  expectSuccessMessage,
  expectFileDownload
} from './utils';

test.describe('Separate Track Direct Response', () => {
  test.describe.configure({ timeout: 300000 }); // 5 minutes

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Create a complete karaoke track when separate_track returns ZIP directly', async ({ page, context }) => {
    // Setup API mock to return ZIP directly (simulating non-cached behavior)
    await mockSeparateTrackApiDirect(context);

    // Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);

    // Wait for the separation to complete
    await page.waitForTimeout(2000); // Give some time for the API call to complete

    // Verify Song Timing tab is initially disabled
    await expectTabToBeDisabled(page, TabId.SongTiming);

    // Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // Go back to Song Info tab to refresh tab states
    await navigateToTab(page, TabId.SongInfo);

    // Verify Song Timing tab is now enabled
    await expectTabToBeEnabled(page, TabId.SongTiming);

    // Verify the Submit tab is reachable but video creation is not yet available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeDisabled(page);

    // Navigate to Song Timing tab
    await navigateToTab(page, TabId.SongTiming);

    // Load and enter timings from fixture file
    await loadAndEnterTimings(page, defaultTestConfig.timingsFile);

    // Verify success message
    await expectSuccessMessage(page, '.song-timing-tab');

    // Navigate to Submit tab and verify video creation is now available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeEnabled(page);

    // Click Create Video
    await page.click('button:has-text("Create Video")');

    // Wait for video download and verify
    const VIDEO_CREATION_TIMEOUT = 180000; // 3 minutes
    const videoPath = await expectFileDownload(page, VIDEO_CREATION_TIMEOUT);
    console.log('Video download path:', videoPath);
  });
});