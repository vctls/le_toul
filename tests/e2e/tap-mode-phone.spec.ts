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
  playbackPosition,
  regionLocator,
  showTabs,
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
  await showTabs(page);
  await page.click(`nav.tabs .${TabId.TimingAdjustment}`);
  // The drawer slides out over the waveform, and takes touches until it is gone.
  await expect(page.getByRole("tab", { name: "Lyrics" })).toBeHidden();
}

function songTime(page: Page): Promise<number> {
  return playbackPosition(page);
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

  test("opens the menu with the settings, and shows the whole tab", async ({ page }) => {
    await loadSong(page, "One\nTwo");
    const menu = page
      .getByRole("toolbar", { name: "Timing" })
      .getByRole("button", { name: "Menu" });
    await menu.tap();
    await expect(page.getByRole("button", { name: "Tap", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Lyrics" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("phone-settings.png") });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("tab", { name: "Lyrics" })).toBeHidden();

    await menu.tap();
    await page.getByRole("button", { name: "Show the whole tab" }).tap();
    await expect(page.getByRole("tab", { name: "Lyrics" })).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 2, name: "Timing", exact: true }),
    ).toBeVisible();
  });
});

test.describe("Adjust mode on a phone held sideways", () => {
  test.describe.configure({ timeout: 60000 });
  test.use({ viewport: PHONE_LANDSCAPE, hasTouch: true, isMobile: true });

  test("pinches to zoom the waveform, not the page", async ({ page }) => {
    await setupTestEnvironment(page);
    // With timings, the tab opens in Adjust mode, where the waveform scrolls.
    await loadSong(page, defaultTestConfig.lyricsFile, defaultTestConfig.timingsFile);
    // The mode buttons are in the closed drawer.
    await expect(
      page.getByRole("button", { name: "Adjust", exact: true, includeHidden: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const stage = page.locator(".timing-adjustment-tab .waveform-stage");
    const box = (await stage.boundingBox())!;
    const y = box.y + box.height * 0.3;
    const cdp = await page.context().newCDPSession(page);
    const wrapperWidth = () =>
      page
        .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
        .evaluate((wrapper) => wrapper.clientWidth);
    const widthBefore = await wrapperWidth();
    // Firefox for Android zooms the page under a pinch unless its touch moves are canceled.
    await page.evaluate(() => {
      const w = window as Window & { pinchMoves?: boolean[] };
      w.pinchMoves = [];
      window.addEventListener("touchmove", (event) => {
        if (event.touches.length > 1) w.pinchMoves!.push(event.defaultPrevented);
      });
    });

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
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    const pinchMoves = await page.evaluate(
      () => (window as Window & { pinchMoves?: boolean[] }).pinchMoves,
    );
    expect(pinchMoves?.length).toBeGreaterThan(0);
    expect(pinchMoves).not.toContain(false);
  });

  test("zooms when a pinch starts on a region's edge, and leaves the edge alone", async ({
    page,
  }) => {
    await setupTestEnvironment(page);
    await loadSong(page, defaultTestConfig.lyricsFile, defaultTestConfig.timingsFile);
    const region = regionLocator(page, 3);
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    const y = box.y + box.height / 2;
    // A finger on a region's edge resizes it.
    const onHandle = box.x + box.width - 1;
    const before = await savedSegments(page);
    const cdp = await page.context().newCDPSession(page);
    const wrapperWidth = () =>
      page
        .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
        .evaluate((wrapper) => wrapper.clientWidth);
    const widthBefore = await wrapperWidth();

    // One finger on the edge and the other on the waveform beside it, held long enough that a
    // lone finger would start dragging the edge.
    await touch(cdp, "touchStart", [
      { x: onHandle, y },
      { x: onHandle + 150, y },
    ]);
    await page.waitForTimeout(200);
    for (let spread = 10; spread <= 120; spread += 10) {
      await touch(cdp, "touchMove", [
        { x: onHandle - spread, y },
        { x: onHandle + 150 + spread, y },
      ]);
    }
    await touch(cdp, "touchEnd", []);

    await expect.poll(wrapperWidth).toBeGreaterThan(widthBefore * 1.5);
    expect(await savedSegments(page)).toEqual(before);
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
