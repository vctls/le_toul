import { describe, expect, it } from "vitest";
import {
  gapDifference,
  gapFades,
  gapGain,
  GapRestoreSettings,
  limitPeaks,
  mixGaps,
  planGaps,
} from "./gapRestore";

const settings: GapRestoreSettings = {
  preRoll: 0.5,
  postRoll: 1.5,
  minGap: 3,
  fade: 0.3,
  pausesInLines: false,
};

describe("planGaps", () => {
  it("mutes each line with its margins and restores the gaps between them", () => {
    const plan = planGaps(
      {
        "Voice 1": [
          { text: "a_", start: 10 },
          { text: "b\n", start: 11, end: 12 },
          { text: "c", start: 20, end: 21 },
        ],
      },
      30,
      settings,
    );

    expect(plan.complete).toBe(true);
    expect(plan.lines).toEqual([
      {
        voice: "Voice 1",
        segmentIndex: 0,
        text: "a b",
        syllables: [
          { start: 10, end: 11 },
          { start: 11, end: 12 },
        ],
        start: 9.5,
        end: 13.5,
        openEnd: false,
      },
      {
        voice: "Voice 1",
        segmentIndex: 2,
        text: "c",
        syllables: [{ start: 20, end: 21 }],
        start: 19.5,
        end: 22.5,
        openEnd: false,
      },
    ]);
    expect(plan.gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 13.5, end: 19.5 },
      { start: 22.5, end: 30 },
    ]);
  });

  it("keeps a gap shorter than the minimum muted, at the song's edges too", () => {
    const plan = planGaps(
      {
        "Voice 1": [
          { text: "a\n", start: 2, end: 3 },
          { text: "b\n", start: 7, end: 8 },
          { text: "c", start: 20, end: 27 },
        ],
      },
      30,
      settings,
    );

    expect(plan.gaps).toEqual([{ start: 9.5, end: 19.5 }]);
  });

  it("runs an open end to the next syllable, and marks the line", () => {
    const plan = planGaps(
      {
        "Voice 1": [
          { text: "a\n", start: 10 },
          { text: "b", start: 20, end: 21 },
        ],
      },
      30,
      settings,
    );

    expect(plan.lines[0]).toMatchObject({ start: 9.5, end: 21.5, openEnd: true });
    expect(plan.gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 22.5, end: 30 },
    ]);
  });

  it("mutes wherever any voice sings", () => {
    const plan = planGaps(
      {
        "Voice 1": [{ text: "a", start: 10, end: 12 }],
        "Voice 2": [{ text: "b", start: 15, end: 16 }],
      },
      30,
      settings,
    );

    expect(plan.lines.map(({ voice }) => voice)).toEqual(["Voice 1", "Voice 2"]);
    expect(plan.gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 17.5, end: 30 },
    ]);
  });

  it("restores nothing until every syllable has a start", () => {
    const plan = planGaps(
      {
        "Voice 1": [
          { text: "a\n", start: 10, end: 11 },
          { text: "b", end: 21 },
        ],
      },
      30,
      settings,
    );

    expect(plan.complete).toBe(false);
    expect(plan.gaps).toEqual([]);
    expect(plan.lines).toHaveLength(1);
  });

  it("restores nothing while another voice is untimed", () => {
    const plan = planGaps(
      {
        "Voice 1": [{ text: "a", start: 10, end: 11 }],
        "Voice 2": [{ text: "b" }],
      },
      30,
      settings,
    );

    expect(plan.complete).toBe(false);
    expect(plan.gaps).toEqual([]);
  });

  it("counts a hole between two timed syllables as timed", () => {
    const plan = planGaps(
      {
        "Voice 1": [{ text: "a_", start: 10 }, { text: "b_" }, { text: "c", start: 12, end: 13 }],
      },
      30,
      settings,
    );

    expect(plan.complete).toBe(true);
    expect(plan.gaps).toHaveLength(2);
  });

  it("restores nothing when nothing is timed", () => {
    expect(planGaps({ "Voice 1": [] }, 30, settings)).toEqual({
      lines: [],
      gaps: [],
      complete: false,
    });
  });

  it("restores a long pause inside a line when asked", () => {
    const voices = {
      "Voice 1": [
        { text: "a_", start: 10, end: 11 },
        { text: "b", start: 20, end: 21 },
      ],
    };

    expect(planGaps(voices, 30, settings).gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 22.5, end: 30 },
    ]);
    expect(planGaps(voices, 30, { ...settings, pausesInLines: true }).gaps).toEqual([
      { start: 0, end: 9.5 },
      { start: 12.5, end: 19.5 },
      { start: 22.5, end: 30 },
    ]);
  });

  it("starts the mute inside a line for a negative pre-roll, up to the lead allowed", () => {
    const voices = {
      "Voice 1": [
        { text: "a_", start: 10, end: 11 },
        { text: "b\n", start: 11, end: 12 },
        { text: "c", start: 20, end: 20.1 },
      ],
    };

    const plan = planGaps(voices, 30, { ...settings, preRoll: -0.5 });
    expect(plan.lines.map(({ start }) => start)).toEqual([10.2, 20.1]);
    expect(plan.gaps).toEqual([
      { start: 0, end: 10.2 },
      { start: 13.5, end: 20.1 },
      { start: 21.6, end: 30 },
    ]);
  });
});

