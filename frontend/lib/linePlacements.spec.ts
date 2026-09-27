import { describe, expect, it } from "vitest";
import { LinePlacement, placeLines, sameHeight } from "./linePlacements";
import { DEFAULT_KARAOKE_OPTIONS, KaraokeOptions, VerticalAlignment, VoiceTrack } from "./timing";
import { TimedSegment } from "./timedSegments";
import { LINE_FADE } from "./screenSlots";

const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  addTitleScreen: false,
  countInMode: "none",
  addInstrumentalScreens: false,
  addStaggeredLines: false,
};

function place(segments: TimedSegment[], trackOptions: KaraokeOptions = options) {
  return placeLines([{ voice: "v", segments, options: trackOptions }], 30, "", "").v;
}

function overlapping(placements: Map<number, LinePlacement>): Set<number> {
  return new Set([...placements].filter(([, line]) => line.overlaps).map(([index]) => index));
}

function voiceOverlaps(tracks: VoiceTrack[]) {
  const placements = placeLines(tracks, 30, "", "");
  return Object.fromEntries(
    Object.entries(placements).map(([voice, lines]) => [voice, overlapping(lines)]),
  );
}

// Two screens of two lines: a and c share a height, and so do b and d.
const twoScreens: TimedSegment[] = [
  { text: "a\n", start: 1, end: 2 },
  { text: "b\n\n", start: 3, end: 4 },
  { text: "c\n", start: 6, end: 7 },
  { text: "d", start: 8, end: 9 },
];

function withPeriod(segments: TimedSegment[], index: number, period: Partial<TimedSegment>) {
  return segments.map((segment, i) => (i === index ? { ...segment, ...period } : segment));
}

