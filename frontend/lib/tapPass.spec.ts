import { describe, it, expect } from "vitest";
import {
  followHead,
  moveHead,
  lineStartOf,
  lineStarts,
  prerollStart,
  previousLine,
  redoLine,
  segmentHeadAt,
  startPass,
  steppedTap,
  tapEnd,
  tapStart,
  tapSteps,
  undoTap,
} from "./tapPass";
import { TimedSegment } from "./timedSegments";

// Two lines of three segments and one of two, all timed and open-ended.
function timedSong(): TimedSegment[] {
  return [
    { text: "ka_", start: 1 },
    { text: "den ", start: 2 },
    { text: "lu\n", start: 3 },
    { text: "ve_", start: 5 },
    { text: "lo ", start: 6 },
    { text: "mar\n\n", start: 7 },
    { text: "so ", start: 10 },
    { text: "ta", start: 11 },
  ];
}

function untimed(segments: TimedSegment[]): TimedSegment[] {
  return segments.map(({ text }) => ({ text }));
}

describe("lineStarts", () => {
  it("starts a line after every line break, blank lines included", () => {
    expect(lineStarts(timedSong())).toEqual([0, 3, 6]);
  });

  it("has no lines without segments", () => {
    expect(lineStarts([])).toEqual([]);
  });
});

describe("segmentHeadAt", () => {
  it("lands on the segment the playhead is in", () => {
    expect(segmentHeadAt(timedSong(), 6.5)).toBe(4);
  });

  it("lands on the next segment when the playhead is between two", () => {
    const segments = timedSong();
    segments[2].end = 3.5;
    expect(segmentHeadAt(segments, 4)).toBe(3);
  });

  it("keeps an open-ended segment up to the next start", () => {
    expect(segmentHeadAt(timedSong(), 4.9)).toBe(2);
  });

  it("lands on the first segment before any timing", () => {
    expect(segmentHeadAt(timedSong(), 0.5)).toBe(0);
  });

  it("lands on the first segment of a fresh voice", () => {
    expect(segmentHeadAt(untimed(timedSong()), 30)).toBe(0);
  });

  it("lands on the first untimed segment past the start of the last timed one", () => {
    const segments = timedSong();
    segments[5] = { text: "mar\n\n" };
    segments[6] = { text: "so " };
    segments[7] = { text: "ta" };
    expect(segmentHeadAt(segments, 6.5)).toBe(5);
  });

  it("stays on the last segment past the end of the song", () => {
    expect(segmentHeadAt(timedSong(), 60)).toBe(7);
  });
});

describe("followHead", () => {
  const texts = (...words: string[]) => words.map((text) => ({ text }));

  it("keeps the head's index when the lyrics change after it", () => {
    expect(followHead(texts("ka_", "den_", "lu"), texts("ka_", "den_", "l/", "u"), 1)).toBe(1);
  });

  it("keeps the head's distance from the end when a segment before it is split", () => {
    expect(followHead(texts("ka_", "den_", "lu"), texts("k/", "a_", "den_", "lu"), 2)).toBe(3);
  });

  it("moves the head to the start of the edit when the edit covers it", () => {
    expect(followHead(texts("ka_", "den_", "lu"), texts("ka_", "d/", "en_", "lu"), 1)).toBe(1);
    expect(followHead(texts("ka_", "den_", "mo_", "lu"), texts("ka_", "d/", "e/", "lu"), 2)).toBe(
      1,
    );
  });

  it("keeps a head past the last segment past it", () => {
    expect(followHead(texts("ka_", "lu"), texts("k/", "a_", "lu"), 2)).toBe(3);
  });

  it("ignores a separator that changed", () => {
    expect(followHead(texts("ka_", "den"), texts("ka\n", "den"), 1)).toBe(1);
  });
});

describe("lineStartOf", () => {
  it("finds the first segment of a segment's line", () => {
    expect(lineStartOf(timedSong(), 5)).toBe(3);
    expect(lineStartOf(timedSong(), 3)).toBe(3);
  });

  it("gives the last line past the last segment", () => {
    expect(lineStartOf(timedSong(), 8)).toBe(6);
  });
});

