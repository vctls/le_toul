// A pass of taps over one voice's segments in Tap mode. The taps are staged here, and the store
// only gets them when the pass ends.

import { findLast } from "lodash-es";
import { resolveStarts } from "@/lib/timing";
import { TimedSegment, clearRetimedFlags, segmentWord } from "@/lib/timedSegments";
import { clampSegmentOverlaps } from "@/lib/timingValidation";

export interface TapPass {
  staged: TimedSegment[];
  // The segment the next start tap times. It equals the segment count once every segment is tapped.
  head: number;
  // The segment the end key ends: the one before the head, while it has a start and no end.
  growing?: number;
  // The segments tapped in this pass. Every other segment keeps its old timing and is drawn as a ghost.
  tapped: ReadonlySet<number>;
  // The pass as it was before its last tap, and when that tap was made. Undo goes back to it.
  previous?: TapPass;
  lastTap?: number;
}

/**
 * The index of each line's first segment.
 */
export function lineStarts(segments: TimedSegment[]): number[] {
  if (segments.length === 0) return [];
  const starts = [0];
  segments.forEach((segment, index) => {
    if (segment.text.endsWith("\n") && index + 1 < segments.length) {
      starts.push(index + 1);
    }
  });
  return starts;
}

/**
 * The segment the playhead is in, or the next one when it is between two.
 * The last timed segment of a voice with an untimed rest has no end, so past its start the head is
 * the first untimed segment, where tapping carries on.
 */
export function segmentHeadAt(segments: TimedSegment[], time: number): number {
  const resolved = resolveStarts(segments);
  for (let index = 0; index < resolved.length; index++) {
    const { start, end } = resolved[index];
    if (start === undefined || time < start) return index;
    const next = resolved[index + 1];
    const until = end ?? (next ? (next.start ?? start) : Infinity);
    if (time < until) return index;
  }
  return Math.max(0, resolved.length - 1);
}

/**
 * Where the head goes when the lyrics change under it. As when timings are carried across the
 * edit, segments are matched from both ends. A head before the edit keeps its index, one after it
 * keeps its distance from the end, and one inside it goes to its start.
 */
export function followHead(before: TimedSegment[], after: TimedSegment[], head: number): number {
  const same = (a: TimedSegment, b: TimedSegment) => segmentWord(a.text) === segmentWord(b.text);
  let common = 0;
  while (common < before.length && common < after.length && same(before[common], after[common])) {
    common++;
  }
  if (head <= common) return Math.min(head, after.length);
  let tail = 0;
  while (
    tail < before.length - common &&
    tail < after.length - common &&
    same(before[before.length - 1 - tail], after[after.length - 1 - tail])
  ) {
    tail++;
  }
  if (head >= before.length - tail) return head + after.length - before.length;
  return common;
}

/**
 * The first segment of the line holding a segment. Past the last segment, it is the last line's.
 */
export function lineStartOf(segments: TimedSegment[], index: number): number {
  return findLast(lineStarts(segments), (start) => start <= index) ?? 0;
}

/**
 * The line to go back to from the head: the start of its own line, or the line before when the head
 * is already on a line's first segment.
 */
export function previousLine(segments: TimedSegment[], head: number): number {
  const current = lineStartOf(segments, head);
  if (current < head) return current;
  return lineStartOf(segments, head - 1);
}

/**
 * Where playback starts for a pass from the head. A head with no place in time counts back from
 * the last segment before it that has one.
 */
export function prerollStart(segments: TimedSegment[], head: number, preroll: number): number {
  const resolved = resolveStarts(segments);
  const own = resolved[head]?.start;
  if (own !== undefined) {
    return Math.max(0, own - preroll);
  }
  for (let index = Math.min(head, resolved.length) - 1; index >= 0; index--) {
    const { start, end } = resolved[index];
    if (start !== undefined) {
      return Math.max(0, (end ?? start) - preroll);
    }
  }
  return 0;
}

/**
 * A pass from the head, with nothing tapped yet.
 */
export function startPass(segments: TimedSegment[], head: number): TapPass {
  const staged = segments.map((segment) => ({ ...segment }));
  return { staged, head, growing: growingBefore(staged, head), tapped: new Set() };
}

