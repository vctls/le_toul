// Human-readable, editable projection of lyric timings.
//
// The internal timing representation (`Array<[seconds, marker]>`) is positionally
// coupled to a separate lyric blob and is unreadable/uneditable by hand. This module
// fuses lyrics + timings into one text where each syllable is preceded by an absolute
// timestamp tag `<MM:SS.cc>`, and parses that text back into the internal array.
//
// Design notes (see docs/multi-voice-spec.md):
//   - Time tags use angle brackets `<...>` ONLY. Square brackets `[...]` are reserved
//     for future per-voice annotations (`[1]`, `[1+2]`), so the two parsers never
//     compete for the same delimiter.
//   - These functions are voice-agnostic and pure: they take/return a SINGLE voice's
//     lyrics + timing array and never touch a store. Multi-voice support will simply
//     call them per voice.
//   - Lyrics stay owned by the lyrics store; `parseTimings` extracts timestamps only and
//     never restructures the lyric text.
//   - A `SEGMENT_START` is a tag immediately followed by syllable text. A `SEGMENT_END`
//     (a rest before silence) is a bare tag with no following syllable, mirroring the
//     blank-gap segment that `decorateAssLine` inserts.
//   - Times are quantized to centiseconds, which is lossless with respect to the rendered
//     output (ASS karaoke timing is itself centisecond-based).

import { LYRIC_MARKERS } from "@/constants";
import { parseLyrics, LyricEvent } from "./timing";

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

// Split a markup-preserving segment into [word, trailingSeparator]. The separator is the
// `_`, `/`, `\n`, or `\n\n` that terminated the segment (empty for the final segment).
function splitTrailingSeparator(text: string): [string, string] {
  const match = text.match(/(\n\n|[\n/_])$/);
  if (match) {
    return [text.slice(0, -match[0].length), match[0]];
  }
  return [text, ""];
}

// Render (lyrics, timings) as editable timestamped text. Untimed segments are emitted
// without a tag, so partially-timed lyrics round-trip cleanly.
export function serializeTimings(lyricText: string, timings: LyricEvent[]): string {
  const segments = parseLyrics(lyricText, true);
  const starts: (number | null)[] = segments.map(() => null);
  const ends: (number | null)[] = segments.map(() => null);

  let segmentIndex = -1;
  for (const [time, marker] of timings) {
    if (marker === LYRIC_MARKERS.SEGMENT_START) {
      segmentIndex++;
      if (segmentIndex < segments.length) {
        starts[segmentIndex] = time;
      }
    } else if (marker === LYRIC_MARKERS.SEGMENT_END) {
      if (segmentIndex >= 0 && segmentIndex < segments.length) {
        ends[segmentIndex] = time;
      }
    }
  }

  let out = "";
  segments.forEach((segment, i) => {
    const [word, separator] = splitTrailingSeparator(segment.text);
    if (starts[i] !== null) {
      out += `<${formatTimecode(starts[i] as number)}>`;
    }
    out += word;
    if (ends[i] !== null) {
      out += `<${formatTimecode(ends[i] as number)}>`;
    }
    out += separator;
  });
  return out;
}

// Parse editable timestamped text back into the internal timing array. A tag followed by
// syllable text is a SEGMENT_START; a bare tag (only markup/whitespace until the next tag
// or end of text) is a SEGMENT_END.
export function parseTimings(text: string): LyricEvent[] {
  const tags: { time: number; start: number; end: number }[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centiseconds = parseInt(match[3], 10);
    tags.push({
      time: minutes * 60 + seconds + centiseconds / 100,
      start: match.index as number,
      end: (match.index as number) + match[0].length,
    });
  }

  const events: LyricEvent[] = [];
  for (let i = 0; i < tags.length; i++) {
    const sliceEnd = i + 1 < tags.length ? tags[i + 1].start : text.length;
    const between = text.slice(tags[i].end, sliceEnd);
    const hasSyllable = between.replace(NON_SYLLABLE, "").length > 0;
    events.push([
      tags[i].time,
      hasSyllable ? LYRIC_MARKERS.SEGMENT_START : LYRIC_MARKERS.SEGMENT_END,
    ]);
  }
  return events;
}