describe("previousLine", () => {
  it("goes back to the start of the head's own line", () => {
    expect(previousLine(timedSong(), 4)).toBe(3);
  });

  it("goes back a line when the head is on a line's first segment", () => {
    expect(previousLine(timedSong(), 3)).toBe(0);
  });

  it("stays on the first line", () => {
    expect(previousLine(timedSong(), 0)).toBe(0);
  });

  it("goes back to the last line once every segment is tapped", () => {
    expect(previousLine(timedSong(), 8)).toBe(6);
  });
});

describe("prerollStart", () => {
  it("counts back from the head's start", () => {
    expect(prerollStart(timedSong(), 3, 2)).toBe(3);
  });

  it("stops at the start of the song", () => {
    expect(prerollStart(timedSong(), 0, 5)).toBe(0);
  });

  it("counts back from the end of the last timed segment before an untimed head", () => {
    const segments = timedSong();
    segments[5].end = 8;
    segments[6] = { text: "so " };
    segments[7] = { text: "ta" };
    expect(prerollStart(segments, 6, 2)).toBe(6);
  });

  it("counts back from the last start when that segment has no end", () => {
    const segments = timedSong();
    segments[6] = { text: "so " };
    segments[7] = { text: "ta" };
    expect(prerollStart(segments, 6, 2)).toBe(5);
  });

  it("starts a fresh voice at the start of the song", () => {
    expect(prerollStart(untimed(timedSong()), 0, 2)).toBe(0);
  });
});

