/**
 * Navigation helpers for Playwright tests
 */
import { Page, expect } from "@playwright/test";

/**
 * Tab IDs used in the application
 */
export enum TabId {
  SongInfo = "song-info-tab-header",
  LyricInput = "lyric-input-tab-header",
  SongTiming = "song-timing-tab-header",
  TimingAdjustment = "timing-adjustment-tab-header",
  VideoPreview = "video-preview-tab-header",
  Submit = "submit-tab-header",
  Help = "help-tab-header",
}

/**
 * Navigates to a specific tab and verifies it's visible
 */
export async function navigateToTab(page: Page, tabId: TabId): Promise<void> {
  await page.click(`nav.tabs .${tabId}`);

  // Map of tab IDs to expected header text for verification
  const tabHeaderMap = {
    [TabId.SongInfo]: "Get Your Song Ready",
    [TabId.LyricInput]: "Song Lyrics",
    [TabId.SongTiming]: "Song Timing",
    [TabId.TimingAdjustment]: "Adjust Timings",
    [TabId.VideoPreview]: "Video Preview",
    [TabId.Submit]: "More Settings",
    [TabId.Help]: "Help",
  };

  await expect(page.locator(`h2:has-text("${tabHeaderMap[tabId]}")`)).toBeVisible();
}

/**
 * Checks if a tab is enabled (not disabled)
 */
export async function isTabEnabled(page: Page, tabId: TabId): Promise<boolean> {
  const hasDisabledClass = await page
    .locator(`.${tabId}`)
    .evaluate((el) => el.classList.contains("is-disabled"));
  return !hasDisabledClass;
}

/**
 * Waits for a tab to become enabled
 */
export async function waitForTabToBeEnabled(
  page: Page,
  tabId: TabId,
  timeoutMs = 5000,
): Promise<void> {
  await expect(page.locator(`.${tabId}`)).not.toHaveClass(/is-disabled/, { timeout: timeoutMs });
}

/**
 * Waits for a tab to become disabled
 */
export async function waitForTabToBeDisabled(
  page: Page,
  tabId: TabId,
  timeoutMs = 5000,
): Promise<void> {
  await expect(page.locator(`.${tabId}`)).toHaveClass(/is-disabled/, { timeout: timeoutMs });
}
