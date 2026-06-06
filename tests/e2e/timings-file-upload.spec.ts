import { test, expect } from '@playwright/test';
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  expectVideoCreationToBeDisabled,
  expectVideoCreationToBeEnabled
} from './utils';

test.describe('Timings File Upload', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('Create Video becomes available after uploading timings file', async ({ page }) => {
    // 1. Navigate to Song Info tab and upload audio
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist, defaultTestConfig.title);

    // 2. Navigate to Lyrics tab and enter lyrics
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, defaultTestConfig.lyricsFile);

    // 3. Verify the Submit tab is reachable but video creation is not yet available
    await navigateToTab(page, TabId.Submit);
    await expectVideoCreationToBeDisabled(page);

    // 4. Upload timings file through advanced options in Song Info tab
    await navigateToTab(page, TabId.SongInfo);
    await page.click("button:has-text('Advanced')");
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);

    // 5. Navigate to Submit tab and verify video creation is now available
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator('button:has-text("Create Video")')).toBeVisible();
    await expectVideoCreationToBeEnabled(page);
  });
});
