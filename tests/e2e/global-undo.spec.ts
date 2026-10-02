import { expect, test } from "@playwright/test";
import {
  defaultTestConfig,
  navigateToTab,
  savedSegments,
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

test.describe("Global undo", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await navigateToTab(page, TabId.SongInfo);
    // The Timing tab needs a song.
    await uploadAudioFile(page, defaultTestConfig.audioFile, defaultTestConfig.artist);
    await page
      .locator('[name="timings-file-upload"] input[type="file"]')
      .setInputFiles(TIMINGS_TEXT);
    await expect.poll(async () => (await savedSegments(page)).length).toBe(3);
  });

  test("brings back the timings a paste removed, after a timing edit in another tab", async ({
    page,
  }) => {
    const timed = await savedSegments(page);
    await navigateToTab(page, TabId.LyricInput);
    const lyrics = page.getByRole("textbox", { name: "Lyrics" });
    const original = await lyrics.inputValue();

    await lyrics.evaluate((textarea: HTMLTextAreaElement) => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length - 2, textarea.value.length);
    });
    await page.evaluate(() => navigator.clipboard.writeText("la_li"));
    await page.keyboard.press("ControlOrMeta+V");
    await expect(lyrics).toHaveValue(original.slice(0, -2) + "la_li");
    await expect(page.getByText("This paste lost the timings of 2 syllables.")).toBeVisible();

    await navigateToTab(page, TabId.TimingAdjustment);
    await page.getByRole("button", { name: "Reset timings" }).click();
    await expect.poll(async () => (await savedSegments(page)).some((s) => s.start)).toBe(false);

    await navigateToTab(page, TabId.LyricInput);
    const undo = page
      .getByRole("navigation", { name: "main navigation" })
      .getByRole("button", { name: "Undo", exact: true });
    await undo.click();
    await undo.click();

    await expect(lyrics).toHaveValue(original);
    await expect.poll(() => savedSegments(page)).toEqual(timed);
  });

  test("undoes a lyric edit with the shortcut from the Timing tab", async ({ page }) => {
    await navigateToTab(page, TabId.LyricInput);
    const lyrics = page.getByRole("textbox", { name: "Lyrics" });
    const original = await lyrics.inputValue();
    await lyrics.press("End");
    await lyrics.pressSequentially(" again");

    await navigateToTab(page, TabId.TimingAdjustment);
    await page.keyboard.press("ControlOrMeta+Z");
    await expect(page.getByText("Undid Typing (Lyrics)")).toBeVisible();

    await navigateToTab(page, TabId.LyricInput);
    await expect(lyrics).toHaveValue(original + " ");
  });
});
