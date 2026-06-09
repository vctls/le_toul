// Helpers for keeping a single voice's timing array well-formed: events must be in
// non-decreasing time order, and a segment's explicit end must not extend past the next
// segment's start (you can't sing two segments of one voice at once).

import { LYRIC_MARKERS } from "@/constants";
import { LyricEvent } from "@/lib/timing";
import { formatTimecode } from "@/lib/timingFormat";

// Tolerance for floating-point comparisons (a hair under a centisecond).
const EPSILON = 0.005;

// Clamp any SEGMENT_END whose time exceeds the following event's time down to that time,
// so a segment can't overlap the next one. Used when committing adjusted timings, where
// silent normalization is appropriate. Returns a new array; the input is not mutated.
export function clampTimingOverlaps(timings: LyricEvent[]): LyricEvent[] {
  const result = timings.map((event) => [...event] as LyricEvent);
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i][1] === LYRIC_MARKERS.SEGMENT_END && result[i][0] > result[i + 1][0]) {
      result[i][0] = result[i + 1][0];
    }
  }
  return result;
}

export interface TimingValidationResult {
  valid: boolean;
  message?: string;
}

// Validate that event times never go backwards. A backwards step means either a segment
// ends after the next one starts (an overlap) or timestamps are simply out of order.
export function validateTimings(timings: LyricEvent[]): TimingValidationResult {
  for (let i = 1; i < timings.length; i++) {
    if (timings[i][0] < timings[i - 1][0] - EPSILON) {
      return {
        valid: false,
        message: `Timecodes must not go backwards: ${formatTimecode(timings[i - 1][0])} is followed by ${formatTimecode(timings[i][0])}.`,
      };
    }
  }
  return { valid: true };
}
