import { expect, test } from "@playwright/test";
import {
  defaultTestConfig,
  navigateToTab,
  setupTestEnvironment,
  TabId,
  uploadAudioFile,
} from "./utils";

const JOB_HASH = "a".repeat(64);

test.describe("Cancelling a separation", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("stops the separation and calls the job off on the backend", async ({ page, context }) => {
    await context.route("**/separate_track", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ finishedTrackURL: `/separated_track/${JOB_HASH}` }),
      }),
    );

    // A job that never finishes, so only a cancel can end it.
    await context.route("**/separated_track/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "processing",
          pollIntervalSeconds: 1,
          progress: 0.1,
          stage: "separating the vocals",
        }),
      }),
    );

    let cancelledJob: string | null = null;
    await context.route("**/separated_track/*/cancel", async (route, request) => {
      cancelledJob = new URL(request.url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cancelled: true }),
      });
    });

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile);

    await page.click('button:has-text("Separate Track")');
    await expect(page.locator(".separation-progress")).toBeVisible();

    await page.click('button:has-text("Cancel")');

    await expect(page.locator(".separation-progress")).toBeHidden();
    await expect(page.locator('button:has-text("Cancel")')).toBeHidden();
    await expect.poll(() => cancelledJob).toBe(`/separated_track/${JOB_HASH}/cancel`);
  });
});