/**
 * The segment before the head, if it has a start and no end.
 */
function growingBefore(staged: TimedSegment[], head: number): number | undefined {
  const previous = staged[head - 1];
  return previous?.start !== undefined && previous.end === undefined ? head - 1 : undefined;
}

/**
 * Time the head's start and move on to the next segment.
 *
 * A tap before the start of the segment before the head would put the song out of order, so it is
 * ignored. Segments after the head that started before the tap become holes, including ones
 * tapped earlier in the pass, before a redo.
 */
export function tapStart(pass: TapPass, time: number): TapPass {
  const { staged, head } = pass;
  if (head >= staged.length) return pass;
  const previousStart = findLast(
    staged.slice(0, head),
    (segment) => segment.start !== undefined,
  )?.start;
  if (previousStart !== undefined && time <= previousStart) return pass;

  const tapped = new Set(pass.tapped);
  const next = staged.map((segment, index) => {
    if (index === head) {
      return { ...segment, start: time, end: undefined };
    }
    if (index > head && segment.start !== undefined && segment.start < time) {
      tapped.delete(index);
      return { ...segment, start: undefined, end: undefined };
    }
    return segment;
  });
  tapped.add(head);
  return {
    // The store writes a pass as one snapshot per tap, so a flag left on a segment the pass has
    // retimed would come back with every later snapshot.
    staged: clearRetimedFlags(staged, clampSegmentOverlaps(next)),
    head: head + 1,
    growing: head,
    tapped,
    previous: pass,
    lastTap: time,
  };
}

/**
 * End the segment tapped last. An end past the next segment's start is pulled back to it.
 */
export function tapEnd(pass: TapPass, time: number): TapPass {
  const { staged, growing } = pass;
  if (growing === undefined) return pass;
  if (time <= staged[growing].start!) return pass;
  const next = staged.map((segment, index) =>
    index === growing ? { ...segment, end: time } : segment,
  );
  return {
    ...pass,
    staged: clearRetimedFlags(staged, clampSegmentOverlaps(next)),
    growing: undefined,
    previous: pass,
    lastTap: time,
  };
}

/**
 * Move the head back a line, keeping every tap made so far.
 */
export function redoLine(pass: TapPass): TapPass {
  return moveHead(pass, previousLine(pass.staged, pass.head));
}

/**
 * Make another segment the head, keeping every tap made so far.
 */
export function moveHead(pass: TapPass, head: number): TapPass {
  return { ...pass, head, growing: growingBefore(pass.staged, head) };
}

/**
 * Take back the pass's last tap. Returns the pass as it was before it, and when the tap was made,
 * or nothing when no tap is left to take back.
 */
export function undoTap(pass: TapPass): { pass: TapPass; time: number } | null {
  if (!pass.previous || pass.lastTap === undefined) return null;
  return { pass: pass.previous, time: pass.lastTap };
}

/**
 * The staged segments after each tap of the pass, oldest first, so each tap can be undone on its
 * own once the pass is written.
 */
export function tapSteps(pass: TapPass): TimedSegment[][] {
  const steps: TimedSegment[][] = [];
  for (let step: TapPass = pass; step.previous; step = step.previous) {
    steps.unshift(step.staged);
  }
  return steps;
}

/**
 * The tap an undo took back or a redo put back, found by comparing the segments before and after
 * it. A start that changed is a start tap, and the head goes back to its segment on an undo, or on
 * past it on a redo. Otherwise an end that changed is an end tap, and the head is the next segment.
 * The time is when the tap was made.
 */
export function steppedTap(
  before: TimedSegment[],
  after: TimedSegment[],
  step: "undo" | "redo",
): { head: number; time: number } | null {
  const [tapped, other] = step === "undo" ? [before, after] : [after, before];
  const started = tapped.findIndex((segment, index) => segment.start !== other[index]?.start);
  if (started !== -1) {
    return {
      head: step === "undo" ? started : started + 1,
      time: (tapped[started].start ?? other[started].start)!,
    };
  }
  const ended = tapped.findIndex((segment, index) => segment.end !== other[index]?.end);
  if (ended !== -1) {
    return { head: ended + 1, time: (tapped[ended].end ?? other[ended].end)! };
  }
  return null;
}
