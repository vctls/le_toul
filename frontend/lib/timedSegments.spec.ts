import { describe, it, expect } from "vitest";
import {
  fromEvents,
  toEvents,
  reconcile,
  lostTimings,
  clampDisplayPeriods,
  normalizeDisplayPeriods,
  TimedSegment,
} from "./timedSegments";
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

  it("keeps the lyrics' spacer counts", () => {
    expect(fromEvents("/\nfoo", [[1.0, SEGMENT_START]])).toEqual([
      { text: "foo", start: 1.0, spacersBefore: 1 },
    ]);
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

describe("lostTimings", () => {
  it("counts each start and end that no segment holds any more", () => {
    const before: TimedSegment[] = [
      { text: "one_", start: 1, end: 1.5 },
      { text: "two_", start: 2 },
      { text: "three", start: 3, end: 3.5 },
    ];
    const after: TimedSegment[] = [
      { text: "one_", start: 1, end: 1.5 },
      { text: "too_" },
      { text: "tree" },
      { text: "three", start: 3 },
    ];

    expect(lostTimings(before, after)).toBe(2);
  });

  it("counts a time held twice once per segment", () => {
    const before: TimedSegment[] = [
      { text: "a_", end: 2 },
      { text: "b", start: 2, end: 2 },
    ];

    expect(lostTimings(before, [{ text: "a_", end: 2 }, { text: "b" }])).toBe(2);
  });

  it("ignores display periods", () => {
    const before: TimedSegment[] = [{ text: "one", start: 1, displayStart: 0, displayEnd: 4 }];

    expect(lostTimings(before, [{ text: "one", start: 1 }])).toBe(0);
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

  it("rule 1: adding or removing a spacer keeps every timing and display period", () => {
    const stored: TimedSegment[] = [
      { text: "one\n", start: 1.0, displayStart: 0.5 },
      timed("two", 2.0),
    ];
    const spaced = reconcile(stored, lyrics("one\n/\ntwo"));

    expect(spaced).toEqual([
      { text: "one\n", start: 1.0, displayStart: 0.5 },
      { text: "two", start: 2.0, spacersBefore: 1 },
    ]);
    expect(reconcile(spaced, lyrics("one\ntwo"))).toEqual(stored);
  });

  it("rule 2: takes the spacers outside the window from the lyrics", () => {
    const stored: TimedSegment[] = [
      timed("one_", 1.0),
      timed("two\n", 2.0),
      { text: "three", start: 3.0, spacersBefore: 1 },
    ];

    expect(reconcile(stored, lyrics("/\nzero_one_two\nthree"))).toEqual([
      { text: "zero_", spacersBefore: 1 },
      timed("one_", 1.0),
      timed("two\n", 2.0),
      timed("three", 3.0),
    ]);
  });

  it("rule 3: takes the spacers inside the window from the lyrics", () => {
    const stored = [timed("one\n", 1.0), timed("alchemy", 2.0, 2.9)];

    expect(reconcile(stored, lyrics("one\n/\nal/chemy"))).toEqual([
      timed("one\n", 1.0),
      { text: "al/", start: 2.0, spacersBefore: 1 },
      timed("chemy", undefined, 2.9),
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

describe("clampDisplayPeriods", () => {
  it("stops an explicit end past the next start at that start", () => {
    const { segments, widened } = clampDisplayPeriods([
      { text: "a\n", start: 1, end: 5, displayEnd: 2.5 },
      { text: "b", start: 3 },
    ]);
    expect(segments[0].displayEnd).toBe(3);
    expect(widened).toBe(1);
  });

  it("leaves a period that already contains the timings alone", () => {
    const stored: TimedSegment[] = [
      { text: "a\n", start: 1, displayStart: 0, displayEnd: 9 },
      { text: "b", start: 3 },
    ];
    expect(clampDisplayPeriods(stored)).toEqual({ segments: stored, widened: 0 });
  });
});

describe("normalizeDisplayPeriods", () => {
  it("pushes a bound that a syllable has crossed, and never pulls it back", () => {
    const pushed = normalizeDisplayPeriods([
      { text: "a\n", start: 1, end: 4, displayStart: 2, displayEnd: 3 },
      { text: "b", start: 5 },
    ]);
    expect(pushed[0]).toMatchObject({ displayStart: 1, displayEnd: 4 });

    const movedBack = normalizeDisplayPeriods([{ ...pushed[0], start: 1.5, end: 2 }, pushed[1]]);
    expect(movedBack[0]).toMatchObject({ displayStart: 1, displayEnd: 4 });
  });

  it("clears the bounds of a segment that no longer starts a line", () => {
    expect(
      normalizeDisplayPeriods([
        { text: "a_", start: 1, displayStart: 0 },
        { text: "b", start: 2, displayStart: 1, displayEnd: 3 },
      ]),
    ).toEqual([
      { text: "a_", start: 1, displayStart: 0 },
      { text: "b", start: 2 },
    ]);
  });

  it("keeps the bounds of a line that isn't timed yet", () => {
    const untimed: TimedSegment[] = [
      { text: "a\n", displayStart: 1, displayEnd: 2 },
      { text: "b" },
    ];
    expect(normalizeDisplayPeriods(untimed)).toEqual(untimed);
  });
});
