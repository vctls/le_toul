import { describe, it, expect } from "vitest";
import { clampTimingOverlaps, validateTimings } from "./timingValidation";
import { LyricEvent } from "./timing";
import { LYRIC_MARKERS } from "../constants";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

describe("clampTimingOverlaps", () => {
  it("clamps an end that extends past the next segment's start", () => {
    const timings: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [3.0, SEGMENT_END],   // ends at 3.0...
      [2.0, SEGMENT_START], // ...but the next segment starts at 2.0
    ];
    expect(clampTimingOverlaps(timings)).toEqual([
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],   // clamped to the next start
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
