import { describe, it, expect } from "vitest";
import { fromEvents, toEvents, reconcile, TimedSegment } from "./timedSegments";
import { parseLyrics } from "./timing";
import { LyricEvent } from "./timing";
import { LYRIC_MARKERS } from "@/constants";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

describe("fromEvents", () => {
  it("pairs each segment with its own start and end", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [3.0, SEGMENT_START],
    ];
    expect(fromEvents("hi_there", events)).toEqual([
      { text: "hi_", start: 1.0, end: 2.0 },
      { text: "there", start: 3.0 },
    ]);
  });

  it("leaves segments past the end of the events untimed", () => {
    expect(fromEvents("one_two_three", [[1.0, SEGMENT_START]])).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three" },
    ]);
  });

  it("keeps events past the end of the lyrics, as textless segments", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_START],
      [3.0, SEGMENT_START],
    ];
    expect(fromEvents("only", events)).toEqual([
      { text: "only", start: 1.0 },
      { text: "", start: 2.0 },
      { text: "", start: 3.0 },
    ]);
  });

  it("keeps timings entered before any lyrics exist", () => {
    const events: LyricEvent[] = [
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
    ];
    expect(fromEvents("", events)).toEqual([{ text: "", start: 1.0, end: 2.0 }]);
  });

  it("parses the shared fixture into one segment per lyric segment", () => {
    const segments = fromEvents(testLyrics, shortIntroTestEvents);
    expect(segments).toEqual([
      { text: "Be bop_", start: 1.0, end: 2.0 },
      { text: "a lu bop\n", start: 3.0 },
      { text: "She's my ba/", start: 4.0 },
      { text: "by\n\n", start: 5.0 },
      { text: "And_", start: 6.0 },
      { text: "here's_", start: 7.0 },
      { text: "screen_", start: 8.0 },
      { text: "two", start: 9.0 },
    ]);
  });

  it("returns untimed segments when there are no events", () => {
    expect(fromEvents("a_b", [])).toEqual([{ text: "a_" }, { text: "b" }]);
  });
});

describe("toEvents", () => {
  it("emits a start, and an end only when there is one", () => {
    const segments: TimedSegment[] = [
      { text: "hi_", start: 1.0, end: 2.0 },
      { text: "there", start: 3.0 },
    ];
    expect(toEvents(segments)).toEqual([
      [1.0, SEGMENT_START],
      [2.0, SEGMENT_END],
      [3.0, SEGMENT_START],
    ]);
  });

  it("skips an untimed segment, which is where the legacy form loses information", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ];
    expect(toEvents(segments)).toEqual([
      [1.0, SEGMENT_START],
      [3.0, SEGMENT_START],
    ]);
  });

  it("drops an end whose segment has no start, rather than misattaching it", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two", end: 5.0 },
    ];
    expect(toEvents(segments)).toEqual([[1.0, SEGMENT_START]]);
  });
});

describe("round trip", () => {
  it("is lossless for a fully-timed project", () => {
    expect(toEvents(fromEvents(testLyrics, shortIntroTestEvents))).toEqual(shortIntroTestEvents);
  });

  it("collapses a hole, so re-reading misattributes the timings that follow it", () => {
    const segments: TimedSegment[] = [
      { text: "one_", start: 1.0 },
      { text: "two_" },
      { text: "three", start: 3.0 },
    ];
    const reread = fromEvents("one_two_three", toEvents(segments));
    expect(reread).toEqual([
      { text: "one_", start: 1.0 },
      { text: "two_", start: 3.0 },
      { text: "three" },
    ]);
  });
});

