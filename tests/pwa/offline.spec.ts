import { test, expect, Page } from "@playwright/test";
import { expectLyricsText, lyricsEditor, navigateToTab, TabId } from "../e2e/utils";
import { AppServer, Gateway, buildApp } from "./server";

const LYRICS = "Sung while the server is away";

const app = new AppServer();
const gateway = new Gateway();

test.beforeAll(async () => {
  buildApp();
  await app.start();
  await gateway.open();
});

test.afterEach(async () => {
  gateway.unavailable = false;
  await gateway.open();
});

test.afterAll(async () => {
  await gateway.close();
  await app.stop();
  // A later case rebuilds with a changed bundle, so this puts back the plain one.
  buildApp();
});

/**
 * Load the app and wait until the service worker controls it, which means its precache is
 * complete.
 */
async function openControlled(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/**
 * Type the lyrics, and wait until they are saved.
 */
async function enterLyrics(page: Page): Promise<void> {
  await navigateToTab(page, TabId.LyricInput);
  await lyricsEditor(page).pressSequentially(LYRICS);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("lyrics.lyricText")))
    .toBe(JSON.stringify(LYRICS));
}

/**
 * Check that the app mounted with the saved lyrics, and can still render.
 */
async function expectAppRestored(page: Page): Promise<void> {
  await navigateToTab(page, TabId.LyricInput);
  await expectLyricsText(page, LYRICS);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}

/**
 * The bundle script the page loaded.
 */
async function bundleScript(page: Page): Promise<string | null> {
  return page.locator('script[src^="/static/bundles/"]').getAttribute("src");
}

test("the app opens offline with the saved project", async ({ page, context }) => {
  await openControlled(page);
  await enterLyrics(page);

  const pageRequests = gateway.pageRequests;
  await context.setOffline(true);
  await page.reload();

  await expectAppRestored(page);
  expect(gateway.pageRequests).toBe(pageRequests);
});

test("the app opens while the server is unreachable", async ({ page }) => {
  await openControlled(page);
  await enterLyrics(page);

  await gateway.close();
  await page.reload();

  await expectAppRestored(page);
});

test("the app opens while the host answers 503", async ({ page }) => {
  await openControlled(page);
  await enterLyrics(page);

  gateway.unavailable = true;
  await page.reload();

  await expectAppRestored(page);
});

test("a new deployment offers to reload into it", async ({ page }) => {
  await openControlled(page);
  const oldBundle = await bundleScript(page);

  await app.stop();
  buildApp({ TUUL_DONATE_URL: "https://example.com/new-version" });
  await app.start();
  // The browser checks for a new worker on navigation and periodically.
  // A check from the open tab stands in for either.
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then((registration) => registration.update()),
  );

  await expect(page.getByText("A new version is available.")).toBeVisible();
  expect(await bundleScript(page)).toBe(oldBundle);
  await page.getByRole("button", { name: "Reload" }).click();

  await expect.poll(() => bundleScript(page)).not.toBe(oldBundle);
  const newBundle = await bundleScript(page);

  // Offline, the new worker serves the new deployment's page.
  await gateway.close();
  await page.reload();
  expect(await bundleScript(page)).toBe(newBundle);
});