describe("a pass", () => {
  it("times the head and moves on, leaving the segments it hasn't reached alone", () => {
    const segments = timedSong();
    const pass = tapStart(startPass(segments, 3), 5.2);
    expect(pass.head).toBe(4);
    expect(pass.growing).toBe(3);
    expect([...pass.tapped]).toEqual([3]);
    expect(pass.staged.map((s) => s.start)).toEqual([1, 2, 3, 5.2, 6, 7, 10, 11]);
  });

  it("stages the taps without changing the segments it started from", () => {
    const segments = timedSong();
    tapStart(startPass(segments, 3), 5.2);
    expect(segments).toEqual(timedSong());
  });

  it("drops a tapped segment's old end", () => {
    const segments = timedSong();
    segments[3].end = 5.8;
    const pass = tapStart(startPass(segments, 3), 5.2);
    expect(pass.staged[3]).toEqual({ text: "ve_", start: 5.2, end: undefined });
  });

  describe("clears the review flag of every segment a tap retimes", () => {
    const flagged = () => timedSong().map((segment) => ({ ...segment, review: "moved" as const }));
    const reviews = (pass: ReturnType<typeof startPass>) => pass.staged.map((s) => s.review);

    it("on the tapped segment, and on the one before it when its end is pulled back", () => {
      const segments = flagged();
      segments[2].end = 5.5;
      const pass = tapStart(startPass(segments, 3), 5.2);
      expect(reviews(pass)).toEqual([
        "moved",
        "moved",
        undefined,
        undefined,
        "moved",
        "moved",
        "moved",
        "moved",
      ]);
    });

    it("on a segment whose old start the tap passes", () => {
      const pass = tapStart(startPass(flagged(), 3), 6.5);
      expect(reviews(pass)).toEqual([
        "moved",
        "moved",
        "moved",
        undefined,
        undefined,
        "moved",
        "moved",
        "moved",
      ]);
    });

    it("on the segment an end tap ends", () => {
      const pass = tapEnd(startPass(flagged(), 1), 1.5);
      expect(pass.staged[0].review).toBeUndefined();
      expect(pass.staged[1].review).toBe("moved");
    });
  });

  it("ends the growing segment on an end tap", () => {
    let pass = tapStart(startPass(timedSong(), 3), 5.2);
    pass = tapEnd(pass, 5.7);
    expect(pass.staged[3].end).toBe(5.7);
    expect(pass.growing).toBeUndefined();
    expect(pass.head).toBe(4);
  });

  it("starts with the segment before the head growing when it has no end", () => {
    const pass = tapEnd(startPass(timedSong(), 4), 5.5);
    expect(pass.staged[3].end).toBe(5.5);
    expect(pass.growing).toBeUndefined();
  });

  it("ignores an end tap when the segment before the head has an end", () => {
    const segments = timedSong();
    segments[3].end = 5.5;
    const pass = startPass(segments, 4);
    expect(pass.growing).toBeUndefined();
    expect(tapEnd(pass, 5.7)).toBe(pass);
  });

  it("ignores an end tap before the first segment", () => {
    const pass = startPass(timedSong(), 0);
    expect(tapEnd(pass, 0.5)).toBe(pass);
  });

  it("ignores an end tap at or before the growing segment's start", () => {
    const pass = tapStart(startPass(timedSong(), 3), 5.2);
    expect(tapEnd(pass, 5.2)).toBe(pass);
  });

  it("pulls an end back to the next segment's start", () => {
    let pass = tapStart(startPass(timedSong(), 3), 5.2);
    pass = tapEnd(pass, 6.3);
    expect(pass.staged[3].end).toBe(6);
    expect(pass.staged[4].start).toBe(6);
  });

  it("makes holes of later segments a late tap has passed", () => {
    const pass = tapStart(startPass(timedSong(), 3), 6.5);
    expect(pass.staged.map((s) => s.start)).toEqual([1, 2, 3, 6.5, undefined, 7, 10, 11]);
  });

  it("drops the end of a segment it makes a hole of", () => {
    const segments = timedSong();
    segments[4].end = 6.4;
    const pass = tapStart(startPass(segments, 3), 6.5);
    expect(pass.staged[4]).toEqual({ text: "lo ", start: undefined, end: undefined });
  });

  it("ignores a start tap at or before the start of the segment before the head", () => {
    const pass = startPass(timedSong(), 3);
    expect(tapStart(pass, 3)).toBe(pass);
  });

  it("clamps the end of the segment before the first tap", () => {
    const segments = timedSong();
    segments[2].end = 4.5;
    const pass = tapStart(startPass(segments, 3), 4.2);
    expect(pass.staged[2].end).toBe(4.2);
  });

  it("does nothing once every segment is tapped", () => {
    const pass = startPass(timedSong(), 8);
    expect(tapStart(pass, 12)).toBe(pass);
  });

  it("keeps the taps made so far when it stops mid-line", () => {
    let pass = startPass(timedSong(), 3);
    pass = tapStart(pass, 5.2);
    pass = tapStart(pass, 6.1);
    expect(pass.staged.map((s) => s.start)).toEqual([1, 2, 3, 5.2, 6.1, 7, 10, 11]);
    expect([...pass.tapped]).toEqual([3, 4]);
  });

  it("times a fresh voice from its first line", () => {
    let pass = startPass(untimed(timedSong()), 0);
    pass = tapStart(pass, 1);
    pass = tapStart(pass, 2);
    pass = tapEnd(pass, 2.5);
    expect(pass.staged.slice(0, 3)).toEqual([
      { text: "ka_", start: 1, end: undefined },
      { text: "den ", start: 2, end: 2.5 },
      { text: "lu\n" },
    ]);
    expect(pass.head).toBe(2);
  });

  it("lets the segment before a moved head be ended", () => {
    const pass = moveHead(startPass(timedSong(), 0), 4);
    expect(pass.growing).toBe(3);
  });

  it("walks back a line at a time on redo, keeping the taps", () => {
    let pass = startPass(timedSong(), 3);
    pass = tapStart(pass, 5.2);
    pass = redoLine(pass);
    expect(pass.head).toBe(3);
    expect(pass.growing).toBe(2);
    expect(pass.staged[3].start).toBe(5.2);
    pass = redoLine(pass);
    expect(pass.head).toBe(0);
  });

  it("makes holes of segments tapped before a redo when a new tap passes them", () => {
    let pass = startPass(timedSong(), 3);
    pass = tapStart(pass, 5.2);
    pass = tapStart(pass, 6.1);
    pass = redoLine(pass);
    pass = tapStart(pass, 6.3);
    expect(pass.staged[3].start).toBe(6.3);
    expect(pass.staged[4].start).toBeUndefined();
    expect([...pass.tapped]).toEqual([3]);
  });
});

