import { describe, it, expect } from "vitest";
import { serializeTimings, parseTimings, formatTimecode } from "./timingFormat";
import { LyricEvent } from "./timing";
import { fromEvents, toEvents } from "./timedSegments";
import { LYRIC_MARKERS } from "@/constants";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

// Round to centiseconds — the precision the readable format quantizes to (and the
// precision ASS karaoke output itself uses), so comparisons aren't tripped by float noise.
function toCs(events: LyricEvent[]): LyricEvent[] {
  return events.map(([t, m]) => [Math.round(t * 100) / 100, m]);
}

describe("formatTimecode", () => {
  it("formats seconds as MM:SS.cc", () => {
    expect(formatTimecode(0)).toBe("00:00.00");
    expect(formatTimecode(1)).toBe("00:01.00");
    expect(formatTimecode(65.07)).toBe("01:05.07");
    expect(formatTimecode(9.5)).toBe("00:09.50");
  });

  it("rounds to the nearest centisecond without carrying incorrectly", () => {
    expect(formatTimecode(59.999)).toBe("01:00.00");
  });
});

describe("parseTimings", () => {
  it("classifies a tag followed by syllable text as a start", () => {
    expect(parseTimings("<00:01.00>hello")).toEqual([{ text: "hello", start: 1.0 }]);
  });

  it("classifies a bare trailing tag as an end (rest)", () => {
    expect(parseTimings("<00:01.00>hello<00:02.00>")).toEqual([
      { text: "hello", start: 1.0, end: 2.0 },
    ]);
  });

  it("treats separators and whitespace between tags as non-syllable", () => {
    // The `_` is markup, not a syllable, so the second tag is a rest.
    expect(parseTimings("<00:01.00>a<00:02.00>_<00:03.00>b")).toEqual([
      { text: "a_", start: 1.0, end: 2.0 },
      { text: "b", start: 3.0 },
    ]);
  });

  it("recovers the lyrics untimed when the text has no tags", () => {
    expect(parseTimings("just some_lyrics")).toEqual([{ text: "just some_" }, { text: "lyrics" }]);
  });

  it("keeps an untimed syllable in place instead of dropping it", () => {
    // The whole point of the segment form:
    // the untagged middle stays a hole rather than letting "three" inherit the timing meant for "two".
    expect(parseTimings("<00:01.00>one_two_<00:03.00>three")).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ]);
  });
});

describe("serializeTimings", () => {
  it("returns the lyrics unchanged when there are no timings", () => {
    expect(serializeTimings(fromEvents("hello_world", []))).toBe("hello_world");
  });

  it("prefixes each timed syllable with its start tag", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_START],
    ];
    expect(serializeTimings(fromEvents("hi_there", events))).toBe("<00:01.00>hi_<00:02.00>there");
  });

  it("emits a bare rest tag for an explicit segment end", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [1.5, SEGMENT_END],
      [3.0, SEGMENT_START],
    ];
    expect(serializeTimings(fromEvents("hi_there", events))).toBe(
      "<00:01.00>hi<00:01.50>_<00:03.00>there",
    );
  });

  it("leaves untimed trailing segments without tags", () => {
    const events: LyricEvent[] = [[1.0, SEGMENT_START]];
    expect(serializeTimings(fromEvents("hi_there", events))).toBe("<00:01.00>hi_there");
  });
});

describe("round-trip", () => {
  it("recovers the timing array from the serialized form (fixture)", () => {
    const text = serializeTimings(fromEvents(testLyrics, shortIntroTestEvents));
    expect(toCs(toEvents(parseTimings(text)))).toEqual(toCs(shortIntroTestEvents));
  });

  it("preserves lyric markup (_ / newlines) in the serialized text", () => {
    const text = serializeTimings(fromEvents(testLyrics, shortIntroTestEvents));
    expect(text).toContain("ba/"); // within-word "/" boundary preserved
    expect(text).toContain("\n\n"); // screen break preserved
    expect(text).toContain("Be bop<"); // literal space inside a segment preserved
  });

  it("is idempotent under serialize → parse → serialize", () => {
    const once = serializeTimings(fromEvents(testLyrics, shortIntroTestEvents));
    const twice = serializeTimings(parseTimings(once));
    expect(twice).toBe(once);
  });

  it("round-trips a fully-timed sequence with ends", () => {
    const events: LyricEvent[] = [
      [0.5, SEGMENT_START],
      [1.0, SEGMENT_END],
      [1.2, SEGMENT_START],
      [2.0, SEGMENT_END],
    ];
    const text = serializeTimings(fromEvents("one_two", events));
    expect(toCs(toEvents(parseTimings(text)))).toEqual(toCs(events));
  });
});
