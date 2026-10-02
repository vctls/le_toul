import { expect, test } from "@playwright/test";
import {
  defaultTestConfig,
  dragRegionBody,
  expectRegionSelected,
  navigateToTab,
  regionLocator,
  savedSegments,
  scrollWaveformIntoView,
  setupTestEnvironment,
  TabId,
  uploadAudioFile,
} from "./utils";

// Two lines, "ka den" and "lu". A timings.txt holds its syllables' text, so it carries its lyrics.
const TIMINGS_TEXT = {
  name: "timings.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(
    [
      "Toul timings 1",
      "",
      'voice "Voice 1"',
      "",
      "-",
      '"ka "  00:01.00',
      '"den"  00:02.00  00:02.50',
      "-",
      "",
      "-",
      '"lu"   00:03.00',
      "-",
      "",
    ].join("\n"),
  ),
};

test.describe("Timings to review after a lyric edit", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist);
    await page
      .locator('[name="timings-file-upload"] input[type="file"]')
      .setInputFiles(TIMINGS_TEXT);
    await expect.poll(async () => (await savedSegments(page)).length).toBe(3);
  });

  test("shows the flagged syllables, goes to the first, and a drag clears its flag", async ({
    page,
  }) => {
    await navigateToTab(page, TabId.LyricInput);
    const lyrics = page.getByRole("textbox", { name: "Lyrics" });
    const original = await lyrics.inputValue();
    // One word replaced by another, and one by two.
    const pasted = original.replace("den", "ben").replace(/lu$/, "la_li");

    await lyrics.evaluate((textarea: HTMLTextAreaElement) => textarea.select());
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasted);
    await page.keyboard.press("ControlOrMeta+V");
    await expect(lyrics).toHaveValue(pasted);

    const toast = page.getByRole("alertdialog");
    await expect(toast).toContainText("This paste moved 2 timings to replaced words.");
    await toast.getByRole("button", { name: "Show" }).click();

    await scrollWaveformIntoView(page);
    await expectRegionSelected(page, 1);
    for (const index of [1, 2]) {
      await expect(regionLocator(page, index)).toBeVisible();
    }
    const markers = page.locator('[part="review-marker"]');
    await expect(markers).toHaveCount(2);
    for (const marker of await markers.all()) {
      await expect(marker).toBeVisible();
    }
    await expect(page.getByTitle("2 syllables to review")).toBeVisible();

    await dragRegionBody(page, 1, -20);

    await expect.poll(async () => (await savedSegments(page))[1].review).toBeUndefined();
    await expect(markers).toHaveCount(1);
    await expect(page.getByTitle("1 syllable to review")).toBeVisible();
  });
});