describe("gapFades", () => {
  it("fades each side of a gap, up to half its length, but not at the song's edges", () => {
    expect(gapFades({ start: 2, end: 8 }, 1, 10)).toEqual({ fadeIn: 1, fadeOut: 1 });
    expect(gapFades({ start: 2, end: 3 }, 1, 10)).toEqual({ fadeIn: 0.5, fadeOut: 0.5 });
    expect(gapFades({ start: 0, end: 3 }, 1, 10)).toEqual({ fadeIn: 0, fadeOut: 1 });
    expect(gapFades({ start: 7, end: 10 }, 1, 10)).toEqual({ fadeIn: 1, fadeOut: 0 });
  });
});

describe("mixGaps", () => {
  const backing = [new Float32Array(10).fill(1)];
  const original = [new Float32Array(10).fill(3)];

  it("blends the original in over a gap, with a fade inside it at each side", () => {
    const [mixed] = mixGaps(backing, original, 1, [{ start: 2, end: 8 }], 2);

    expect([...mixed]).toEqual([1, 1, 1, 2, 3, 3, 3, 2, 1, 1]);
  });

  it("doesn't fade at the song's start or end", () => {
    const [mixed] = mixGaps(
      backing,
      original,
      1,
      [
        { start: 0, end: 3 },
        { start: 7, end: 10 },
      ],
      2,
    );

    expect([...mixed]).toEqual([3, 3, 3, 1, 1, 1, 1, 1, 3, 3]);
  });

  it("shortens the fades of a gap too short for them", () => {
    const [mixed] = mixGaps(backing, original, 1, [{ start: 2, end: 6 }], 5);

    expect([...mixed]).toEqual([1, 1, 1, 2, 3, 2, 1, 1, 1, 1]);
  });

  it("keeps the backing track past the original's end", () => {
    const [mixed] = mixGaps(backing, [new Float32Array(5).fill(3)], 1, [{ start: 7, end: 10 }], 1);

    expect([...mixed]).toEqual(Array(10).fill(1));
  });

  it("mixes a mono original into each channel of a stereo backing track", () => {
    const stereo = [new Float32Array(4).fill(1), new Float32Array(4).fill(-1)];
    const mixed = mixGaps(stereo, [new Float32Array(4).fill(3)], 1, [{ start: 0, end: 4 }], 0);

    expect(mixed.map((channel) => [...channel])).toEqual([
      [3, 3, 3, 3],
      [3, 3, 3, 3],
    ]);
  });

  it("scales the backing track, and blends the original in as it is", () => {
    const [mixed] = mixGaps(
      [new Float32Array(10).fill(0.25)],
      original,
      1,
      [{ start: 6, end: 10 }],
      0,
      { gain: 2 },
    );

    expect([...mixed]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3, 3, 3, 3]);
  });

  it("splits the gain between the two tracks by the balance", () => {
    const quiet = [new Float32Array(10).fill(0.25)];
    const loud = [new Float32Array(10).fill(1)];
    const gaps = [{ start: 6, end: 10 }];

    expect([...mixGaps(quiet, loud, 1, gaps, 0, { gain: 2, balance: 0 })[0]]).toEqual([
      0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5,
    ]);
    expect([...mixGaps(quiet, loud, 1, gaps, 0, { gain: 4, balance: 0.5 })[0]]).toEqual([
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    ]);
  });

  it("limits the original when the balance raises it", () => {
    const loud = [Float32Array.from({ length: 1000 }, (_, i) => 0.8 * Math.sin(i / 5))];

    const [mixed] = mixGaps(loud, loud, 1000, [{ start: 0, end: 1 }], 0, {
      gain: 0.5,
      balance: 0,
    });

    expect(Math.max(...mixed.map(Math.abs))).toBeLessThanOrEqual(10 ** (-0.5 / 20) + 1e-6);
    expect(Math.max(...mixed.map(Math.abs))).toBeGreaterThan(0.9);
  });

  it("leaves the backing track's own samples alone", () => {
    mixGaps(backing, original, 1, [{ start: 0, end: 10 }], 0);

    expect([...backing[0]]).toEqual(Array(10).fill(1));
  });
});

