import { describe, it, expect } from "vitest";
import {
  HistoryState,
  applyStatePatch,
  applyTextPatch,
  diffStates,
  diffText,
  hashState,
  historyStepFor,
} from "./history";

const state = (
  lyricText: string,
  segments: HistoryState["segments"],
  baseline = segments,
): HistoryState => ({ lyricText, segments, baseline });

describe("diffText", () => {
  it("keeps only the span that differs", () => {
    expect(diffText("one_two_three", "one_too_three")).toEqual({
      start: 5,
      removed: "w",
      inserted: "o",
    });
  });

  it("round-trips through applyTextPatch", () => {
    for (const [from, to] of [
      ["", "hello"],
      ["hello", ""],
      ["abcabc", "abc"],
      ["one\ntwo", "one\n\ntwo"],
    ]) {
      expect(applyTextPatch(from, diffText(from, to)!)).toBe(to);
    }
  });

  it("is undefined for equal texts", () => {
    expect(diffText("same", "same")).toBeUndefined();
  });
});

describe("diffStates", () => {
  it("turns one state into the other, voices added and removed included", () => {
    const from = state("[A] one", { A: [{ text: "one", start: 1 }], B: [{ text: "x" }] });
    const to = state(
      "[A] one_two\n[C] three",
      { A: [{ text: "one_", start: 1 }, { text: "two" }], C: [{ text: "three", start: 3 }] },
      { A: [{ text: "one", start: 1 }] },
    );

    expect(applyStatePatch(from, diffStates(from, to))).toEqual(to);
    expect(applyStatePatch(to, diffStates(to, from))).toEqual(from);
  });

  it("holds only the segments that changed", () => {
    const from = state("a_b", {
      A: [
        { text: "a_", start: 1 },
        { text: "b", start: 2 },
      ],
    });
    const to = state("a_b", {
      A: [
        { text: "a_", start: 1 },
        { text: "b", start: 2.5 },
      ],
    });

    expect(diffStates(from, to).segments).toEqual({
      A: { length: 2, changes: { 1: { text: "b", start: 2.5 } } },
    });
  });
});

describe("hashState", () => {
  it("ignores field order and voice order", () => {
    const a = state("x", { A: [{ text: "x", start: 1 }], B: [] });
    const b = state("x", { B: [], A: [{ start: 1, text: "x", end: undefined }] });

    expect(hashState(a)).toBe(hashState(b));
  });

  it("tells a changed timing apart", () => {
    expect(hashState(state("x", { A: [{ text: "x", start: 1 }] }))).not.toBe(
      hashState(state("x", { A: [{ text: "x", start: 1.01 }] })),
    );
  });
});

describe("historyStepFor", () => {
  const key = (key: string, init: KeyboardEventInit = {}) =>
    historyStepFor(new KeyboardEvent("keydown", { key, ctrlKey: true, ...init }));

  it("reads Ctrl+Z as undo, and Ctrl+Shift+Z and Ctrl+Y as redo", () => {
    expect(key("z")).toBe("undo");
    expect(key("Z", { shiftKey: true })).toBe("redo");
    expect(key("y")).toBe("redo");
    expect(key("z", { ctrlKey: false })).toBeNull();
    expect(key("z", { altKey: true })).toBeNull();
  });
});
