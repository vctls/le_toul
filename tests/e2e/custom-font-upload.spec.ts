import { test, expect, Page } from "@playwright/test";
import path from "path";
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturesDir,
  defaultTestConfig,
  setupBasicInputs,
  uploadTimingsFile,
  exactFieldFor,
} from "./utils";

const FONT_UPLOAD = '[name="custom-font-upload"] input[type="file"]';
// The Adjust tab mounts a subtitle display of its own, so stay inside the Submit tab.
const SUBTITLE_CANVAS = ".submit-tab canvas.subtitle-canvas";

function fontSelect(page: Page) {
  return exactFieldFor(page, "Font").locator("select");
}

// A bundled font stands in for the user's own file. Its family name ("Metal Mania")
// deliberately differs from the file name.
function bundledFontPath(): string {
  return path.join(getFixturesDir(), "../../api/assets/fonts/MetalMania.ttf");
}

function canvasPixels(page: Page): Promise<string> {
  return page.locator(SUBTITLE_CANVAS).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

function isCanvasBlank(page: Page): Promise<boolean> {
  return page.locator(SUBTITLE_CANVAS).evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return !data.some((channel) => channel !== 0);
  });
}

// The panel starts open, so clicking the trigger unconditionally would close it.
async function openFontSettings(page: Page): Promise<void> {
  await navigateToTab(page, TabId.Submit);
  const trigger = page.locator(".collapse-trigger a", { hasText: "Fonts and Colors" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(fontSelect(page)).toBeVisible();
}

test.describe("Custom Font Upload", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("an uploaded font overrides the picked one and survives a reload", async ({ page }) => {
    await openFontSettings(page);
    await expect(fontSelect(page)).toHaveValue("Arial Narrow");

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator('.toast:has-text("Metal Mania")')).toBeVisible();
    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
    // The picker keeps its own value, so removing the font restores it.
    await expect(fontSelect(page)).toHaveValue("Arial Narrow");

    await expect(page.locator(".source-file-links")).toContainText("MetalMania.ttf");

    await page.reload();
    await openFontSettings(page);

    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
  });

  test("removing the font falls back to the picked one", async ({ page }) => {
    await openFontSettings(page);
    await fontSelect(page).selectOption("Impact");
    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());
    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");

    await page.locator('[name="custom-font-upload"] button.is-danger').click();

    await expect(page.locator(".custom-font-help")).toHaveCount(0);
    await expect(fontSelect(page)).toHaveValue("Impact");
  });

  test("the preview redraws the lyrics in the uploaded font", async ({ page }) => {
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title,
    );
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await openFontSettings(page);
    // The first line is already showing at 0 seconds,
    // so a non-blank canvas alone doesn't mean the seek below has been drawn.
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
    const atStart = await canvasPixels(page);
    // Seeking paints the frame at that moment, since libass only draws on a time update.
    await page.locator(".submit-tab .preview-container audio").evaluate((el: HTMLAudioElement) => {
      el.muted = true;
      el.currentTime = 1;
    });
    await expect.poll(() => canvasPixels(page)).not.toBe(atStart);
    const beforeUpload = await canvasPixels(page);
    // The frame at a fixed time is stable, so a difference after the upload can only come
    // from the font libass drew with.
    expect(await canvasPixels(page)).toBe(beforeUpload);

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator(".custom-font-help")).toContainText("Metal Mania");
    // The renderer is replaced, so give it until it has drawn something different.
    await expect.poll(() => canvasPixels(page), { timeout: 15000 }).not.toBe(beforeUpload);
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
  });

  test("a file that is not a font is reported and ignored", async ({ page }) => {
    await openFontSettings(page);

    await page.locator(FONT_UPLOAD).setInputFiles({
      name: "not-really.ttf",
      mimeType: "font/ttf",
      buffer: Buffer.from("just some text"),
    });

    await expect(page.locator(".toast.is-danger")).toBeVisible();
    await expect(page.locator(".custom-font-help")).toHaveCount(0);
    await expect(fontSelect(page)).toHaveValue("Arial Narrow");
  });

  test("a voice takes its own uploaded font, kept across a reload and dropped on Start over", async ({
    page,
  }) => {
    await navigateToTab(page, TabId.SongInfo);
    await page.locator('[name="lyrics-file-upload"] input[type="file"]').setInputFiles({
      name: "duet.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("[Anna] la_la\n[Ben] hm_hm"),
    });
    await openFontSettings(page);

    const ben = page.locator(".voice-style").filter({ hasText: "Ben" });
    await ben.locator(".switch").click();
    await ben.locator('.voice-font-upload input[type="file"]').setInputFiles(bundledFontPath());

    await expect(ben.locator(".voice-font-help")).toContainText("Rendering Ben in “Metal Mania”");
    await expect(
      page.locator(".voice-style").filter({ hasText: "Anna" }).locator(".voice-font-help"),
    ).toHaveCount(0);

    await page.reload();
    await navigateToTab(page, TabId.Submit);
    await expect(ben.locator(".voice-font-help")).toContainText("Metal Mania");

    await page.click('button[title="Discard the saved session and start fresh"]');
    await expect(page.locator(".modal-card-body .source-file-links")).toContainText(
      "MetalMania.ttf",
    );
    await page.click('.modal-card-foot button:has-text("Start over")');

    await navigateToTab(page, TabId.SongInfo);
    await page.locator('[name="lyrics-file-upload"] input[type="file"]').setInputFiles({
      name: "duet.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("[Anna] la_la\n[Ben] hm_hm"),
    });
    await navigateToTab(page, TabId.Submit);
    await expect(page.locator(".voice-font-help")).toHaveCount(0);
  });
});
