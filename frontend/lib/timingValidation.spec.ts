import { describe, it, expect } from "vitest";
import { clampTimingOverlaps, clampSegmentOverlaps, validateTimings } from "./timingValidation";
import { LyricEvent } from "./timing";
import { LYRIC_MARKERS } from "../constants";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

describe("clampTimingOverlaps", () => {
  it("clamps an end that extends past the next segment's start", () => {
    const timings: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [3.0, SEGMENT_END], // ends at 3.0...
      [2.0, SEGMENT_START], // ...but the next segment starts at 2.0
    ];
    expect(clampTimingOverlaps(timings)).toEqual([
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END], // clamped to the next start
      [2.0, SEGMENT_START],
    ]);
  });

  it("leaves non-overlapping timings unchanged and does not mutate the input", () => {
    const timings: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [3.0, SEGMENT_START],
    ];
    const copy = timings.map((e) => [...e] as LyricEvent);
    expect(clampTimingOverlaps(timings)).toEqual(copy);
    expect(timings).toEqual(copy); // input untouched
  });
});

describe("validateTimings", () => {
  it("accepts non-decreasing timecodes", () => {
    const timings: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [2.0, SEGMENT_START],
      [4.0, SEGMENT_END],
    ];
    expect(validateTimings(timings)).toEqual({ valid: true });
  });

  it("rejects timecodes that go backwards (an overlap or out-of-order edit)", () => {
    const timings: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [3.0, SEGMENT_END],
      [2.0, SEGMENT_START], // backwards
    ];
    const result = validateTimings(timings);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("backwards");
  });

  it("accepts empty timings", () => {
    expect(validateTimings([])).toEqual({ valid: true });
  });
});

describe("clampSegmentOverlaps", () => {
  it("pulls an end back to the next segment's start", () => {
    expect(
      clampSegmentOverlaps([
        { text: "one_", start: 1.0, end: 2.5 },
        { text: "two", start: 2.0 },
      ]),
    ).toEqual([
      { text: "one_", start: 1.0, end: 2.0 },
      { text: "two", start: 2.0 },
    ]);
  });

  it("clamps an end that runs past everything to the next real timing", () => {
    const clamped = clampSegmentOverlaps([
      { text: "one_", start: 1.0, end: 9.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ]);
    // A hole never starts before the release ahead of it, so an end this far out collapses the
    // hole onto the next timed segment and is clamped to the same place.
    expect(clamped[0].end).toBeCloseTo(3.0, 5);
  });

  it("clamps against an interpolated start when the hole has room", () => {
    const clamped = clampSegmentOverlaps([
      { text: "one_", start: 1.0, end: 5.0 },
      { text: "two_" },
      { text: "three", start: 9.0 },
    ]);
    // The hole starts at the release, so there is nothing to clamp.
    expect(clamped[0].end).toBeCloseTo(5.0, 5);
  });

  it("leaves an end that already fits, and an open-ended segment alone", () => {
    const segments = [
      { text: "one_", start: 1.0, end: 1.5 },
      { text: "two", start: 2.0 },
    ];
    expect(clampSegmentOverlaps(segments)).toEqual(segments);
  });

  it("does not mutate its input", () => {
    const segments = [
      { text: "one_", start: 1.0, end: 9.0 },
      { text: "two", start: 2.0 },
    ];
    clampSegmentOverlaps(segments);
    expect(segments[0].end).toBe(9.0);
  });
});