describe("placeLines", () => {
  it("puts lines below a spacer half a slot lower", () => {
    const top = (segments: TimedSegment[]) => [...place(segments).values()].map((line) => line.top);
    const plain = top([
      { text: "a\n", start: 1, end: 2 },
      { text: "b", start: 3, end: 4 },
    ]);
    const spaced = top([
      { text: "a\n", start: 1, end: 2, spacersBefore: 1 },
      { text: "b", start: 3, end: 4 },
    ]);
    expect(spaced.map((y, i) => y - plain[i])).toEqual([15, 15]);
  });

  it("puts a screen's lines at the heights of the previous screen's lines", () => {
    const lines = place(twoScreens);
    const [a, b, c, d] = [0, 1, 2, 3].map((index) => lines.get(index)!);

    expect(sameHeight(a, c)).toBe(true);
    expect(sameHeight(b, d)).toBe(true);
    expect(sameHeight(a, b)).toBe(false);
    expect(sameHeight(a, d)).toBe(false);
  });

  it("flags nothing when every line follows the automatic rules", () => {
    expect(overlapping(place(twoScreens))).toEqual(new Set());
    expect(overlapping(place(twoScreens, DEFAULT_KARAOKE_OPTIONS))).toEqual(new Set());
  });

  describe("an automatic bound", () => {
    it("starts once the stored end of the line at its height has passed", () => {
      const lines = place(withPeriod(twoScreens, 0, { displayEnd: 5 }));

      expect(lines.get(2)).toMatchObject({ startMoved: 5, overlaps: false });
      // d only makes way for b to fade out.
      expect(lines.get(3)?.startMoved).toBe(4 + LINE_FADE);
    });

    it("ends when a stored start shows the line at its height", () => {
      const lines = place(withPeriod(twoScreens, 2, { displayStart: 3.5 }));

      // a is shown until its screen ends at 4 unless it gives way.
      expect(lines.get(0)).toMatchObject({ endMoved: 3.5, overlaps: false });
      // b only stays to fade out.
      expect(lines.get(1)?.endMoved).toBe(4 + LINE_FADE);
    });

    it("gives way to a line of another voice", () => {
      // Voices only get lanes while their screens overlap, and a stored end doesn't lengthen a screen.
      const placements = placeLines(
        [
          { voice: "Anna", segments: [{ text: "a", start: 1, end: 2, displayEnd: 20 }], options },
          { voice: "Ben", segments: [{ text: "b", start: 20, end: 21 }], options },
        ],
        30,
        "",
        "",
      );

      expect(placements.Ben.get(0)).toMatchObject({ startMoved: 20, overlaps: false });
    });
  });

  describe("overlaps", () => {
    it("flags a stored end that runs into the timings of the line at its height", () => {
      const lines = place(withPeriod(twoScreens, 0, { displayEnd: 6.5 }));
      expect(overlapping(lines)).toEqual(new Set([0, 2]));
    });

    it("flags a stored start that runs into the timings of the line at its height", () => {
      const lines = place(withPeriod(twoScreens, 2, { displayStart: 1.5 }));
      expect(overlapping(lines)).toEqual(new Set([0, 2]));
    });

    it("flags lines of two voices shown in the same place", () => {
      const overlaps = voiceOverlaps([
        { voice: "Anna", segments: [{ text: "a", start: 1, end: 2, displayEnd: 20.5 }], options },
        { voice: "Ben", segments: [{ text: "b", start: 20, end: 21 }], options },
      ]);
      expect(overlaps).toEqual({ Anna: new Set([0]), Ben: new Set([0]) });
    });

    it("leaves lines shown at the same time at different heights alone", () => {
      const lines = place(withPeriod(twoScreens, 1, { displayEnd: 8.5 }));
      expect(overlapping(lines)).toEqual(new Set([1, 3]));
      expect(lines.get(2)?.overlaps).toBe(false);
    });

    it("leaves voices in lanes of their own alone", () => {
      const overlaps = voiceOverlaps([
        { voice: "Anna", segments: [{ text: "a", start: 1, end: 2, displayEnd: 6 }], options },
        { voice: "Ben", segments: [{ text: "b", start: 5, end: 6 }], options },
      ]);
      expect(overlaps).toEqual({ Anna: new Set(), Ben: new Set() });
    });
  });

  describe("drag limits", () => {
    it("stop at the timings and stored bounds of the lines at the same height", () => {
      const lines = place(withPeriod(twoScreens, 2, { displayStart: 4.5 }));

      expect(lines.get(0)?.latestEnd).toBe(4.5);
      expect(lines.get(2)?.earliestStart).toBe(2);
      // Nothing at the height of d follows it, and nothing at the height of b precedes it.
      expect(lines.get(3)?.latestEnd).toBe(30);
      expect(lines.get(1)?.earliestStart).toBe(0);
    });

    it("are in song time when the title screen delays the song", () => {
      const lines = place(withPeriod(twoScreens, 2, { displayStart: 4.5 }), {
        ...options,
        addTitleScreen: true,
      });

      expect(lines.get(0)?.latestEnd).toBe(4.5);
    });
  });
});

describe("placeLines with staggered lines and voice lanes", () => {
  // Anna's second screen would show its first lines early, while her first screen is still displayed.
  // Ben's line puts only her first screen in a lane, so the second one stays out of it.
  const anna: TimedSegment[] = [
    { text: "x\n\n", start: 1, end: 2 },
    { text: "a\n", start: 3, end: 3.9 },
    { text: "b\n", start: 4, end: 4.9 },
    { text: "c\n", start: 5, end: 5.9 },
    { text: "d\n\n", start: 6, end: 6.9 },
    { text: "e\n", start: 7.5, end: 8.4 },
    { text: "f", start: 8.5, end: 9.4 },
  ];
  const ben: TimedSegment[] = [{ text: "z", start: 4, end: 5 }];

  for (const verticalAlignment of [
    VerticalAlignment.Top,
    VerticalAlignment.Middle,
    VerticalAlignment.Bottom,
  ]) {
    it(`shows the next screen's lines at the usual time, out of the lane (alignment ${verticalAlignment})`, () => {
      const staggered = { ...options, addStaggeredLines: true, verticalAlignment };
      const placements = placeLines(
        [
          { voice: "Anna", segments: anna, options: staggered },
          { voice: "Ben", segments: ben, options: staggered },
        ],
        30,
        "",
        "",
      );
      const alone = place(anna, { ...options, verticalAlignment });
      const lines = placements.Anna;

      expect(overlapping(lines)).toEqual(new Set());
      expect(lines.get(5)?.top).toBe(alone.get(5)?.top);
      expect(lines.get(6)?.top).toBe(alone.get(6)?.top);
    });
  }
});
