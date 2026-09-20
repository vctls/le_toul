// Human-readable, editable text form of a voice's timed segments:
// each syllable preceded by an absolute timestamp tag `<MM:SS.cc>`.
// This is the hand-editing and interchange format.
// Segments are the stored one (see docs/timed-segments-spec.md).
//
// Design notes (see docs/multi-voice-spec.md):
// - Time tags use angle brackets `<...>` ONLY.
//   Square brackets `[...]` are reserved for future per-voice annotations (`[1]`, `[1+2]`),
//   so the two parsers never compete for the same delimiter.
// - These functions are voice-agnostic and pure:
//   they take/return a SINGLE voice's segments and never touch a store.
//   Multi-voice calls them per voice.
// - A tag immediately followed by syllable text starts that segment.
//   A bare tag with no following syllable is a rest before silence,
//   and releases the segment before it, mirroring the blank-gap segment that `decorateAssLine` inserts.
// - Times are quantized to centiseconds,
//   which is lossless with respect to the rendered output (ASS karaoke timing is itself centisecond-based).

import { parseLyrics } from "./timing";
import { TimedSegment } from "./timedSegments";

// Matches a single timestamp tag: <MM:SS.cc> (minutes may be 1-3 digits).
const TAG_PATTERN = /<(\d{1,3}):([0-5]?\d)\.(\d{2})>/g;

// Characters that are markup/whitespace rather than visible syllable text.
const NON_SYLLABLE = /[\s/_]/g;

export function formatTimecode(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cc = totalCs % 100;
  const totalSec = (totalCs - cc) / 100;
  const ss = totalSec % 60;
  const mm = (totalSec - ss) / 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}.${pad(cc)}`;
}

/**
 * Split a markup-preserving segment into [word, trailingSeparator].
 * The separator is the `_`, `/`, `\n`, or `\n\n` that terminated the segment (empty for the final segment).
 */
function splitTrailingSeparator(text: string): [string, string] {
  const match = text.match(/(\n\n|[\n/_])$/);
  if (match) {
    return [text.slice(0, -match[0].length), match[0]];
  }
  return [text, ""];
}

/**
 * Render segments as editable timestamped text. Untimed segments are emitted without a tag,
 * so a partially-timed project round-trips cleanly.
 */
export function serializeTimings(segments: TimedSegment[]): string {
  let out = "";
  for (const segment of segments) {
    const [word, separator] = splitTrailingSeparator(segment.text);
    if (segment.start !== undefined) {
      out += `<${formatTimecode(segment.start)}>`;
    }
    out += word;
    if (segment.end !== undefined) {
      out += `<${formatTimecode(segment.end)}>`;
    }
    out += separator;
  }
  return out;
}

/**
 * Parse editable timestamped text back into segments.
 * A tag followed by syllable text starts a segment.
 * A bare tag (only markup/whitespace until the next tag or end of text) ends one.
 */
export function parseTimings(text: string): TimedSegment[] {
  // Tags hold no separator character, so the ordinary segment split works on the tagged text and
  // each tag stays inside the segment it was written against. That is why adding or removing a
  // `/` keeps the timings, where an ordinal join would not.
  const segments: TimedSegment[] = [];

  for (const { text: chunk } of parseLyrics(text, true)) {
    const tags = [...chunk.matchAll(TAG_PATTERN)];
    const body = chunk.replace(TAG_PATTERN, "");
    const leading = tags.find((tag) => tag.index === 0);

    if (body.replace(NON_SYLLABLE, "").length === 0) {
      // A tag with no syllable of its own is a rest: it releases the previous segment.
      if (leading && segments.length > 0) {
        segments[segments.length - 1].end = tagSeconds(leading);
      }
      continue;
    }

    const segment: TimedSegment = { text: body };
    if (leading) {
      segment.start = tagSeconds(leading);
    }
    const trailing = tags.find((tag) => (tag.index as number) > 0);
    if (trailing) {
      segment.end = tagSeconds(trailing);
    }
    segments.push(segment);
  }

  return segments;
}

function tagSeconds(match: RegExpMatchArray): number {
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3], 10) / 100;
}
