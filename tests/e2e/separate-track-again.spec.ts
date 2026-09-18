import { expect, test } from "@playwright/test";
import {
  defaultTestConfig,
  getFixturePath,
  navigateToTab,
  setupTestEnvironment,
  TabId,
  uploadAudioFile,
} from "./utils";

const JOB_HASH = "b".repeat(64);

test.describe("Separating again over a track that is already loaded", () => {
  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page);

    await context.route("**/separate_track", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ finishedTrackURL: `/separated_track/${JOB_HASH}` }),
      }),
    );
    // A job that never finishes, so the test can look at a separation in progress.
    await context.route("**/separated_track/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "processing",
          pollIntervalSeconds: 1,
          stage: "separating the vocals",
        }),
      }),
    );

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile);
    await page
      .locator('[name="backing-track-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));
  });

  test("offers the loaded track for download, then unloads it once confirmed", async ({ page }) => {
    await expect(page.locator('button:has-text("Separate Track")')).toBeEnabled();

    await page.click('button:has-text("Separate Track")');

    await expect(page.locator(".modal-card-title")).toHaveText("Separate again?");
    await expect(page.locator(".modal-card-body")).toContainText("accompaniment.wav");

    await page.click('.modal-card-foot button:has-text("Separate again")');

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      "No file chosen",
    );
    await expect(page.locator(".separation-progress")).toBeVisible();
  });

  test("leaves the loaded track alone when the confirmation is declined", async ({ page }) => {
    await page.click('button:has-text("Separate Track")');
    await page.click('.modal-card-foot button:has-text("Keep what I have")');

    await expect(page.locator(".modal-card")).toBeHidden();
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      defaultTestConfig.audioFile,
    );
    await expect(page.locator(".separation-progress")).toBeHidden();
  });
});
