// Gap restore plays the original song between sung parts, where the separation can only have
// removed sounds that weren't lead vocals, and the backing track everywhere else.

import { range } from "lodash-es";
import { displayText, resolveStarts } from "./timing";
import { TimedSegment } from "./timedSegments";
import { VoiceId } from "./voices";

export interface GapRestoreSettings {
  preRoll: number;
  postRoll: number;
  // Shorter gaps between muted periods stay muted.
  minGap: number;
  fade: number;
  pausesInLines: boolean;
}

export interface Span {
  start: number;
  end: number;
}

// The time around a line during which the backing track plays.
export interface MutedLine extends Span {
  voice: VoiceId;
  // The index of the line's first segment in its voice.
  segmentIndex: number;
  text: string;
  syllables: Span[];
  // The last syllable has no end, so it runs to the next syllable and leaves no gap after it.
  openEnd: boolean;
}

export interface GapPlan {
  lines: MutedLine[];
  // Where the original plays, in order. Empty until every sung syllable has a start.
  gaps: Span[];
  // Whether every sung syllable of every voice has a start.
  complete: boolean;
}

/**
 * Each line's muted period, and the gaps between them, for every voice.
 * `voices` holds each voice's segments, timed or not.
 */
export function planGaps(
  voices: Record<VoiceId, TimedSegment[]>,
  duration: number,
  settings: GapRestoreSettings,
): GapPlan {
  const lines: MutedLine[] = [];
  const sung: Span[] = [];
  let complete = true;
  for (const [voice, segments] of Object.entries(voices)) {
    const resolved = resolveStarts(segments);
    if (resolved.some(({ start }) => start === undefined)) {
      complete = false;
    }
    const syllables = sungSyllables(resolved, duration);
    for (const [first, last] of lineRanges(resolved)) {
      const timed = range(first, last + 1).filter((i) => syllables.has(i));
      if (timed.length === 0) {
        continue;
      }
      const spans = timed.map((i) => syllables.get(i) as Span);
      const start = spans[0].start;
      const end = Math.max(...spans.map((span) => span.end));
      lines.push({
        voice,
        segmentIndex: first,
        text: resolved
          .slice(first, last + 1)
          .map(({ text }) => displayText(text))
          .join("")
          .trim(),
        syllables: spans,
        start: Math.max(0, start - settings.preRoll),
        end: Math.min(duration, end + settings.postRoll),
        openEnd: resolved[timed[timed.length - 1]].end === undefined,
      });
      sung.push(...(settings.pausesInLines ? spans : [{ start, end }]));
    }
  }
  lines.sort((a, b) => a.start - b.start);
  if (!complete || sung.length === 0) {
    return { lines, gaps: [], complete: complete && sung.length > 0 };
  }
  const muted = mergeSpans(
    sung.map(({ start, end }) => ({
      start: Math.max(0, start - settings.preRoll),
      end: Math.min(duration, end + settings.postRoll),
    })),
  );
  return { lines, gaps: gapsBetween(muted, duration, settings.minGap), complete };
}

/**
 * The first and last segment index of each line.
 */
function lineRanges(segments: TimedSegment[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let first = 0;
  segments.forEach(({ text }, i) => {
    if (text.endsWith("\n") || i === segments.length - 1) {
      ranges.push([first, i]);
      first = i + 1;
    }
  });
  return ranges;
}

/**
 * When each timed syllable is sung, keyed by its index.
 * An open end runs to the next syllable's start, or to the song's end after the last one.
 */
function sungSyllables(resolved: TimedSegment[], duration: number): Map<number, Span> {
  const spans = new Map<number, Span>();
  let nextStart = duration;
  for (let i = resolved.length - 1; i >= 0; i--) {
    const { start, end } = resolved[i];
    if (start === undefined) {
      continue;
    }
    spans.set(i, { start, end: Math.max(start, end ?? nextStart) });
    nextStart = start;
  }
  return spans;
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * The stretches between muted spans that last at least `minGap`, the song's start and end included.
 */
function gapsBetween(muted: Span[], duration: number, minGap: number): Span[] {
  const edges = [0, ...muted.flatMap(({ start, end }) => [start, end]), duration];
  const gaps: Span[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const [start, end] = [edges[i], edges[i + 1]];
    if (end > start && end - start >= minGap) {
      gaps.push({ start, end });
    }
  }
  return gaps;
}

/**
 * The backing track with the original blended in over each gap.
 * Each fade lies inside its gap, and there is none at the song's own start or end.
 * A channel either track lacks is taken from its last one, so mono mixes with stereo.
 */
export function mixGaps(
  backing: Float32Array[],
  original: Float32Array[],
  sampleRate: number,
  gaps: Span[],
  fade: number,
): Float32Array[] {
  const length = backing[0]?.length ?? 0;
  const usable = Math.min(length, original[0]?.length ?? 0);
  const channels = Math.max(backing.length, original.length);
  const channel = (tracks: Float32Array[], c: number) => tracks[Math.min(c, tracks.length - 1)];
  const mixed = range(channels).map((c) => Float32Array.from(channel(backing, c)));
  for (const gap of gaps) {
    const first = Math.max(0, Math.round(gap.start * sampleRate));
    const end = Math.min(usable, Math.round(gap.end * sampleRate));
    if (end <= first) {
      continue;
    }
    const fadeLength = Math.min(Math.round(fade * sampleRate), Math.floor((end - first) / 2));
    const fadeIn = first > 0 ? fadeLength : 0;
    const fadeOut = end < length ? fadeLength : 0;
    for (let c = 0; c < channels; c++) {
      const out = mixed[c];
      const from = channel(original, c);
      for (let i = first; i < end; i++) {
        const weight = Math.min(
          1,
          fadeIn > 0 ? (i - first) / fadeIn : 1,
          fadeOut > 0 ? (end - i) / fadeOut : 1,
        );
        out[i] = out[i] * (1 - weight) + from[i] * weight;
      }
    }
  }
  return mixed;
}

/**
 * The loudest that the original and the backing track differ over a gap, in dBFS, measured in
 * short windows. Restoring a gap far below the music changes nothing anyone hears.
 */
export function gapDifference(
  backing: Float32Array[],
  original: Float32Array[],
  sampleRate: number,
  gap: Span,
): number {
  const window = Math.max(1, Math.round(sampleRate * 0.05));
  const first = Math.max(0, Math.round(gap.start * sampleRate));
  const end = Math.min(
    backing[0]?.length ?? 0,
    original[0]?.length ?? 0,
    Math.round(gap.end * sampleRate),
  );
  let loudest = 0;
  for (let start = first; start < end; start += window) {
    const stop = Math.min(end, start + window);
    for (let c = 0; c < Math.max(backing.length, original.length); c++) {
      const b = backing[Math.min(c, backing.length - 1)];
      const o = original[Math.min(c, original.length - 1)];
      let sum = 0;
      for (let i = start; i < stop; i++) {
        const d = o[i] - b[i];
        sum += d * d;
      }
      loudest = Math.max(loudest, sum / (stop - start));
    }
  }
  return loudest > 0 ? 10 * Math.log10(loudest) : -Infinity;
}
