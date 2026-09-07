import { test, expect, Page } from '@playwright/test';
import path from 'path';
import {
  setupTestEnvironment,
  navigateToTab,
  TabId,
  getFixturesDir,
  defaultTestConfig,
  setupBasicInputs,
  uploadTimingsFile,
} from './utils';

const FONT_UPLOAD = '[name="custom-font-upload"] input[type="file"]';
const FONT_SELECT = '.settings-column select';
// The Adjust tab mounts a subtitle display of its own, so stay inside the Submit tab.
const SUBTITLE_CANVAS = '.submit-tab canvas.subtitle-canvas';

// A bundled font stands in for the user's own file; its family name ("Metal Mania")
// deliberately differs from the file name.
function bundledFontPath(): string {
  return path.join(getFixturesDir(), '../../api/assets/fonts/MetalMania.ttf');
}

function canvasPixels(page: Page): Promise<string> {
  return page
    .locator(SUBTITLE_CANVAS)
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

function isCanvasBlank(page: Page): Promise<boolean> {
  return page.locator(SUBTITLE_CANVAS).evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    return !data.some((channel) => channel !== 0);
  });
}

async function openFontSettings(page: Page): Promise<void> {
  await navigateToTab(page, TabId.Submit);
  await page.click("a:has-text('Fonts and Colors')");
}

test.describe('Custom Font Upload', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test('an uploaded font overrides the picked one and survives a reload', async ({ page }) => {
    await openFontSettings(page);
    await expect(page.locator(FONT_SELECT)).toHaveValue('Arial Narrow');

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator('.toast:has-text("Metal Mania")')).toBeVisible();
    await expect(page.locator('.custom-font-help')).toContainText('Metal Mania');
    // The picker keeps its own value, so removing the font restores it.
    await expect(page.locator(FONT_SELECT)).toHaveValue('Arial Narrow');

    await page.reload();
    await openFontSettings(page);

    await expect(page.locator('.custom-font-help')).toContainText('Metal Mania');
  });

  test('removing the font falls back to the picked one', async ({ page }) => {
    await openFontSettings(page);
    await page.locator(FONT_SELECT).selectOption('Impact');
    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());
    await expect(page.locator('.custom-font-help')).toContainText('Metal Mania');

    await page.locator('[name="custom-font-upload"] button.is-danger').click();

    await expect(page.locator('.custom-font-help')).toHaveCount(0);
    await expect(page.locator(FONT_SELECT)).toHaveValue('Impact');
  });

  test('the preview redraws the lyrics in the uploaded font', async ({ page }) => {
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
      defaultTestConfig.title
    );
    await uploadTimingsFile(page, defaultTestConfig.timingsFile);
    await openFontSettings(page);
    // Seeking paints the frame at that moment; libass only draws on a time update.
    await page.locator('.submit-tab .preview-container audio').evaluate((el: HTMLAudioElement) => {
      el.muted = true;
      el.currentTime = 1;
    });
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
    const beforeUpload = await canvasPixels(page);
    // The frame at a fixed time is stable, so a difference after the upload can only come
    // from the font libass drew with.
    expect(await canvasPixels(page)).toBe(beforeUpload);

    await page.locator(FONT_UPLOAD).setInputFiles(bundledFontPath());

    await expect(page.locator('.custom-font-help')).toContainText('Metal Mania');
    // The renderer is replaced, so give it until it has drawn something different.
    await expect.poll(() => canvasPixels(page), { timeout: 15000 }).not.toBe(beforeUpload);
    await expect.poll(() => isCanvasBlank(page)).toBe(false);
  });

  test('a file that is not a font is reported and ignored', async ({ page }) => {
    await openFontSettings(page);

    await page.locator(FONT_UPLOAD).setInputFiles({
      name: 'not-really.ttf',
      mimeType: 'font/ttf',
      buffer: Buffer.from('just some text'),
    });

    await expect(page.locator('.toast.is-danger')).toBeVisible();
    await expect(page.locator('.custom-font-help')).toHaveCount(0);
    await expect(page.locator(FONT_SELECT)).toHaveValue('Arial Narrow');
  });
});
