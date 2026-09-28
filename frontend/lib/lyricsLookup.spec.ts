import { describe, expect, it } from "vitest";
import { convertFetchedLyrics, formatDuration } from "./lyricsLookup";

describe("convertFetchedLyrics", () => {
  it("keeps lines and single blank lines between stanzas", () => {
    expect(convertFetchedLyrics("Vel oma trin\nSossa lein\n\nPrel dova")).toBe(
      "Vel oma trin\nSossa lein\n\nPrel dova",
    );
  });

  it("normalizes line endings and trims trailing spaces", () => {
    expect(convertFetchedLyrics("Vel oma trin  \r\nSossa lein\rPrel")).toBe(
      "Vel oma trin\nSossa lein\nPrel",
    );
  });

  it("collapses runs of blank lines and drops them at both ends", () => {
    expect(convertFetchedLyrics("\n \nVel oma\n\n  \n\nSossa lein\n\n")).toBe(
      "Vel oma\n\nSossa lein",
    );
  });

  it("drops lines that only hold a section label", () => {
    expect(convertFetchedLyrics("[Verse 1]\nVel oma\n\n [Chorus] \nSossa lein")).toBe(
      "Vel oma\n\nSossa lein",
    );
  });

  it("keeps a bracket inside a line", () => {
    expect(convertFetchedLyrics("Vel [oma] trin")).toBe("Vel [oma] trin");
  });

  it("replaces the markup characters with spaces", () => {
    expect(convertFetchedLyrics("Vel/oma trin_sossa")).toBe("Vel oma trin sossa");
  });
});

describe("formatDuration", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatDuration(232.4)).toBe("3:52");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(59.6)).toBe("1:00");
  });
});
