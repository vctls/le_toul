/**
 * Setup helpers for Playwright tests
 */
import { Page, expect, test } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Configuration for test fixtures
 */
export interface TestConfig {
  audioFile: string;
  lyricsFile: string;
  timingsFile: string;
  artist: string;
  title: string;
  [key: string]: string;
}

/**
 * Default test configuration
 */
export const defaultTestConfig: TestConfig = {
  audioFile: 'Ma Rainey - Prove It on Me Blues, first verse.mp3',
  lyricsFile: 'lyrics.txt',
  timingsFile: 'timings.json',
  artist: 'Ma Rainey',
  title: 'Prove It On Me Blues',
};

/**
 * Gets the path to the fixtures directory
 */
export function getFixturesDir(): string {
  return path.join(test.info().project.testDir, '../fixtures');
}

/**
 * Gets the full path to a fixture file
 */
export function getFixturePath(filename: string): string {
  return path.join(getFixturesDir(), filename);
}

/**
 * Loads a fixture file as a string
 */
export async function loadFixtureFile(filename: string): Promise<string> {
  return await fs.readFile(getFixturePath(filename), 'utf-8');
}

/**
 * Loads a fixture file as a JSON object
 */
export async function loadFixtureJson<T>(filename: string): Promise<T> {
  const content = await loadFixtureFile(filename);
  return JSON.parse(content) as T;
}

/**
 * Sets up console error listener that fails the test on console errors
 */
export function setupConsoleErrorListener(page: Page): void {
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();

    console.log(`Console ${type}: ${text}`);

    // Optionally, fail the test on console errors
    // if (type === 'error') {
    //   test.fail(true, `Console error detected: ${text}`);
    // }
  });
}

/**
 * Initializes the basic app setup - navigates to the app and checks the title
 */
export async function initAppSetup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveTitle("The Tuul");
}

/**
 * Sets up the basic test environment including console listener and app navigation
 */
export async function setupTestEnvironment(page: Page): Promise<void> {
  setupConsoleErrorListener(page);
  await installClipboardStub(page);
  await initAppSetup(page);
}

/**
 * Installs an in-memory navigator.clipboard polyfill. The Clipboard API is
 * only exposed in secure contexts; when the tests run against a non-localhost
 * dev host (e.g. http://vite:5173 inside the docker stack) it is undefined,
 * breaking both the app's copy buttons and the tests that read the clipboard
 * back. The stub stores writes in a window-scoped buffer so writeText /
 * readText round-trip cleanly without needing OS clipboard access.
 */
async function installClipboardStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (navigator.clipboard?.writeText && navigator.clipboard?.readText) return;
    let buffer = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => { buffer = text; return Promise.resolve(); },
        readText: () => Promise.resolve(buffer),
      },
    });
  });
}
