import { test, expect } from "@playwright/test";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  mockLyricsLookup,
  defaultTestConfig,
  expectLyricsText,
} from "./utils";

const PROVIDER = { id: "fake", name: "Fake Lyrics", url: "https://lyrics.test" };

const RESULT = {
  lyrics: "[Chorus]\nVel oma trin\nSossa lein",
  instrumental: false,
  match: {
    title: "Glim Tovar",
    artist: "The Wendels",
    album: "Pellow",
    duration: 201,
    url: "https://lyrics.test/7",
  },
};

test.describe("Lyrics lookup", () => {
  let lookups: unknown[];

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    lookups = await mockLyricsLookup(page, { provider: PROVIDER, result: RESULT });
    // The app asks for the provider once, as it starts.
    await page.reload();
  });

  test("a tagged song fills empty lyrics", async ({ page }) => {
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );

    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, "Vel oma trin\nSossa lein");
    await expect(page.getByRole("status")).toContainText(
      "Lyrics from Fake Lyrics: The Wendels – Glim Tovar (Pellow, 3:21).",
    );
    expect(lookups).toEqual([
      expect.objectContaining({
        title: defaultTestConfig.title,
        artist: defaultTestConfig.artist,
      }),
    ]);
  });

  test("a song loaded over existing lyrics leaves them alone", async ({ page }) => {
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, "Prel dova");

    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await page.locator('[name="title"]').focus();
    await page.locator('[name="title"]').blur();
    await page.waitForTimeout(500);

    expect(lookups).toEqual([]);
    await navigateToTab(page, TabId.LyricInput);
    await expectLyricsText(page, "Prel dova");
  });
});
