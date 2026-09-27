import { describe, expect, it } from "vitest";
import { displayBands } from "./displayBands";
import { DEFAULT_KARAOKE_OPTIONS, KaraokeOptions } from "./timing";

const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  addInstrumentalScreens: false,
  addStaggeredLines: false,
};

describe("displayBands", () => {
  it("gives each line its period, its row, its text and the segment that stores it", () => {
    const bands = displayBands(
      [
        { text: "a_", start: 10 },
        { text: "b\n", start: 11, end: 12 },
        { text: "c\n\n", start: 13, end: 14, displayEnd: 20 },
        { text: "d", start: 16, end: 17, displayStart: 15 },
      ],
      30,
      options,
    );

    expect(bands).toEqual([
      {
        segmentIndex: 0,
        row: 0,
        text: "a b",
        syllables: [
          { start: 10, end: 11 },
          { start: 11, end: 12 },
        ],
        start: 0,
        end: 14,
        startStored: false,
        endStored: false,
        latestStart: 10,
        earliestEnd: 12,
      },
      {
        segmentIndex: 2,
        row: 1,
        text: "c",
        syllables: [{ start: 13, end: 14 }],
        start: 0,
        end: 20,
        startStored: false,
        endStored: true,
        latestStart: 13,
        earliestEnd: 14,
      },
      {
        segmentIndex: 3,
        row: 2,
        text: "d",
        syllables: [{ start: 16, end: 17 }],
        start: 15,
        end: 17,
        startStored: true,
        endStored: false,
        latestStart: 16,
        earliestEnd: 17,
      },
    ]);
  });

  it("gives each line the placement stored under its first segment", () => {
    const segments = [
      { text: "a\n", start: 1, end: 2 },
      { text: "b_", start: 3 },
      { text: "c", start: 4, end: 5 },
    ];
    const placement = { top: 10, bottom: 30, overlaps: true, earliestStart: 0, latestEnd: 30 };
    const bands = displayBands(segments, 30, options, new Map([[1, placement]]));
    expect(bands.map((band) => band.placement)).toEqual([undefined, placement]);
  });

  it("moves a bound that gave way to another line", () => {
    const segments = [{ text: "a", start: 3, end: 4 }];
    const placement = {
      top: 10,
      bottom: 30,
      overlaps: false,
      earliestStart: 2,
      latestEnd: 30,
      startGaveWay: 2,
    };
    const [band] = displayBands(segments, 30, options, new Map([[0, placement]]));
    expect(band.start).toBe(2);
    expect(band.end).toBe(4);
  });

  it("puts every fifth line back in the first row", () => {
    const segments = Array.from({ length: 6 }, (_, i) => ({ text: `l${i}\n`, start: i }));
    expect(displayBands(segments, 30, options).map((band) => band.row)).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("leaves out the title screen, so the bands stay in song time", () => {
    const [band] = displayBands([{ text: "a", start: 1.5, displayStart: 1 }], 30, {
      ...options,
      addTitleScreen: true,
    });

    expect(band.start).toBe(1);
  });
});
