import { test, expect, Page, Request } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  lyricsEditor,
} from "./utils";

// The fixture lyrics with lines 2 and 3 in Japanese,
// split into as many segments as the fixture timings expect.
const CJK_LYRICS = [
  "Went_out_last_night,_had_a_great_big_fight",
  "残/酷/な/天/使/の/テー/ゼ",
  "窓/辺/か/ら/や/が/て",
  "The_gal_I_was_with_was_gone",
].join("\n");
const CJK_FONT_FILE = "NotoSansCJKjp-Regular.otf";
const ADJUST_PLAYER = ".timing-adjustment-tab audio[controls]";
const SUBMIT_PLAYER = ".preview-container audio";
// Both previews show the Japanese lines here, the Submit one after its title screen.
const CJK_LINE_SECONDS = 12;

function recordFontRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes(CJK_FONT_FILE)) {
      requests.push(request);
    }
  });
  return requests;
}

/**
 * Seek a player and wait until it has landed, so the preview it drives draws that moment.
 */
async function seek(page: Page, player: string, seconds: number): Promise<void> {
  await page.locator(player).evaluate(
    (el: HTMLAudioElement, time) =>
      new Promise<void>((resolve) => {
        el.addEventListener("seeked", () => resolve(), { once: true });
        el.currentTime = time;
      }),
    seconds,
  );
}

test.describe("CJK font", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("starts downloading as soon as the lyrics contain CJK", async ({ page }) => {
    const requests = recordFontRequests(page);
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, "Went_out_last_night\n");
    // Long enough for a download the Latin line wrongly set off to have started.
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(0);

    const download = page.waitForResponse((r) => r.url().includes(CJK_FONT_FILE));
    await lyricsEditor(page).pressSequentially("残酷");

    expect((await download).status()).toBe(200);
  });

  // The renderer must not fetch any of the font while drawing, whichever renderer it is:
  // fetching on the first frame that shows a character delays that frame.
  test("is downloaded whole before a preview draws it", async ({ page }) => {
    const requests = recordFontRequests(page);
    await navigateToTab(page, TabId.SongInfo);
    await uploadAudioFile(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    const download = page.waitForResponse((r) => r.url().includes(CJK_FONT_FILE));
    await navigateToTab(page, TabId.LyricInput);
    await loadAndEnterLyrics(page, CJK_LYRICS);
    await (await download).finished();

    await navigateToTab(page, TabId.SongInfo);
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await navigateToTab(page, TabId.TimingAdjustment);
    await seek(page, ADJUST_PLAYER, CJK_LINE_SECONDS);
    await navigateToTab(page, TabId.Submit);
    await seek(page, SUBMIT_PLAYER, CJK_LINE_SECONDS);
    // Long enough for both previews to have drawn the Japanese lines.
    await page.waitForTimeout(1000);

    expect(requests.map((r) => r.headers()["range"] ?? "whole file")).toEqual(["whole file"]);
  });
});
