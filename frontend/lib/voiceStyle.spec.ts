import { describe, it, expect } from "vitest";
import { applyVoiceStyle, isEmptyOverride } from "./voiceStyle";
import { DEFAULT_KARAOKE_OPTIONS } from "./timing";
import { default as BuefyColor } from "buefy/src/utils/color";

describe("isEmptyOverride", () => {
  it("treats undefined, {} and all-undefined as empty", () => {
    expect(isEmptyOverride(undefined)).toBe(true);
    expect(isEmptyOverride({})).toBe(true);
    expect(isEmptyOverride({ fontName: undefined })).toBe(true);
  });

  it("is non-empty when any field is set, including falsey values", () => {
    expect(isEmptyOverride({ bold: false })).toBe(false);
    expect(isEmptyOverride({ fontSize: 0 })).toBe(false);
  });
});

describe("applyVoiceStyle", () => {
  it("returns the base unchanged when the override is empty", () => {
    expect(applyVoiceStyle(DEFAULT_KARAOKE_OPTIONS, undefined)).toBe(DEFAULT_KARAOKE_OPTIONS);
    expect(applyVoiceStyle(DEFAULT_KARAOKE_OPTIONS, {})).toBe(DEFAULT_KARAOKE_OPTIONS);
  });

  it("merges set fields over the base and leaves the rest", () => {
    const red = BuefyColor.parse("#ff0000");
    const result = applyVoiceStyle(DEFAULT_KARAOKE_OPTIONS, {
      fontName: "Impact",
      bold: false,
      primary: red,
    });

    expect(result.font.name).toBe("Impact");
    expect(result.font.size).toBe(DEFAULT_KARAOKE_OPTIONS.font.size); // untouched
    expect(result.font.bold).toBe(false);
    expect(result.color.primary).toBe(red);
    expect(result.color.secondary).toBe(DEFAULT_KARAOKE_OPTIONS.color.secondary); // untouched
    // Shared options (count-ins, alignment, ...) are preserved.
    expect(result.addCountIns).toBe(DEFAULT_KARAOKE_OPTIONS.addCountIns);
  });

  it("maps `outline` to the background/outline color", () => {
    const blue = BuefyColor.parse("#0000ff");
    const result = applyVoiceStyle(DEFAULT_KARAOKE_OPTIONS, { outline: blue });
    expect(result.color.background).toBe(blue);
  });

  it("does not mutate the base options", () => {
    const originalName = DEFAULT_KARAOKE_OPTIONS.font.name;
    applyVoiceStyle(DEFAULT_KARAOKE_OPTIONS, { fontName: "Impact" });
    expect(DEFAULT_KARAOKE_OPTIONS.font.name).toBe(originalName);
  });
});
