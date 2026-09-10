import { describe, it, expect } from "vitest";
import { clampGroupShift, ShiftBounds } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";

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
        expect(clampGroupShift({ first, last: first, prev: region(5, 10, true) }, -10, DURATION)).toBe(-5);
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
