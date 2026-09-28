/**
 * API mocking helpers for Playwright tests
 */
import { BrowserContext, Page } from "@playwright/test";
import { promises as fs } from "fs";
import { getFixturePath } from "./setupHelpers";
import JSZip from "jszip";

/**
 * Mocks the separate_track API to return a JSON response with polling URL
 */
export async function mockSeparateTrackApi(
  context: BrowserContext,
  zipFilename: string = "split_song.zip",
): Promise<void> {
  const pollUrl = `https://storage.googleapis.com/test-bucket/separated_tracks/${zipFilename}`;

  // Mock the initial separate_track endpoint to return polling URL
  await context.route("**/separate_track", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        finishedTrackURL: pollUrl,
      }),
    });

    console.log("Mocked separate_track endpoint with polling URL:", pollUrl);
  });

  // Mock the polling endpoint to return the ZIP file
  await mockPollingEndpoint(context, pollUrl);
}

/**
 * Mocks the separate_track API to return a ZIP file directly (for testing non-cached behavior)
 */
export async function mockSeparateTrackApiDirect(
  context: BrowserContext,
  zipFilename: string = "split_song.zip",
): Promise<void> {
  await context.route("**/separate_track", async (route) => {
    // Get the path to the fixture file
    const audioZipPath = getFixturePath(zipFilename);

    // Read the file contents
    const fileBuffer = await fs.readFile(audioZipPath);

    // Fulfill the request with the file
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: fileBuffer,
      headers: {
        "Content-Disposition": "attachment; filename=audio.zip",
      },
    });

    console.log("Mocked separate_track endpoint with direct ZIP file:", audioZipPath);
  });
}

/**
 * Mocks a polling endpoint to return a ZIP file
 */
export async function mockPollingEndpoint(context: BrowserContext, pollUrl: string): Promise<void> {
  await context.route(pollUrl, async (route) => {
    // Extract filename from URL
    const filename = pollUrl.split("/").pop() || "split_song.zip";

    // Get the path to the fixture file
    const audioZipPath = getFixturePath(filename);

    // Read the file contents
    const fileBuffer = await fs.readFile(audioZipPath);

    // Fulfill the request with the file
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: fileBuffer,
      headers: {
        "Content-Disposition": "attachment; filename=audio.zip",
      },
    });

    console.log("Mocked polling endpoint with fixture file:", audioZipPath);
  });
}

/**
 * Mocks the YouTube download API to return a fixture ZIP file
 */
export async function mockYouTubeDownloadApi(context: BrowserContext): Promise<void> {
  await context.route(/\/download_video\?/, async (route) => {
    // Create a new zip file with our fixtures
    const zip = new JSZip();

    // Add files to the zip
    const audioData = await fs.readFile(getFixturePath("youtube/audio"));
    const videoData = await fs.readFile(getFixturePath("youtube/video"));
    const metadataJson = await fs.readFile(getFixturePath("youtube/metadata.json"), "utf-8");

    zip.file("audio.mp4", audioData);
    zip.file("video.mp4", videoData);
    zip.file("metadata.json", metadataJson);

    // Generate the zip file
    const zipBlob = await zip.generateAsync({ type: "nodebuffer" });

    // Fulfill the request with the zip file
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: zipBlob,
      headers: {
        "Content-Disposition": "attachment; filename=youtube_video.zip",
      },
    });

    console.log("Mocked YouTube download endpoint with fixture files");
  });
}

export interface LyricsProviderMock {
  id: string;
  name: string;
  url: string;
}

/**
 * Answers the lyrics lookup routes, so that no test reaches a real lyrics provider.
 * With no provider, the app never looks lyrics up. Returns the bodies the app posted.
 */
export async function mockLyricsLookup(
  page: Page,
  {
    provider = null,
    result = null,
  }: { provider?: LyricsProviderMock | null; result?: unknown } = {},
): Promise<unknown[]> {
  const lookups: unknown[] = [];
  await page.route("**/lyrics/provider", (route) => route.fulfill({ json: { provider } }));
  await page.route("**/lyrics", (route) => {
    lookups.push(route.request().postDataJSON());
    return result
      ? route.fulfill({ json: result })
      : route.fulfill({ status: 404, json: { detail: "No lyrics found." } });
  });
  return lookups;
}
