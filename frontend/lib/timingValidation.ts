// Helpers for keeping a single voice's timing array well-formed: events must be in non-decreasing time order,
// and a segment's explicit end must not extend past the next segment's start (you can't sing two
// segments of one voice at once).

import { LYRIC_MARKERS } from "@/constants";
import { LyricEvent, resolveStarts } from "@/lib/timing";
import { TimedSegment } from "@/lib/timedSegments";

// Clamp any SEGMENT_END whose time exceeds the following event's time down to that time,
// so a segment can't overlap the next one. Used when committing adjusted timings, where
// silent normalization is appropriate. Returns a new array without mutating the input.
export function clampTimingOverlaps(timings: LyricEvent[]): LyricEvent[] {
  const result = timings.map((event) => [...event] as LyricEvent);
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i][1] === LYRIC_MARKERS.SEGMENT_END && result[i][0] > result[i + 1][0]) {
      result[i][0] = result[i + 1][0];
    }
  }
  return result;
}

/**
 * This is the segment form of the clamp above. An explicit end may not run past the next
 * segment's start. That start may itself be interpolated, which is still when it appears.
 */
export function clampSegmentOverlaps(segments: TimedSegment[]): TimedSegment[] {
  const resolved = resolveStarts(segments);
  return segments.map((segment, index) => {
    if (segment.end === undefined) {
      return { ...segment };
    }
    const nextStart = resolved.slice(index + 1).find((s) => s.start !== undefined)?.start;
    if (nextStart === undefined || segment.end <= nextStart) {
      return { ...segment };
    }
    return { ...segment, end: nextStart };
  });
}
