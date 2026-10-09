// Gap restore plays the original song between sung parts, where the separation can only have
// removed sounds that weren't lead vocals, and the backing track everywhere else.

import { range } from "lodash-es";
import { GAP_MAX_LEAD } from "@/constants";
import { displayText, resolveStarts } from "./timing";
import { TimedSegment } from "./timedSegments";
import { VoiceId } from "./voices";

// The gain is only trusted when the two tracks agree at least this well over the gaps. Sounds the
// separation removed lower the agreement, so the bar is low. A backing track from another
// recording falls far below it.
const MIN_GAIN_CORRELATION = 0.5;
const MAX_GAIN = 4;

// The raised backing track's peaks are kept under this, about -0.5 dBFS.
const LIMIT_CEILING = 10 ** (-0.5 / 20);
const LIMIT_LOOKAHEAD_SECONDS = 0.005;
const LIMIT_RELEASE_SECONDS = 0.08;

export interface GapRestoreSettings {
  // A negative pre-roll, down to -GAP_MAX_LEAD, starts the mute inside the first syllable.
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
  const preRoll = Math.max(settings.preRoll, -GAP_MAX_LEAD);
  // The mute never starts after the first syllable has ended.
  const mute = (start: number, firstEnd: number, end: number): Span => ({
    start: Math.max(0, Math.min(start - preRoll, firstEnd)),
    end: Math.min(duration, end + settings.postRoll),
  });
  const lines: MutedLine[] = [];
  const muted: Span[] = [];
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
      const line = mute(spans[0].start, spans[0].end, Math.max(...spans.map((span) => span.end)));
      lines.push({
        voice,
        segmentIndex: first,
        text: resolved
          .slice(first, last + 1)
          .map(({ text }) => displayText(text))
          .join("")
          .trim(),
        syllables: spans,
        ...line,
        openEnd: resolved[timed[timed.length - 1]].end === undefined,
      });
      muted.push(
        ...(settings.pausesInLines
          ? spans.map((span) => mute(span.start, span.end, span.end))
          : [line]),
      );
    }
  }
  lines.sort((a, b) => a.start - b.start);
  if (!complete || muted.length === 0) {
    return { lines, gaps: [], complete: complete && muted.length > 0 };
  }
  return { lines, gaps: gapsBetween(mergeSpans(muted), duration, settings.minGap), complete };
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
 * How long a gap fades in and out, in seconds. Each fade lies inside its gap, and there is none at
 * the song's own start or end.
 */
export function gapFades(
  gap: Span,
  fade: number,
  duration: number,
): { fadeIn: number; fadeOut: number } {
  const length = Math.min(fade, (gap.end - gap.start) / 2);
  return { fadeIn: gap.start > 0 ? length : 0, fadeOut: gap.end < duration ? length : 0 };
}

function channel(tracks: Float32Array[], c: number): Float32Array {
  return tracks[Math.min(c, tracks.length - 1)];
}

/**
 * The scale that brings the backing track to the original's level over the gaps, by least squares.
 * Sounds the separation removed don't lean on it, since they don't follow the backing track.
 * It is 1 when there is nothing to measure, or when the two tracks don't line up.
 */
export function gapGain(
  backing: Float32Array[],
  original: Float32Array[],
  sampleRate: number,
  gaps: Span[],
): number {
  const usable = Math.min(backing[0]?.length ?? 0, original[0]?.length ?? 0);
  const channels = Math.max(backing.length, original.length);
  let cross = 0;
  let backingEnergy = 0;
  let originalEnergy = 0;
  for (const gap of gaps) {
    const first = Math.max(0, Math.round(gap.start * sampleRate));
    const end = Math.min(usable, Math.round(gap.end * sampleRate));
    for (let c = 0; c < channels; c++) {
      const b = channel(backing, c);
      const o = channel(original, c);
      for (let i = first; i < end; i++) {
        cross += o[i] * b[i];
        backingEnergy += b[i] * b[i];
        originalEnergy += o[i] * o[i];
      }
    }
  }
  if (backingEnergy === 0 || originalEnergy === 0) {
    return 1;
  }
  if (cross / Math.sqrt(backingEnergy * originalEnergy) < MIN_GAIN_CORRELATION) {
    return 1;
  }
  return Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, cross / backingEnergy));
}

/**
 * Turn down the peaks past `ceiling` in place, by the same gain on every channel.
 * The gain starts falling a look-ahead before each peak and recovers over the release, so it never
 * steps.
 */
