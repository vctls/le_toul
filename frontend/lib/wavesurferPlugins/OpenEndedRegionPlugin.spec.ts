import { describe, it, expect } from "vitest";
import RegionsPlugin, {
  clampGroupShift,
  ShiftBounds,
} from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";

function region(start: number, end: number, isOpenEnded = false): ShiftBounds {
  return { start, end, isOpenEnded };
}

const DURATION = 100;

describe("clampGroupShift", () => {
  it("passes a shift through when nothing is in the way", () => {
    const bounds = {
      first: region(10, 12),
      last: region(20, 22),
      prev: region(1, 2),
      next: region(40, 42),
    };
    expect(clampGroupShift(bounds, 5, DURATION)).toBe(5);
    expect(clampGroupShift(bounds, -5, DURATION)).toBe(-5);
  });

  it("stops the leading edge at the end of a closed previous region", () => {
    const first = region(10, 12);
    expect(clampGroupShift({ first, last: first, prev: region(5, 8) }, -10, DURATION)).toBe(-2);
  });

  it("lets an open-ended previous region shrink all the way to its start", () => {
    const first = region(10, 12);
    expect(clampGroupShift({ first, last: first, prev: region(5, 10, true) }, -10, DURATION)).toBe(
      -5,
    );
  });

  it("stops the trailing edge at the start of the next region", () => {
    const last = region(20, 22);
    expect(clampGroupShift({ first: last, last, next: region(25, 27) }, 10, DURATION)).toBe(3);
  });

  it("measures an open-ended trailing region from its start, since its end gives way", () => {
    const last = region(20, 25, true);
    expect(clampGroupShift({ first: last, last, next: region(25, 27) }, 10, DURATION)).toBe(5);
  });

  it("falls back to the track bounds with no neighbours", () => {
    const only = region(10, 12);
    expect(clampGroupShift({ first: only, last: only }, -20, DURATION)).toBe(-10);
    expect(clampGroupShift({ first: only, last: only }, 200, DURATION)).toBe(DURATION - 12);
  });

  it("refuses to move at all when the selection is already wedged", () => {
    const bounds = {
      first: region(10, 12),
      last: region(20, 22),
      prev: region(5, 10),
      next: region(22, 24),
    };
    expect(clampGroupShift(bounds, -1, DURATION)).toBeCloseTo(0);
    expect(clampGroupShift(bounds, 1, DURATION)).toBeCloseTo(0);
  });
});

describe("regions to review", () => {
  /**
   * A plugin on a stand-in for wavesurfer, whose wrapper is the track the regions are drawn in.
   */
  function setUp() {
    const wrapper = document.createElement("div");
    const wavesurfer = {
      getWrapper: () => wrapper,
      getDuration: () => DURATION,
      getScroll: () => 0,
      getWidth: () => 1000,
      on: () => () => {},
      once: () => () => {},
    };
    const plugin = RegionsPlugin.create();
    (plugin as unknown as { _init(ws: unknown): void })._init(wavesurfer);
    const markers = () => [...wrapper.querySelectorAll<HTMLElement>('[part="review-marker"]')];
    return { plugin, markers };
  }

  it("draws a flagged region in its colour, at least 6 pixels wide, with a marker line", () => {
    const { plugin, markers } = setUp();

    const region = plugin.addRegion({ id: "a", start: 10, end: 10.01, review: "lost" });

    expect(region.element.style.backgroundColor).toBe("var(--region-review-lost)");
    expect(region.element.style.minWidth).toBe("6px");
    expect(region.element.title).toBe("Lost its timing in a lyric edit");
    expect(markers()).toHaveLength(1);
    expect(markers()[0].style.left).toBe("10%");
    expect(markers()[0].style.backgroundColor).toBe("var(--region-review-lost)");
  });

  it("draws nothing extra for a region without a flag", () => {
    const { plugin, markers } = setUp();

    const region = plugin.addRegion({ id: "a", start: 10, end: 11, color: "blue" });

    expect(region.element.style.minWidth).toBe("");
    expect(region.element.title).toBe("");
    expect(markers()).toHaveLength(0);
  });

  it("moves the marker line with its region, and removes it with the flag", () => {
    const { plugin, markers } = setUp();
    plugin.addRegion({ id: "a", start: 10, end: 11, review: "moved" });

    plugin.syncRegions([{ id: "a", start: 20, end: 21, review: "moved" }]);
    expect(markers()[0].style.left).toBe("20%");

    plugin.syncRegions([{ id: "a", start: 20, end: 21 }]);
    expect(markers()).toHaveLength(0);
  });

  it("removes the marker line with its region", () => {
    const { plugin, markers } = setUp();
    plugin.addRegion({ id: "a", start: 10, end: 11, review: "moved" });

    plugin.syncRegions([]);

    expect(markers()).toHaveLength(0);
  });

  it("repaints a region that was a marker while its neighbour moved", () => {
    const { plugin } = setUp();
    const first = plugin.addRegion({ id: "a", start: 10, color: "blue", review: "moved" });
    plugin.addRegion({ id: "b", start: 20, color: "blue", review: "moved" });

    // "a" takes the start "b" had, so it is a marker until "b" moves on.
    plugin.syncRegions([
      { id: "a", start: 20, color: "blue" },
      { id: "b", start: 30, color: "blue" },
    ]);

    expect(first.element.style.backgroundColor).toBe("blue");
  });

  it("selects a region by id, even one added later", () => {
    const { plugin } = setUp();
    const selections: string[][] = [];
    plugin.on("selection-change", (ids) => selections.push(ids));

    plugin.selectRegion("b");
    const region = plugin.addRegion({ id: "b", start: 10, end: 11 });

    expect(region.selected).toBe(true);
    expect(selections).toEqual([["b"]]);
  });
});
