import { expect, Page, test } from "@playwright/test";
import fs from "fs/promises";
import {
  defaultTestConfig,
  getFixturePath,
  navigateToTab,
  setupTestEnvironment,
  TabId,
  uploadAudioFile,
} from "./utils";

const JOB_HASH = "b".repeat(64);

async function separate(page: Page) {
  await page.getByRole("button", { name: "Separate Track" }).click();
}

test.describe("Separating again over tracks that are already loaded", () => {
  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page);

    // The first separation finishes at once. Later ones never finish,
    // so the test can look at a separation in progress.
    let requests = 0;
    await context.route("**/separate_track", async (route) => {
      requests++;
      if (requests === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/zip",
          body: await fs.readFile(getFixturePath("split_song.zip")),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ finishedTrackURL: `/separated_track/${JOB_HASH}` }),
      });
    });
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
  });

  test("separates beside an uploaded backing track without asking", async ({ page }) => {
    await page
      .locator('[name="backing-track-upload"] input[type="file"]')
      .setInputFiles(getFixturePath(defaultTestConfig.audioFile));

    await separate(page);

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(/^Succeeded in/)).toBeVisible();
    await expect(page.locator('[name="backing-track-upload"] .file-name')).toHaveText(
      defaultTestConfig.audioFile,
    );
  });

  test("asks before replacing the tracks the same model made", async ({ page }) => {
    await separate(page);
    await expect(page.getByText(/^Succeeded in/)).toBeVisible();

    await separate(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Separate again?")).toBeVisible();
    await expect(dialog).toContainText("backing.");
    await dialog.getByRole("button", { name: "Separate again" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator(".separation-progress")).toBeVisible();
  });

  test("leaves the model's tracks alone when the confirmation is declined", async ({ page }) => {
    await separate(page);
    await expect(page.getByText(/^Succeeded in/)).toBeVisible();

    await separate(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Keep what I have" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator(".separation-progress")).toBeHidden();
  });

  test("separates with another model without asking", async ({ page }) => {
    await separate(page);
    await expect(page.getByText(/^Succeeded in/)).toBeVisible();

    await page.getByRole("radio", { name: /BS-Roformer/ }).check({ force: true });
    await separate(page);

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator(".separation-progress")).toBeVisible();
  });
});