export function limitPeaks(
  channels: Float32Array[],
  sampleRate: number,
  ceiling = LIMIT_CEILING,
): void {
  const length = channels[0]?.length ?? 0;
  const lookahead = Math.max(1, Math.round(LIMIT_LOOKAHEAD_SECONDS * sampleRate));
  // The gain each sample needs on its own.
  const gain = new Float32Array(length);
  let over = false;
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (const samples of channels) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    gain[i] = peak > ceiling ? ceiling / peak : 1;
    over ||= peak > ceiling;
  }
  if (!over) {
    return;
  }

  // The lowest gain needed from each sample to a look-ahead after it, kept by a monotonic queue
  // of indices.
  const lowest = new Float32Array(length);
  const queue = new Int32Array(lookahead + 2);
  let head = 0;
  let size = 0;
  const at = (k: number) => queue[(head + k) % queue.length];
  for (let i = length - 1; i >= 0; i--) {
    while (size > 0 && gain[at(size - 1)] >= gain[i]) size--;
    queue[(head + size) % queue.length] = i;
    size++;
    while (at(0) > i + lookahead) {
      head = (head + 1) % queue.length;
      size--;
    }
    lowest[i] = gain[at(0)];
  }

  // Averaged over the look-ahead before each sample, every value in the average already covers
  // the peak, so the gain ramps down into it and still reaches what it needs.
  let sum = lowest[0] * (lookahead + 1);
  const release = 1 - Math.exp(-1 / (LIMIT_RELEASE_SECONDS * sampleRate));
  let previous = 1;
  for (let i = 0; i < length; i++) {
    if (i > 0) {
      sum += lowest[i] - lowest[Math.max(0, i - lookahead - 1)];
    }
    const smoothed = sum / (lookahead + 1);
    previous = Math.min(smoothed, previous + (1 - previous) * release);
    for (const samples of channels) {
      samples[i] *= previous;
    }
  }
}

export interface MixLevels {
  // The scale from the backing track to the original's level, as `gapGain` measures it.
  gain?: number;
  // The share of the gain that raises the backing track, from 0 to 1. The rest lowers the original.
  balance?: number;
}

/**
 * Scale `samples` in place.
 */
function scale(samples: Float32Array, gain: number): Float32Array {
  if (gain !== 1) {
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  return samples;
}

/**
 * The backing track with the original blended in over each gap, with the fades of `gapFades`.
 * The gain is split between the two tracks by `balance`, and whichever one it raises is limited.
 * A channel either track lacks is taken from its last one, so mono mixes with stereo.
 */
export function mixGaps(
  backing: Float32Array[],
  original: Float32Array[],
  sampleRate: number,
  gaps: Span[],
  fade: number,
  { gain = 1, balance = 1 }: MixLevels = {},
): Float32Array[] {
  const length = backing[0]?.length ?? 0;
  const usable = Math.min(length, original[0]?.length ?? 0);
  const channels = Math.max(backing.length, original.length);
  const backingGain = gain ** balance;
  const originalGain = gain ** (balance - 1);
  const mixed = range(channels).map((c) =>
    scale(Float32Array.from(channel(backing, c)), backingGain),
  );
  if (backingGain > 1) {
    limitPeaks(mixed, sampleRate);
  }
  for (const gap of gaps) {
    const first = Math.max(0, Math.round(gap.start * sampleRate));
    const end = Math.min(usable, Math.round(gap.end * sampleRate));
    if (end <= first) {
      continue;
    }
    const fades = gapFades(
      { start: first / sampleRate, end: end / sampleRate },
      fade,
      length / sampleRate,
    );
    const fadeIn = Math.floor(fades.fadeIn * sampleRate);
    const fadeOut = Math.floor(fades.fadeOut * sampleRate);
    const source = range(channels).map((c) => {
      const samples = channel(original, c).subarray(first, end);
      return originalGain === 1 ? samples : scale(Float32Array.from(samples), originalGain);
    });
    if (originalGain > 1) {
      limitPeaks(source, sampleRate);
    }
    for (let c = 0; c < channels; c++) {
      const out = mixed[c];
      const from = source[c];
      for (let i = first; i < end; i++) {
        const weight = Math.min(
          1,
          fadeIn > 0 ? (i - first) / fadeIn : 1,
          fadeOut > 0 ? (end - i) / fadeOut : 1,
        );
        out[i] = out[i] * (1 - weight) + from[i - first] * weight;
      }
    }
  }
  return mixed;
}

/**
 * The loudest that the original and the backing track, scaled by `gain`, differ over a gap, in
 * dBFS, measured in short windows. Restoring a gap far below the music changes nothing anyone
 * hears.
 */
export function gapDifference(
  backing: Float32Array[],
  original: Float32Array[],
  sampleRate: number,
  gap: Span,
  gain = 1,
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
        const d = o[i] - b[i] * gain;
        sum += d * d;
      }
      loudest = Math.max(loudest, sum / (stop - start));
    }
  }
  return loudest > 0 ? 10 * Math.log10(loudest) : -Infinity;
}
