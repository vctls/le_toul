import { describe, it, expect } from "vitest";
import { parseAnnotatedLyrics, DEFAULT_VOICE_ID } from "./voices";

describe("parseAnnotatedLyrics", () => {
  it("returns a single default voice with verbatim text when there are no tags", () => {
    const text = "Line one\nLine two\n\nLine three";
    const result = parseAnnotatedLyrics(text);
    expect(result.voices).toEqual([DEFAULT_VOICE_ID]);
    // Verbatim so the single-voice pipeline (and its ASS output) is unchanged.
    expect(result.lyricTextByVoice[DEFAULT_VOICE_ID]).toBe(text);
  });

  it("returns no voices for empty text", () => {
    expect(parseAnnotatedLyrics("")).toEqual({ voices: [], lyricTextByVoice: {} });
  });

  it("splits alternating voices, sticky within a voice", () => {
    const result = parseAnnotatedLyrics(
      "[Anna] a1\n" +
      "a2\n" +            // sticky: still Anna
      "[Ben] b1\n" +
      "[Anna] a3"
    );
    expect(result.voices).toEqual(["Anna", "Ben"]);
    expect(result.lyricTextByVoice["Anna"]).toBe("a1\na2\na3");
    expect(result.lyricTextByVoice["Ben"]).toBe("b1");
  });

  it("treats a tag-only line as a sticky voice switch with no content", () => {
    const result = parseAnnotatedLyrics("[Anna]\nl1\nl2");
    expect(result.voices).toEqual(["Anna"]);
    expect(result.lyricTextByVoice["Anna"]).toBe("l1\nl2");
  });

  it("duplicates a `+` line into each member voice", () => {
    const result = parseAnnotatedLyrics(
      "[Anna] solo\n" +
      "[Anna+Ben] together\n" +
      "[Ben] other"
    );
    expect(result.voices).toEqual(["Anna", "Ben"]);
    expect(result.lyricTextByVoice["Anna"]).toBe("solo\ntogether");
    expect(result.lyricTextByVoice["Ben"]).toBe("together\nother");
  });

  it("accepts arbitrary strings (including spaces) as voice names", () => {
    const result = parseAnnotatedLyrics("[lead vocal] x\n[backing] y");
    expect(result.voices).toEqual(["lead vocal", "backing"]);
    expect(result.lyricTextByVoice["lead vocal"]).toBe("x");
    expect(result.lyricTextByVoice["backing"]).toBe("y");
  });

  it("preserves a screen break within a voice's own lines", () => {
    const result = parseAnnotatedLyrics("[Anna] a1\n\na2");
    expect(result.lyricTextByVoice["Anna"]).toBe("a1\n\na2");
  });

  it("does not create a screen break from a blank between different voices' lines", () => {
    const result = parseAnnotatedLyrics(
      "[Anna] a1\n" +
      "[Ben] b1\n" +
      "\n" +              // blank between Ben and the next Anna line
      "[Anna] a2"
    );
    // Anna saw a blank since a1, so a2 starts a new screen for Anna...
    expect(result.lyricTextByVoice["Anna"]).toBe("a1\n\na2");
    // ...but Ben, with a single line, has no internal break.
    expect(result.lyricTextByVoice["Ben"]).toBe("b1");
  });

  it("preserves intra-line markup (_ and /) in each voice's text", () => {
    const result = parseAnnotatedLyrics("[Anna] ba/by_blue");
    expect(result.lyricTextByVoice["Anna"]).toBe("ba/by_blue");
  });

  it("surfaces a default voice for untagged content that precedes tags", () => {
    const result = parseAnnotatedLyrics("intro line\n[Anna] a1");
    expect(result.voices).toEqual([DEFAULT_VOICE_ID, "Anna"]);
    expect(result.lyricTextByVoice[DEFAULT_VOICE_ID]).toBe("intro line");
    expect(result.lyricTextByVoice["Anna"]).toBe("a1");
  });

  it("ignores leading whitespace before a tag", () => {
    const result = parseAnnotatedLyrics("  [Anna] a1");
    expect(result.voices).toEqual(["Anna"]);
    expect(result.lyricTextByVoice["Anna"]).toBe("a1");
  });
});