describe("gapGain", () => {
  const tone = (length: number, scale: number) =>
    Float32Array.from({ length }, (_, i) => scale * Math.sin(i / 3));

  it("finds the scale from the backing track to the original over the gaps", () => {
    const backing = [tone(100, 0.5)];
    const original = [tone(100, 0.8)];
    original[0].fill(0, 50);

    expect(gapGain(backing, original, 10, [{ start: 0, end: 5 }])).toBeCloseTo(1.6);
  });

  it("ignores a sound the separation removed, which doesn't follow the backing track", () => {
    const backing = [tone(100, 0.5)];
    const original = [Float32Array.from(tone(100, 0.8), (x, i) => x + 0.3 * Math.sin(i / 0.7))];

    expect(gapGain(backing, original, 10, [{ start: 0, end: 10 }])).toBeCloseTo(1.6, 1);
  });

  it("leaves the level alone when the tracks don't line up, or there is no gap", () => {
    const backing = [tone(100, 0.5)];
    const original = [Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 0.7))];

    expect(gapGain(backing, original, 10, [{ start: 0, end: 10 }])).toBe(1);
    expect(gapGain(backing, [tone(100, 0.8)], 10, [])).toBe(1);
  });
});

describe("limitPeaks", () => {
  it("keeps every peak under the ceiling, with a gain that never steps", () => {
    const samples = Float32Array.from({ length: 4000 }, (_, i) => 0.5 * Math.sin(i / 5));
    samples[2000] = 1.6;
    const before = Float32Array.from(samples);

    limitPeaks([samples], 1000, 0.9);

    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.9 + 1e-6);
    const gains = [...samples].map((x, i) => (before[i] === 0 ? 1 : x / before[i]));
    const steps = gains.slice(1).map((gain, i) => Math.abs(gain - gains[i]));
    expect(Math.max(...steps)).toBeLessThan(0.15);
    // Well before the peak and well after its release, the samples are as they were.
    expect(samples.slice(0, 1900)).toEqual(before.slice(0, 1900));
    expect(samples[3999]).toBeCloseTo(before[3999], 3);
  });

  it("leaves samples under the ceiling alone", () => {
    const samples = Float32Array.from([0.1, -0.5, 0.8]);

    limitPeaks([samples], 1000, 0.9);

    expect([...samples]).toEqual([...Float32Array.from([0.1, -0.5, 0.8])]);
  });
});

describe("gapDifference", () => {
  it("measures the loudest window of the difference, in dBFS", () => {
    const backing = [new Float32Array(200)];
    const original = [new Float32Array(200)];
    original[0].fill(0.1, 100, 200);

    expect(gapDifference(backing, original, 100, { start: 0, end: 2 })).toBeCloseTo(-20);
    expect(gapDifference(backing, original, 100, { start: 0, end: 1 })).toBe(-Infinity);
  });
});
