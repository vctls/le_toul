import { describe, it, expect } from "vitest";
import { shallowMount } from "@vue/test-utils";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import { TimedSegment } from "@/lib/timedSegments";
import { RegionParams } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";

/**
 * The regions the adjuster draws for `segments`, by segment index.
 */
function regionsFor(segments: TimedSegment[]) {
  const wrapper = shallowMount(TimingAdjuster, { props: { segments } });
  return Object.fromEntries(
    (wrapper.vm.regions as RegionParams[]).map(({ id, start, review }) => [
      Number(id?.split("_")[1]),
      { start, review },
    ]),
  );
}

describe("TimingAdjuster regions", () => {
  it("passes each segment's review flag to its region", () => {
    expect(
      regionsFor([
        { text: "one_", start: 1 },
        { text: "two_", review: "lost" },
        { text: "three", start: 3, review: "moved" },
      ]),
    ).toEqual({
      0: { start: 1, review: undefined },
      1: { start: 2, review: "lost" },
      2: { start: 3, review: "moved" },
    });
  });

  it("stacks lost segments before the first timed one just before its start", () => {
    const regions = regionsFor([
      { text: "one_", review: "lost" },
      { text: "two_", review: "lost" },
      { text: "three", start: 3 },
    ]);

    expect(regions[0].start).toBeCloseTo(3);
    expect(regions[0].start).toBeLessThan(3);
    expect(regions[1].start).toBe(regions[0].start);
  });

  it("stacks lost segments after the last timed one at its end", () => {
    const regions = regionsFor([
      { text: "one_", start: 1, end: 1.5 },
      { text: "two_", review: "lost" },
      { text: "three", review: "lost" },
    ]);

    expect(regions[1]).toEqual({ start: 1.5, review: "lost" });
    expect(regions[2]).toEqual({ start: 1.5, review: "lost" });
  });

  it("stacks them a second after an open-ended last segment", () => {
    const regions = regionsFor([
      { text: "one_", start: 1 },
      { text: "two", review: "lost" },
    ]);

    expect(regions[1]).toEqual({ start: 2, review: "lost" });
  });

  it("draws nothing for unflagged segments with no position, or a voice with no timing", () => {
    expect(Object.keys(regionsFor([{ text: "one_", start: 1, end: 2 }, { text: "two" }]))).toEqual([
      "0",
    ]);
    expect(regionsFor([{ text: "one", review: "lost" }])).toEqual({});
  });
});