describe("undoTap", () => {
  it("takes back the last tap, with its time", () => {
    const first = tapStart(startPass(timedSong(), 3), 5.2);
    const second = tapStart(first, 6.5);
    const undone = undoTap(second);
    expect(undone?.pass).toBe(first);
    expect(undone?.time).toBe(6.5);
  });

  it("brings back the timing of a segment the tap made a hole of", () => {
    const hole = tapStart(startPass(timedSong(), 3), 6.5);
    expect(hole.staged[4].start).toBeUndefined();
    expect(undoTap(hole)?.pass.staged[4].start).toBe(6);
  });

  it("takes back an end tap, so the segment grows again", () => {
    const tapped = tapStart(startPass(timedSong(), 3), 5.2);
    const ended = tapEnd(tapped, 5.7);
    const undone = undoTap(ended);
    expect(undone?.pass.growing).toBe(3);
    expect(undone?.pass.staged[3].end).toBeUndefined();
    expect(undone?.time).toBe(5.7);
  });

  it("walks back one tap at a time to the start of the pass", () => {
    const start = startPass(timedSong(), 3);
    const pass = tapStart(tapStart(start, 5.2), 6.1);
    const once = undoTap(pass)!.pass;
    const twice = undoTap(once)!.pass;
    expect(twice).toBe(start);
    expect(undoTap(twice)).toBeNull();
  });

  it("lets the segment before the pass's first tap be ended again", () => {
    const start = startPass(timedSong(), 3);
    const undone = undoTap(tapStart(start, 5.2))!.pass;
    expect(tapEnd(undone, 4).staged[2].end).toBe(4);
  });

  it("leaves nothing to take back for an ignored tap", () => {
    const pass = startPass(timedSong(), 3);
    expect(undoTap(tapStart(pass, 3))).toBeNull();
  });
});

describe("tapSteps", () => {
  it("gives the segments after each tap, oldest first", () => {
    const first = tapStart(startPass(timedSong(), 3), 5.2);
    const second = tapEnd(first, 5.7);
    expect(tapSteps(second)).toEqual([first.staged, second.staged]);
  });

  it("leaves out a tap that was undone", () => {
    const first = tapStart(startPass(timedSong(), 3), 5.2);
    const undone = undoTap(tapStart(first, 6.5))!.pass;
    expect(tapSteps(undone)).toEqual([first.staged]);
  });

  it("has no steps for a pass with no taps", () => {
    expect(tapSteps(startPass(timedSong(), 3))).toEqual([]);
  });
});

describe("steppedTap", () => {
  const tapped = tapStart(startPass(timedSong(), 3), 5.2).staged;
  const ended = tapEnd(tapStart(startPass(timedSong(), 3), 5.2), 5.7).staged;

  it("queues the segment of an undone start tap again", () => {
    expect(steppedTap(tapped, timedSong(), "undo")).toEqual({ head: 3, time: 5.2 });
  });

  it("queues the segment after a redone start tap", () => {
    expect(steppedTap(timedSong(), tapped, "redo")).toEqual({ head: 4, time: 5.2 });
  });

  it("queues the segment after an undone end tap", () => {
    expect(steppedTap(ended, tapped, "undo")).toEqual({ head: 4, time: 5.7 });
  });

  it("finds the start tap when it also clamped the end before it", () => {
    const segments = timedSong();
    segments[2].end = 4.5;
    const clamped = tapStart(startPass(segments, 3), 4.2).staged;
    expect(steppedTap(clamped, segments, "undo")).toEqual({ head: 3, time: 4.2 });
  });

  it("finds nothing when nothing changed", () => {
    expect(steppedTap(timedSong(), timedSong(), "undo")).toBeNull();
  });
});
