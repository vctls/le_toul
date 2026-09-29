import { test, expect, Page, CDPSession } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  savedSegments,
} from "./utils";

// A phone held sideways, which gives the Timing tab's waveform the whole screen.
const PHONE_LANDSCAPE = { width: 844, height: 390 };

async function loadSong(page: Page, lyrics: string, timings?: string) {
  await navigateToTab(page, TabId.SongInfo);
  await uploadAudioFile(
    page,
    defaultTestConfig.audioFile,
    defaultTestConfig.artist,
    defaultTestConfig.title,
  );
  await navigateToTab(page, TabId.LyricInput);
  await loadAndEnterLyrics(page, lyrics);
  if (timings) await uploadTimingsFile(page, timings);
  // The full-screen layout hides the tab's heading, which navigateToTab waits for.
  await page.click(`nav.tabs .${TabId.TimingAdjustment}`);
}

function songTime(page: Page): Promise<number> {
  return page
    .locator(".timing-adjustment-tab audio[controls]")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
}

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points: { x: number; y: number }[],
) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

test.describe("Tap mode on a phone held sideways", () => {
  test.describe.configure({ timeout: 60000 });
  test.use({ viewport: PHONE_LANDSCAPE, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("gives the whole screen to the waveform, with the buttons floating over it", async ({
    page,
  }) => {
    await loadSong(page, "One\nTwo\nThree");
    const stage = page.locator(".timing-adjustment-tab .waveform-stage");
    await expect(stage).toBeVisible();
    await expect
      .poll(async () => (await stage.boundingBox())?.height)
      .toBeGreaterThan(PHONE_LANDSCAPE.height - 5);
    const stageBox = (await stage.boundingBox())!;
    expect(stageBox.width).toBeGreaterThan(PHONE_LANDSCAPE.width - 5);

    const buttons = page.getByRole("group", { name: "Timing buttons" });
    const end = (await buttons.getByRole("button", { name: "End" }).boundingBox())!;
    const start = (await buttons.getByRole("button", { name: "Start" }).boundingBox())!;
    expect(end.x).toBeLessThan(PHONE_LANDSCAPE.width / 4);
    expect(start.x + start.width).toBeGreaterThan((PHONE_LANDSCAPE.width * 3) / 4);
    expect(end.y + end.height).toBeGreaterThan(PHONE_LANDSCAPE.height - 30);
    await page.screenshot({ path: test.info().outputPath("phone-landscape.png") });
  });

  test("taps with the floating buttons", async ({ page }) => {
    await loadSong(page, "One\nTwo");
    const buttons = page.getByRole("group", { name: "Timing buttons" });
    await buttons.getByRole("button", { name: "Play" }).tap();
    await expect.poll(() => songTime(page)).toBeGreaterThan(0.5);
    await buttons.getByRole("button", { name: "Start" }).tap();
    await expect.poll(() => songTime(page)).toBeGreaterThan(1.2);
    await buttons.getByRole("button", { name: "Start" }).tap();
    await buttons.getByRole("button", { name: "Pause" }).tap();

    await expect.poll(async () => (await savedSegments(page))[1]?.start).toBeDefined();
    const [one, two] = await savedSegments(page);
    expect(one.start).toBeGreaterThan(0.5);
    expect(two.start).toBeGreaterThan(1.2);
  });

  test("swipes the playhead along and pinches to zoom", async ({ page }) => {
    // With no timings, the tab is in Tap mode, where the playhead stays in the middle.
    await loadSong(page, "One\nTwo\nThree");
    const stage = page.locator(".timing-adjustment-tab .waveform-stage");
    const box = (await stage.boundingBox())!;
    const y = box.y + box.height * 0.3;
    const cdp = await page.context().newCDPSession(page);

    // Sliding the waveform to the left brings later parts of the song to the playhead.
    const before = await songTime(page);
    await touch(cdp, "touchStart", [{ x: 600, y }]);
    for (let x = 580; x >= 300; x -= 20) await touch(cdp, "touchMove", [{ x, y }]);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => songTime(page)).toBeGreaterThan(before + 0.5);

    const wrapperWidth = () =>
      page
        .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
        .evaluate((wrapper) => wrapper.clientWidth);
    const widthBefore = await wrapperWidth();
    await touch(cdp, "touchStart", [
      { x: 400, y },
      { x: 440, y },
    ]);
    for (let spread = 60; spread <= 300; spread += 20) {
      await touch(cdp, "touchMove", [
        { x: 420 - spread / 2, y },
        { x: 420 + spread / 2, y },
      ]);
    }
    await touch(cdp, "touchEnd", []);
    await expect.poll(wrapperWidth).toBeGreaterThan(widthBefore * 2);
  });

  test("opens the settings in a drawer, and gives the other tabs back", async ({ page }) => {
    await loadSong(page, "One\nTwo");
    await page.getByRole("button", { name: "Settings" }).tap();
    await expect(page.getByRole("button", { name: "Tap", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("phone-settings.png") });

    await page.getByRole("button", { name: "Show the other tabs" }).tap();
    await expect(
      page.getByRole("heading", { level: 2, name: "Timing", exact: true }),
    ).toBeVisible();
  });
});

test.describe("Tap mode on a phone held upright", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("suggests turning the phone sideways", async ({ page }) => {
    await setupTestEnvironment(page);
    await loadSong(page, "One\nTwo");
    await expect(page.getByText("Turn your phone sideways")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("phone-portrait.png"), fullPage: true });
  });
});
