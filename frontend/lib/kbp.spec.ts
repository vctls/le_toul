import { readFileSync } from "node:fs";
import path from "node:path";
import { KBP_DIVIDER, parseKbp, serializeKbp } from "./kbp";

const FIXTURE = readFileSync(path.resolve(__dirname, "../../tests/fixtures/song.kbp"), "utf8");

// The fixture's header, up to and including the track information, for building other files.
const HEADER = FIXTURE.slice(0, FIXTURE.indexOf(`${KBP_DIVIDER}\r\nPAGEV2`));

function withPages(...pages: string[][]): string {
  return HEADER + pages.map((lines) => [KBP_DIVIDER, "PAGEV2", ...lines, ""].join("\r\n")).join("");
}

describe("parseKbp", () => {
  test("reads the header, track information and pages", () => {
    const document = parseKbp(FIXTURE);

    expect(document.palette).toHaveLength(16);
    expect(document.palette[0]).toBe("055");
    expect(document.styles.map((s) => s.name)).toEqual(["Default", "Male", "Female", "Other"]);
    expect(document.styles[3]).toEqual({
      number: 3,
      name: "Other",
      colors: [4, 8, 12, 14],
      fontName: "Arial",
      fontSize: 12,
      fontStyle: "B",
      charset: 0,
      outlines: [2, 2, 2, 2],
      shadows: [0, 0],
      wipeStyle: 0,
      uppercase: false,
    });
    expect(document.margins).toEqual([2, 2, 7, 12]);
    expect(document.other).toEqual([0, 2]);
    expect(document.trackInfo).toEqual({
      Status: "1",
      Title: "Pale Moon",
      Artist: "The Placeholders",
      Audio: "C:\\Users\\Someone\\Karaoke\\The Placeholders - Pale Moon.flac",
      BuildFile: "",
      Intro: "",
      Outro: "",
      Comments: "Made up for tests\nwith a second line",
    });

    expect(document.pages).toHaveLength(2);
    const [line] = document.pages[1].lines;
    expect(line).toMatchObject({ align: "C", style: "A", start: 1613, end: 2082 });
    expect(line.syllables[1]).toEqual({ text: "der ", start: 1927, end: 1945, wipe: 0 });
    expect(document.unsyncedLyrics).toBeNull();
  });

  test("reads an escaped slash in either spelling", () => {
    const document = parseKbp(
      withPages(["C/A/0/100/0/0/0", "a{-}b/          10/20/0", "c{~}d/          20/30/0"]),
    );

    expect(document.pages[0].lines[0].syllables.map((s) => s.text)).toEqual(["a/b", "c/d"]);
  });

  test("reads a page transition and the sections after the pages", () => {
    const text =
      withPages(["FX/F/", "C/A/0/100/0/0/0", "a/             10/20/0"]) +
      [
        KBP_DIVIDER,
        "IMAGE",
        "0/1000/background.png/0",
        "",
        KBP_DIVIDER,
        "MODS",
        "0/0/1/-1000",
        "",
      ].join("\r\n");
    const document = parseKbp(text);

    expect(document.pages[0].transition).toBe("F/");
    expect(document.images).toEqual(["0/1000/background.png/0"]);
    expect(document.mods).toBe("0/0/1/-1000");
  });

  test("repairs a syllable line split in two", () => {
    const document = parseKbp(
      withPages(["C/A/0/100/0/0/0", "Foo", "/     10/20/0", "bar/           20/30/0"]),
    );

    expect(document.pages[0].lines[0].syllables).toEqual([
      { text: "Foo", start: 10, end: 20, wipe: 0 },
      { text: "bar", start: 20, end: 30, wipe: 0 },
    ]);
  });

  test("repairs a split syllable that KBS saved back with zeroed times", () => {
    const document = parseKbp(
      withPages(["C/A/0/100/0/0/0", "Foo/      0/0/0", "/         10/20/0"]),
    );

    expect(document.pages[0].lines[0].syllables).toEqual([
      { text: "Foo", start: 10, end: 20, wipe: 0 },
    ]);
  });

  test("keeps syllables after a stray blank line in their line", () => {
    const document = parseKbp(
      withPages(["C/A/0/100/0/0/0", "", "a/             10/20/0", "b/             20/30/0"]),
    );

    expect(document.pages[0].lines).toHaveLength(1);
    expect(document.pages[0].lines[0].syllables).toHaveLength(2);
  });

  test("reads the lyrics of an unsynced project", () => {
    const text =
      HEADER.replace("Status    1", "Status    0") +
      [KBP_DIVIDER, "LYRICSV2", "Pale moon ri/sing", "", "Wan/der"].join("\r\n");

    expect(parseKbp(text).unsyncedLyrics).toEqual(["Pale moon ri/sing", "", "Wan/der"]);
  });

  test("reads a file with LF line endings or a byte order mark", () => {
    expect(parseKbp("\uFEFF" + FIXTURE.replace(/\r\n/g, "\n")).pages).toHaveLength(2);
  });

  test("throws on a file that isn't a KBS project", () => {
    expect(() => parseKbp("[Script Info]\nTitle: nope\n")).toThrow(/Karaoke Builder Studio/);
    expect(() => parseKbp(withPages(["C/A/0/100/0/0/0", "not a syllable"]))).toThrow(/page 1/);
  });
});

describe("serializeKbp", () => {
  test("writes a file back exactly as KBS wrote it", () => {
    expect(serializeKbp(parseKbp(FIXTURE))).toBe(FIXTURE);
  });

  test("writes an unsynced project exactly as KBS wrote it", () => {
    const text =
      HEADER.replace("Status    1", "Status    0") +
      [KBP_DIVIDER, "LYRICSV2", "Pale moon ri/sing", "", "Wan/der"].join("\r\n");

    expect(serializeKbp(parseKbp(text))).toBe(text);
  });

  test("escapes a slash in syllable text", () => {
    const document = parseKbp(withPages(["C/A/0/100/0/0/0", "a/             10/20/0"]));
    document.pages[0].lines[0].syllables[0].text = "a/b";

    expect(serializeKbp(document)).toContain("\r\na{-}b/         10/20/0\r\n");
  });
});
