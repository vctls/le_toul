import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  isSyncAvailable,
  linesToFill,
  pendingSync,
  selectedLines,
  syncVoice,
  unplacedCount,
  withSyncResult,
} from "./alignment";
import { TimedSegment } from "./timedSegments";

const voice = (): TimedSegment[] => [
  { text: "Went_" },
  { text: "out\n", start: 2, end: 2.4 },
  { text: "had\n", start: 2.6 },
  { text: "last/", start: 3 },
  { text: "night\n", start: 5, review: "moved" },
];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("pendingSync", () => {
  test("Fill syncs the lines around an untimed segment, and keeps the others with their times", () => {
    const { request } = pendingSync(voice(), "fill");

    expect(request).toEqual([
      { text: "Went ", endsLine: false, sync: true, start: undefined, end: undefined },
      { text: "out", endsLine: true, sync: true, start: undefined, end: undefined },
      { text: "had", endsLine: true, sync: true, start: undefined, end: undefined },
      { text: "last", endsLine: false, sync: false, start: 3, end: undefined },
      { text: "night", endsLine: true, sync: false, start: 5, end: undefined },
    ]);
  });

  test("Selected syncs the lines that hold a selected segment, and keeps the lines around them", () => {
    const { request } = pendingSync(voice(), "selected", [3]);

    expect(request.map(({ sync, start }) => [sync, start])).toEqual([
      [false, undefined],
      [false, 2],
      [false, 2.6],
      [true, undefined],
      [true, undefined],
    ]);
  });

  test("Replace syncs every segment and sends no times", () => {
    const { request } = pendingSync(voice(), "replace");

    expect(request.every(({ sync, start, end }) => sync && start === undefined && !end)).toBe(true);
  });

  test("the segments are copied, so a later edit can be told apart", () => {
    const segments = voice();
    const pending = pendingSync(segments, "fill");

    segments[1].start = 3;

    expect(pending.segments[1].start).toBe(2);
  });
});

describe("linesToFill", () => {
  test("marks every segment of a line with an untimed one, and of the lines on either side", () => {
    const segments: TimedSegment[] = [
      { text: "one\n", start: 1 },
      { text: "two_", start: 2 },
      { text: "three\n\n", start: 3 },
      { text: "four_", start: 4 },
      { text: "five\n" },
      { text: "six\n", start: 6 },
      { text: "seven", start: 7 },
    ];

    expect(linesToFill(segments)).toEqual([false, true, true, true, true, true, false]);
  });

  test("counts a last line without a line end", () => {
    expect(
      linesToFill([{ text: "one\n", start: 1 }, { text: "two\n", start: 2 }, { text: "three" }]),
    ).toEqual([false, true, true]);
  });
});

describe("selectedLines", () => {
  test("marks every segment of each line with a selected one, and ignores unknown indices", () => {
    const segments: TimedSegment[] = [
      { text: "one_" },
      { text: "two\n" },
      { text: "three\n\n" },
      { text: "four_" },
      { text: "five" },
    ];

    expect(selectedLines(segments, [1, 4, 9])).toEqual([true, true, false, true, true]);
  });
});

describe("unplacedCount", () => {
  test("counts the synced segments the result left without a start", () => {
    const pending = pendingSync(voice(), "fill");
    const result = { aligner: "fake@1", segments: [{ start: 0.5 }, {}, { start: 2.6 }, {}, {}] };

    expect(unplacedCount(pending, result)).toBe(1);
  });
});

describe("withSyncResult", () => {
  const result = {
    aligner: "fake@1",
    segments: [
      { start: 0.5, end: 1.1, doubtful: false },
      { start: 1.5, doubtful: true },
      { start: 2.6 },
      {},
      {},
    ],
  };

  test("writes the synced segments and leaves the kept ones alone", () => {
    const segments = voice();

    const written = withSyncResult(segments, pendingSync(segments, "fill"), result);

    expect(written).toEqual([
      { text: "Went_", start: 0.5, end: 1.1 },
      { text: "out\n", start: 1.5, review: "doubtful" },
      { text: "had\n", start: 2.6 },
      { text: "last/", start: 3 },
      { text: "night\n", start: 5, review: "moved" },
    ]);
  });

  test("a sync of the selected lines leaves the lines around them untouched", () => {
    const segments = voice();

    const everywhere = {
      aligner: "fake@1",
      segments: [{ start: 0.5 }, { start: 1.5 }, { start: 2.7, doubtful: true }, {}, {}],
    };

    const written = withSyncResult(segments, pendingSync(segments, "selected", [2]), everywhere);

    expect(written).toEqual([
      { text: "Went_" },
      { text: "out\n", start: 2, end: 2.4 },
      { text: "had\n", start: 2.7, review: "doubtful" },
      { text: "last/", start: 3 },
      { text: "night\n", start: 5, review: "moved" },
    ]);
  });

  test("a synced segment the aligner left untimed becomes a hole without a flag", () => {
    const segments = voice();

    const written = withSyncResult(segments, pendingSync(segments, "replace"), result);

    expect(written?.[4]).toEqual({ text: "night\n" });
  });

  test("refuses a result for lyrics that have changed since", () => {
    const segments = voice();
    const pending = pendingSync(segments, "fill");

    const edited = segments.map((segment, i) =>
      i === 3 ? { ...segment, text: "lost/" } : segment,
    );

    expect(withSyncResult(edited, pending, result)).toBeNull();
  });

  test("refuses a result for timings that have changed since", () => {
    const segments = voice();
    const pending = pendingSync(segments, "fill");

    const dragged = segments.map((segment, i) => (i === 1 ? { ...segment, start: 1.9 } : segment));

    expect(withSyncResult(dragged, pending, result)).toBeNull();
  });
});

describe("syncVoice", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("posts the request and polls until the result, which has no status", async () => {
    const result = { aligner: "fake@1", segments: [{ start: 1, doubtful: false }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ finishedTrackURL: "/alignment/abc" }) as any)
      .mockResolvedValueOnce(
        jsonResponse({ status: "processing", stage: "aligning", progress: 0.5 }) as any,
      )
      .mockResolvedValueOnce(jsonResponse(result) as any);
    const reported: unknown[] = [];

    const syncing = syncVoice(
      new Blob(["vocals"]),
      "vocals.wav",
      [{ text: "hey", endsLine: true, sync: true }],
      (progress) => reported.push(progress),
    );
    await vi.runAllTimersAsync();

    expect(await syncing).toEqual(result);
    expect(reported).toEqual([{ progress: 0.5, stage: "aligning", songsAhead: null }]);
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(JSON.parse(body.get("request") as string)).toEqual({
      segments: [{ text: "hey", endsLine: true, sync: true }],
    });
  });

  test("a refused request says why", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "No segment is marked to sync." }, 400) as any,
    );

    await expect(
      syncVoice(new Blob(["vocals"]), "vocals.wav", [{ text: "a", endsLine: true, sync: false }]),
    ).rejects.toThrow("No segment is marked to sync.");
  });

  test("a failed sync says why", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ finishedTrackURL: "/alignment/abc" }) as any)
      .mockResolvedValueOnce(
        jsonResponse({ status: "error", error: "the vocals are silent" }) as any,
      );

    await expect(
      syncVoice(new Blob(["vocals"]), "vocals.wav", [{ text: "a", endsLine: true, sync: true }]),
    ).rejects.toThrow("the vocals are silent");
  });
});

describe("isSyncAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("asks the backend once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ available: true })));

    expect(await isSyncAvailable()).toBe(true);
    expect(await isSyncAvailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/alignment/available");
  });
});
