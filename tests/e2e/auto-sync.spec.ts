import { BrowserContext, expect, test } from "@playwright/test";
import {
  defaultTestConfig,
  navigateToTab,
  savedSegments,
  setupBasicInputs,
  setupTestEnvironment,
  TabId,
} from "./utils";

const JOB_URL = `/alignment/${"b".repeat(64)}`;
// The syllable the mocked aligner isn't sure of.
const DOUBTFUL = 2;

/**
 * Answers the sync routes as a backend with the fake aligner would, spreading the syllables
 * half a second apart and leaving out those `places` refuses. Returns the requests' segments, as
 * the page sent them.
 */
async function mockSyncApi(
  context: BrowserContext,
  places: (index: number) => boolean = () => true,
): Promise<{ sent: unknown[][] }> {
  const requests = { sent: [] as unknown[][] };
  let count = 0;
  await context.route("**/alignment/available", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: true }) }),
  );
  await context.route("**/align_track", async (route, request) => {
    const body = request.postDataBuffer()?.toString() ?? "";
    const json = body.match(/name="request"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? "{}";
    const segments = JSON.parse(json).segments ?? [];
    requests.sent.push(segments);
    count = segments.length;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ finishedTrackURL: JOB_URL }),
    });
  });
  await context.route(`**${JOB_URL}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        aligner: "fake@1",
        segments: Array.from({ length: count }, (_, i) =>
          places(i) ? { start: 0.5 * i, doubtful: i === DOUBTFUL } : {},
        ),
      }),
    }),
  );
  return requests;
}

test.describe("Syncing automatically", () => {
  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
  });

  test("times an untimed voice, flags its doubtful syllable, and undoes in one step", async ({
    page,
    context,
  }) => {
    const requests = await mockSyncApi(context);
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
    );
    await navigateToTab(page, TabId.TimingAdjustment);

    await page.getByRole("button", { name: "Sync", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sync automatically" });
    await dialog.getByRole("button", { name: "Sync", exact: true }).click();
    await expect(dialog).toBeHidden();

    expect(requests.sent).toHaveLength(1);
    const sent = requests.sent[0] as Array<{ sync: boolean }>;
    expect(sent.every(({ sync }) => sync)).toBe(true);

    const segments = await savedSegments(page);
    expect(segments).toHaveLength(sent.length);
    expect(segments.map(({ start }) => start)).toEqual(sent.map((_, i) => 0.5 * i));
    expect(segments.flatMap(({ review }, i) => (review ? [[i, review]] : []))).toEqual([
      [DOUBTFUL, "doubtful"],
    ]);
    await expect(page.getByTitle("1 syllable to review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Adjust", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("navigation").getByRole("button", { name: "Undo" }).click();

    await expect
      .poll(async () => (await savedSegments(page)).every(({ start }) => start === undefined))
      .toBe(true);
  });

  test("keeps the dialog open and changes nothing when no syllable could be placed", async ({
    page,
    context,
  }) => {
    await mockSyncApi(context, () => false);
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
    );
    await navigateToTab(page, TabId.TimingAdjustment);

    await page.getByRole("button", { name: "Sync", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sync automatically" });
    await dialog.getByRole("button", { name: "Sync", exact: true }).click();

    await expect(dialog.getByText("Syncing couldn't place any of the syllables")).toBeVisible();
    expect((await savedSegments(page)).every(({ start }) => start === undefined)).toBe(true);
  });

  test("writes a partial sync and says how many syllables it left out", async ({
    page,
    context,
  }) => {
    await mockSyncApi(context, (i) => i !== 0);
    await setupBasicInputs(
      page,
      defaultTestConfig.audioFile,
      defaultTestConfig.lyricsFile,
      defaultTestConfig.artist,
    );
    await navigateToTab(page, TabId.TimingAdjustment);

    await page.getByRole("button", { name: "Sync", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sync automatically" });
    await dialog.getByRole("button", { name: "Sync", exact: true }).click();

    await expect(dialog.getByText(/Syncing couldn't place 1 of the \d+ syllables/)).toBeVisible();
    const segments = await savedSegments(page);
    expect(segments[0].start).toBeUndefined();
    expect(segments[1].start).toBe(0.5);
  });
});