describe("reconcile", () => {
  const lyrics = (text: string) => parseLyrics(text, true);
  const timed = (text: string, start?: number, end?: number): TimedSegment => {
    const segment: TimedSegment = { text };
    if (start !== undefined) segment.start = start;
    if (end !== undefined) segment.end = end;
    return segment;
  };

  it("rule 1: a typo keeps every timing, because the count is unchanged", () => {
    const stored = [timed("recieve_", 1.0, 1.5), timed("the_", 2.0), timed("call", 3.0)];

    expect(reconcile(stored, lyrics("receive_the_call"))).toEqual([
      timed("receive_", 1.0, 1.5),
      timed("the_", 2.0),
      timed("call", 3.0),
    ]);
  });

  it("rule 3: splitting a word keeps the outer bounds and leaves the middle untimed", () => {
    const stored = [timed("one_", 1.0), timed("alchemy_", 2.0, 2.9), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_al/chem/y_three"))).toEqual([
      timed("one_", 1.0),
      timed("al/", 2.0),
      timed("chem/"),
      timed("y_", undefined, 2.9),
      timed("three", 3.0),
    ]);
  });

  it("rule 3: joining syllables takes the first start and the last end", () => {
    const stored = [
      timed("one_", 1.0),
      timed("al/", 2.0),
      timed("che/", 2.3),
      timed("my_", 2.6, 2.9),
      timed("three", 3.0),
    ];

    expect(reconcile(stored, lyrics("one_alchemy_three"))).toEqual([
      timed("one_", 1.0),
      timed("alchemy_", 2.0, 2.9),
      timed("three", 3.0),
    ]);
  });

  it("rule 2: an insertion at the head leaves the tail's timings untouched", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("zero_one_two_three"))).toEqual([
      timed("zero_"),
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("rule 2: a deletion at the head leaves the tail's timings untouched", () => {
    const stored = [
      timed("zero_", 0.5),
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ];

    expect(reconcile(stored, lyrics("one_two_three"))).toEqual([
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("rule 4: an unrelated rewrite untimes only the changed window", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_bravo_charlie_three"))).toEqual([
      timed("one_", 1.0),
      timed("bravo_"),
      timed("charlie_"),
      timed("three", 3.0),
    ]);
  });

  // The last segment of a lyric carries no trailing separator, so appending to the end rewrites it
  // (`three` -> `three_`) without changing the word. That must not cost it its timing.
  it("keeps the old last segment when a word is appended", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];

    expect(reconcile(stored, lyrics("one_two_three_four"))).toEqual([
      timed("one_", 1.0),
      timed("two_", 2.0),
      timed("three_", 3.0),
      timed("four"),
    ]);
  });

  it("keeps the old last line when a line is appended", () => {
    const stored = [
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three_", 3.0),
      timed("four", 4.0),
    ];

    expect(reconcile(stored, lyrics("one_two\nthree_four\nfive_six"))).toEqual([
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three_", 3.0),
      timed("four\n", 4.0),
      timed("five_"),
      timed("six"),
    ]);
  });

  it("keeps the new last segment when the tail is deleted", () => {
    const stored = [timed("aa_", 1.0), timed("bb\n", 2.0), timed("cc_", 3.0), timed("dd", 4.0)];

    expect(reconcile(stored, lyrics("aa_bb"))).toEqual([timed("aa_", 1.0), timed("bb", 2.0)]);
  });

  it("seeds untimed segments when there is nothing stored yet", () => {
    expect(reconcile([], lyrics("one_two"))).toEqual([timed("one_"), timed("two")]);
  });

  it("drops everything when the lyrics are cleared", () => {
    expect(reconcile([timed("one_", 1.0), timed("two", 2.0)], lyrics(""))).toEqual([]);
  });

  it("always returns exactly the current lyric segments", () => {
    const stored = [timed("one_", 1.0), timed("two_", 2.0), timed("three", 3.0)];
    for (const text of ["one_two_three", "one_two", "a_b_c_d_e", "", "one_two_three_four"]) {
      const current = lyrics(text);
      const result = reconcile(stored, current);
      expect(result.map((s) => s.text)).toEqual(current.map((s) => s.text));
    }
  });
});
