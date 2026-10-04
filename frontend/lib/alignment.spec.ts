import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isSyncAvailable, pendingSync, syncVoice, withSyncResult } from "./alignment";
import { TimedSegment } from "./timedSegments";

const voice = (): TimedSegment[] => [
  { text: "Went_" },
  { text: "out\n", start: 2, end: 2.4 },
  { text: "last/" },
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
  test("Fill untimed keeps every timed segment, with its times", () => {
    const { request } = pendingSync(voice(), "fill");

    expect(request).toEqual([
      { text: "Went ", endsLine: false, sync: true, start: undefined, end: undefined },
      { text: "out", endsLine: true, sync: false, start: 2, end: 2.4 },
      { text: "last", endsLine: false, sync: true, start: undefined, end: undefined },
      { text: "night", endsLine: true, sync: false, start: 5, end: undefined },
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

describe("withSyncResult", () => {
  const result = {
    aligner: "fake@1",
    segments: [{ start: 0.5, end: 1.1, doubtful: false }, {}, { start: 3, doubtful: true }, {}],
  };

  test("writes the synced segments and leaves the kept ones alone", () => {
    const segments = voice();

    const written = withSyncResult(segments, pendingSync(segments, "fill"), result);

    expect(written).toEqual([
      { text: "Went_", start: 0.5, end: 1.1 },
      { text: "out\n", start: 2, end: 2.4 },
      { text: "last/", start: 3, review: "doubtful" },
      { text: "night\n", start: 5, review: "moved" },
    ]);
  });

  test("a synced segment the aligner left untimed becomes a hole without a flag", () => {
    const segments = voice();

    const written = withSyncResult(segments, pendingSync(segments, "replace"), result);

    expect(written?.[3]).toEqual({ text: "night\n" });
  });

  test("refuses a result for lyrics that have changed since", () => {
    const segments = voice();
    const pending = pendingSync(segments, "fill");

    const edited = segments.map((segment, i) =>
      i === 2 ? { ...segment, text: "lost/" } : segment,
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
