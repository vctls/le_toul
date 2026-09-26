// This is the stored form of one voice's timings.
// Every segment carries its own text, so lyrics and timings cannot drift apart.
// See docs/timed-segments-spec.md.

import { range } from "lodash-es";
import { LYRIC_MARKERS } from "@/constants";
import { LyricEvent, Segment, parseLyrics, displayText, resolveStarts } from "@/lib/timing";

export interface TimedSegment {
  // The text includes the trailing `_`, `/`, `\n` or `\n\n` separator, as
  // `parseLyrics(..., true)` yields it.
  text: string;
  start?: number;
  end?: number;
  // A line's display period, only read on the line's first segment.
  // A missing bound is automatic.
  displayStart?: number;
  displayEnd?: number;
}

/**
 * An event past the end of the lyrics gets a textless segment rather than being dropped.
 * Timings are entered before lyrics exist, so losing one is worse than carrying an empty text.
 */
export function fromEvents(lyricText: string, events: LyricEvent[]): TimedSegment[] {
  const segments: TimedSegment[] = parseLyrics(lyricText, true).map(({ text }) => ({ text }));

  let index = -1;
  for (const [time, marker] of events) {
    if (marker === LYRIC_MARKERS.SEGMENT_START) {
      index++;
      if (index === segments.length) {
        segments.push({ text: "" });
      }
      segments[index].start = time;
    } else if (marker === LYRIC_MARKERS.SEGMENT_END && index >= 0) {
      segments[index].end = time;
    }
  }
  return segments;
}

export function toEvents(segments: TimedSegment[]): LyricEvent[] {
  const events: LyricEvent[] = [];
  for (const { start, end } of segments) {
    if (start === undefined) {
      // An end without a start would attach to the *previous* segment once the join goes back to being positional,
      // moving a timing onto the wrong words.
      continue;
    }
    events.push([start, LYRIC_MARKERS.SEGMENT_START]);
    if (end !== undefined) {
      events.push([end, LYRIC_MARKERS.SEGMENT_END]);
    }
  }
  return events;
}

/**
 * The last segment of a lyric has no trailing separator, so appending to the end rewrites it and
 * `three` becomes `three_`. The same word in the same place must not read as a different one.
 */
function segmentWord(text: string): string {
  return text.replace(/(\n\n|[\n/_])$/, "");
}

/**
 * This carries timings across an edit to the lyrics.
 * Four ordered rules apply, and the first match wins:
 *
 * 1. same segment count    -> relabel in place, every timing is kept (the typo fix)
 * 2. otherwise             -> trim the common prefix and suffix, and nothing outside it moves
 * 3. window text unchanged -> a pure split or join, so keep the window's outer bounds
 * 4. anything else         -> un-time the window only
 *
 * This is deliberately not an LCS.
 * An LCS would read a one-character typo as a delete plus an insert, and drop a timing that the first rule keeps.
 */
export function reconcile(stored: TimedSegment[], current: Segment[]): TimedSegment[] {
  if (stored.length === current.length) {
    return current.map(({ text }, i) => ({ ...stored[i], text }));
  }

  const matches = (a: { text: string }, b: { text: string }) =>
    segmentWord(a.text) === segmentWord(b.text);

  let head = 0;
  while (head < stored.length && head < current.length && matches(stored[head], current[head])) {
    head++;
  }

  let tail = 0;
  while (
    tail < stored.length - head &&
    tail < current.length - head &&
    matches(stored[stored.length - 1 - tail], current[current.length - 1 - tail])
  ) {
    tail++;
  }

  // Outside the window, the timings are kept but the text comes from the lyrics,
  // since a matched segment may have gained or lost its separator.
  const carry = (segment: TimedSegment, text: string) => ({ ...segment, text });

  return [
    ...stored.slice(0, head).map((segment, i) => carry(segment, current[i].text)),
    ...reconcileWindow(
      stored.slice(head, stored.length - tail),
      current.slice(head, current.length - tail),
    ),
    ...stored
      .slice(stored.length - tail)
      .map((segment, i) => carry(segment, current[current.length - tail + i].text)),
  ];
}

function reconcileWindow(stored: TimedSegment[], current: Segment[]): TimedSegment[] {
  const segments: TimedSegment[] = current.map(({ text }) => ({ text }));
  if (segments.length === 0 || stored.length === 0) {
    return segments;
  }

  // Compared as drawn, not as stored: a split inserts the very `/` or `_` being compared, so the
  // raw texts always differ. Only the words have to match.
  const drawn = (list: { text: string }[]) => list.map(({ text }) => displayText(text)).join("");
  if (drawn(stored) !== drawn(current)) {
    return segments;
  }

  // The words are unchanged, so the window's own start and end still hold.
  // Only the divisions inside it are unknown.
  const { start } = stored[0];
  const { end } = stored[stored.length - 1];
  if (start !== undefined) {
    segments[0].start = start;
  }
  if (end !== undefined) {
    segments[segments.length - 1].end = end;
  }
  return segments;
}

/**
 * Widen each line's stored display period until it contains what the renderer draws for the line.
 * That runs from the line's first drawn start to its last drawn end,
 * where an open end, or one past the next start, stops at the next drawn start.
 * A line that draws nothing has no period, so its bounds are dropped.
 * Count-ins come from the settings, so they're left to the render.
 */
export function clampDisplayPeriods(segments: TimedSegment[]): {
  segments: TimedSegment[];
  widened: number;
} {
  const resolved = resolveStarts(segments);
  const drawnStart = (i: number) => (resolved[i].text === "" ? undefined : resolved[i].start);
  const result = segments.map((segment) => ({ ...segment }));
  let widened = 0;

  let first = 0;
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].text.endsWith("\n") && i < segments.length - 1) {
      continue;
    }
    const head = result[first];
    const drawn = range(first, i + 1).filter((j) => drawnStart(j) !== undefined);
    first = i + 1;
    if (head.displayStart === undefined && head.displayEnd === undefined) {
      continue;
    }
    if (drawn.length === 0) {
      delete head.displayStart;
      delete head.displayEnd;
      continue;
    }

    const startBound = drawnStart(drawn[0]) as number;
    const last = drawn[drawn.length - 1];
    const nextStart = range(last + 1, segments.length)
      .map(drawnStart)
      .find((start) => start !== undefined);
    const { end } = resolved[last];
    const endBound =
      end === undefined ? nextStart : nextStart === undefined ? end : Math.min(end, nextStart);

    let changed = false;
    if (head.displayStart !== undefined && head.displayStart > startBound) {
      head.displayStart = startBound;
      changed = true;
    }
    // The last line's open end runs to the song's end, which the segments don't know.
    if (head.displayEnd !== undefined && endBound !== undefined && head.displayEnd < endBound) {
      head.displayEnd = endBound;
      changed = true;
    }
    if (changed) {
      widened++;
    }
  }
  return { segments: result, widened };
}

// The `timings.json` the Submit tab exports.
// The event form cannot express an untimed segment, so saving a partly-timed project
// that way drops the holes and misattributes every segment after the first one on reload.
export const TIMINGS_FILE_VERSION = 2;

export interface TimingsFile {
  version: number;
  voices: Record<string, TimedSegment[]>;
}

export function isTimingsFile(parsed: unknown): parsed is TimingsFile {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    typeof (parsed as TimingsFile).version === "number" &&
    typeof (parsed as TimingsFile).voices === "object"
  );
}
