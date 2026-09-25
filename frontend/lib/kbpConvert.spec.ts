import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { KBP_DIVIDER, parseKbp } from "./kbp";
import { kbpToProjectFiles, projectFilesToKbp, ProjectFiles } from "./kbpConvert";
import { parseSettingsYaml } from "./settingsFile";
import { TimingsFile, TIMINGS_FILE_VERSION } from "./timedSegments";

const FIXTURE = readFileSync(path.resolve(__dirname, "../../tests/fixtures/song.kbp"), "utf8");
const HEADER = FIXTURE.slice(0, FIXTURE.indexOf(`${KBP_DIVIDER}\r\nPAGEV2`));
const FONTS = ["Arial", "Georgia"];

function withPages(header: string, ...pages: string[][]): string {
  return header + pages.map((lines) => [KBP_DIVIDER, "PAGEV2", ...lines, ""].join("\r\n")).join("");
}

function settingsFile(
  extra: {
    duration?: number;
    voiceStyles?: Record<string, unknown>;
    font?: Record<string, unknown>;
  } = {},
): string {
  return yaml.dump({
    song: { title: "Pale Moon", artist: "The Placeholders", duration: extra.duration ?? 60 },
    videoOptions: {
      font: { name: "Georgia", size: 28, ...extra.font },
      color: { background: "#123456", primary: "#FF00FF", secondary: "#00FFFF" },
    },
    ...(extra.voiceStyles ? { voiceStyles: extra.voiceStyles } : {}),
  });
}

function timingsFile(voices: TimingsFile["voices"]): TimingsFile {
  return { version: TIMINGS_FILE_VERSION, voices };
}

describe("kbpToProjectFiles", () => {
  test("turns a single-style project into lyrics, timings and settings", () => {
    const result = kbpToProjectFiles(FIXTURE, { fonts: FONTS });

    expect(result.lyrics).toBe(
      [
        "Pale_moon_ri/sing_slow",
        "o/ver_the_qui/et_hill",
        "Lan/terns_glow",
        "",
        "Wan/der_a/way",
        "Home_a/gain",
      ].join("\n"),
    );
    // An end at the next start, or 1 cs before it, is left open. Any other end is a release.
    expect(result.timings).toEqual(
      timingsFile({
        "Voice 1": [
          { text: "Pale_", start: 4.2 },
          { text: "moon_", start: 4.39 },
          { text: "ri/", start: 4.61 },
          { text: "sing_", start: 4.99 },
          { text: "slow\n", start: 5.25, end: 5.88 },
          { text: "o/", start: 6.45 },
          { text: "ver_", start: 6.69 },
          { text: "the_", start: 6.81 },
          { text: "qui/", start: 7.07 },
          { text: "et_", start: 7.27 },
          { text: "hill\n", start: 7.71, end: 8.34 },
          { text: "Lan/", start: 9.23 },
          { text: "terns_", start: 9.45, end: 9.65 },
          { text: "glow\n\n", start: 10.37, end: 10.65 },
          { text: "Wan/", start: 19.13 },
          { text: "der_", start: 19.27 },
          { text: "a/", start: 19.45 },
          { text: "way\n", start: 19.64, end: 20.32 },
          { text: "Home_", start: 20.83 },
          { text: "a/", start: 21.13 },
          { text: "gain", start: 21.33, end: 21.55 },
        ],
      }),
    );
    expect(result.audioName).toBe("The Placeholders - Pale Moon.flac");
    expect(result.warnings).toEqual([
      'A lead-in syllable "➣➣➣" was dropped, since the app draws its own count-ins',
    ]);

    const settings = parseSettingsYaml(result.settings);
    expect(settings.warnings).toEqual([]);
    expect(settings.song).toEqual({ title: "Pale Moon", artist: "The Placeholders" });
    expect(settings.videoOptions.font).toEqual({
      name: "Arial",
      size: 22,
      bold: true,
      italic: false,
    });
    expect(settings.videoOptions.color?.background.toString()).toBe("#005555");
    expect(settings.videoOptions.color?.primary.toString()).toBe("#ee7700");
    expect(settings.videoOptions.color?.secondary.toString()).toBe("#ffffff");
    // Present though empty, so loading it drops the overrides already there.
    expect(settings.voiceStyles).toEqual({});
  });

  test("makes a voice of each style in use", () => {
    const header = HEADER.replace("Style01,Male", "Style01,Lead+Harmony").replace(
      "Style02,Female",
      "Style02,Lead+Harmony",
    );
    const text = withPages(
      header,
      [
        "C/B/0/100/0/0/0",
        "Hi/            10/20/0",
        "",
        "C/C/0/100/0/0/0",
        "Yo/            30/40/0",
        "",
      ],
      ["C/B/0/200/0/0/0", "Hey/           150/160/0", ""],
    );
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("[Lead Harmony] Hi\n[Lead Harmony 2] Yo\n\n[Lead Harmony] Hey");
    expect(result.timings.voices).toEqual({
      "Lead Harmony": [
        { text: "Hi\n\n", start: 0.1, end: 0.2 },
        { text: "Hey", start: 1.5, end: 1.6 },
      ],
      "Lead Harmony 2": [{ text: "Yo", start: 0.3, end: 0.4 }],
    });

    // The first style in use is the base, and the other voice keeps only what differs from it.
    const settings = parseSettingsYaml(result.settings);
    expect(settings.videoOptions.color?.secondary.toString()).toBe("#ccffff");
    expect(Object.keys(settings.voiceStyles ?? {})).toEqual(["Lead Harmony 2"]);
    const override = settings.voiceStyles?.["Lead Harmony 2"];
    expect(override?.secondary?.toString()).toBe("#ffccff");
    expect(override?.primary?.toString()).toBe("#ff33ff");
    expect(override?.outline?.toString()).toBe("#330033");
    expect(override?.fontSize).toBeUndefined();
  });

  test("drops or repairs what the app can't hold, and says so", () => {
    const header = HEADER.replace(
      "    2,2,2,2,0,0,0,L\r\n\r\n  Style01",
      "    2,2,2,2,0,0,0,U\r\n\r\n  Style01",
    );
    const text = withPages(header, [
      "FX/F/",
      "L/A/0/100/5/0/0",
      "[aside]/       10/20/0",
      "",
      "C/A/0/100/0/0/0",
      "/              0/0/0",
      "",
      "C/a/0/100/0/0/0",
      "fixed /        0/0/0",
      "text/          0/0/0",
      "",
      "C/Z/0/100/0/0/0",
      "and{-}or /     30/40/0",
      "snake_case/    40/50/0",
      "",
    ]);
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("ASIDE\nFIXED_TEXT\nANDOR_SNAKECASE");
    expect(result.timings.voices["Voice 1"]).toEqual([
      { text: "ASIDE\n", start: 0.1, end: 0.2 },
      { text: "FIXED_" },
      { text: "TEXT\n" },
      { text: "ANDOR_", start: 0.3 },
      { text: "SNAKECASE", start: 0.4, end: 0.5 },
    ]);
    expect(result.warnings).toEqual([
      "Page transitions were dropped",
      "Line positions were dropped, since the app lays out its own screens",
      "Lines in an undefined style Z use Style00",
      "Square brackets starting a line were removed, since they would read as a voice tag",
      "A blank spacer line was dropped",
      "A fixed line was imported untimed, since the app has no text without a wipe",
      "A / or _ in the lyrics was removed, since the app uses both as markup (×2)",
    ]);
  });

  test("leaves out a font the app doesn't bundle", () => {
    const result = kbpToProjectFiles(FIXTURE, { fonts: ["Georgia"] });

    expect(parseSettingsYaml(result.settings).videoOptions.font).toEqual({
      size: 22,
      bold: true,
      italic: false,
    });
    expect(result.warnings).toContain(
      `The font "Arial" isn't bundled with the app, so it was left out`,
    );
  });

  test("turns an unsynced project into lyrics with no timings", () => {
    const text =
      HEADER.replace("Status    1", "Status    0") +
      [KBP_DIVIDER, "LYRICSV2", "Pale moon ri/sing ", "o/ver the hill", "", "Wan/der a/way"].join(
        "\r\n",
      );
    const result = kbpToProjectFiles(text, { fonts: FONTS });

    expect(result.lyrics).toBe("Pale_moon_ri/sing\no/ver_the_hill\n\nWan/der_a/way");
    expect(result.timings).toEqual(timingsFile({}));
  });
});

describe("projectFilesToKbp", () => {
  const single: ProjectFiles = {
    lyrics: "Pale_moon\nri/sing\n\nslow",
    timings: timingsFile({
      "Voice 1": [
        { text: "Pale_", start: 5 },
        { text: "moon\n", start: 5.5, end: 6 },
        { text: "ri/", start: 7 },
        { text: "sing\n\n", start: 7.25 },
        { text: "slow", start: 30 },
      ],
    }),
    settings: settingsFile({ duration: 31.5 }),
  };

  test("writes pages, lines and syllables the way KBS times them", () => {
    const result = projectFilesToKbp({ ...single, audioName: "Pale Moon.flac" });
    const document = parseKbp(result.kbp);

    expect(result.warnings).toEqual([]);
    expect(document.trackInfo).toMatchObject({
      Status: "1",
      Title: "Pale Moon",
      Artist: "The Placeholders",
      Audio: "Pale Moon.flac",
    });
    expect(
      document.pages.map((page) => page.lines.map((line) => [line.style, line.start, line.end])),
    ).toEqual([
      [
        ["A", 200, 650],
        ["A", 200, 2999 + 50],
      ],
      // 3 s ahead of the page, the first slot's previous line having gone long before.
      [["A", 2700, 3150 + 50]],
    ]);
    expect(document.pages.flatMap((page) => page.lines.flatMap((line) => line.syllables))).toEqual([
      { text: "Pale ", start: 500, end: 549, wipe: 0 },
      { text: "moon", start: 550, end: 600, wipe: 0 },
      { text: "ri", start: 700, end: 724, wipe: 0 },
      { text: "sing", start: 725, end: 2999, wipe: 0 },
      // The last open end runs to the end of the song.
      { text: "slow", start: 3000, end: 3150, wipe: 0 },
    ]);
  });

  test("never shows a line after its own first syllable", () => {
    const result = projectFilesToKbp({
      lyrics: "a\n\nb",
      timings: timingsFile({
        "Voice 1": [
          { text: "a\n\n", start: 1, end: 2 },
          { text: "b", start: 2.2 },
        ],
      }),
      settings: settingsFile(),
      audioName: null,
    });
    const [first, second] = parseKbp(result.kbp).pages.map((page) => page.lines[0]);

    expect(first.end).toBe(250);
    expect(second.start).toBe(220);
  });

  test("writes the base font's bold and italic, which voices inherit", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] la\n[Ben] hm",
      timings: timingsFile({ Anna: [{ text: "la", start: 1 }], Ben: [{ text: "hm", start: 2 }] }),
      settings: settingsFile({
        font: { bold: false, italic: true },
        voiceStyles: { Ben: { bold: true } },
      }),
      audioName: null,
    });

    expect(parseKbp(result.kbp).styles.map((s) => s.fontStyle)).toEqual(["I", "BI"]);
  });

  test("writes the lyrics alone when nothing is timed", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] Pale_moon\n[Ben] ri/sing",
      timings: timingsFile({}),
      settings: settingsFile(),
      audioName: null,
    });
    const document = parseKbp(result.kbp);

    expect(document.trackInfo.Status).toBe("0");
    expect(document.unsyncedLyrics).toEqual(["Pale moon", "ri/sing"]);
  });

  test("gives each voice a style, and merges voices' pages that overlap", () => {
    const result = projectFilesToKbp({
      lyrics: "[Anna] la_la\n[Anna+Ben] oh\n[Ben] hm",
      timings: timingsFile({
        Anna: [
          { text: "la_", start: 1 },
          { text: "la\n", start: 1.5 },
          { text: "oh", start: 2, end: 3 },
        ],
        Ben: [
          { text: "oh\n", start: 2.1 },
          { text: "hm", start: 3, end: 4 },
        ],
      }),
      settings: settingsFile({ voiceStyles: { Ben: { primary: "#00FF00", fontName: "Arial" } } }),
      audioName: null,
    });
    const document = parseKbp(result.kbp);

    expect(document.styles.map((s) => [s.name, s.fontName, s.fontSize, s.fontStyle])).toEqual([
      ["Anna", "Georgia", 15, "B"],
      ["Ben", "Arial", 15, "B"],
    ]);
    // Entry 0 is the background, which is also every outline.
    expect(document.palette.slice(0, 4)).toEqual(["135", "0FF", "F0F", "0F0"]);
    expect(document.styles.map((s) => s.colors)).toEqual([
      [1, 0, 2, 0],
      [1, 0, 3, 0],
    ]);
    expect(document.pages).toHaveLength(1);
    expect(
      document.pages[0].lines.map((line) => [
        line.style,
        line.syllables.map((s) => s.text).join(""),
      ]),
    ).toEqual([
      ["A", "la la"],
      ["A", "oh"],
      ["B", "oh"],
      ["B", "hm"],
    ]);
  });

  test("shares out the palette's 16 entries, and says when colours had to double up", () => {
    const voices = Array.from({ length: 10 }, (_, i) => `v${i}`);
    const hex = (i: number) => `#${(i * 17).toString(16).padStart(2, "0")}0000`;
    const result = projectFilesToKbp({
      lyrics: voices.map((voice) => `[${voice}] la`).join("\n"),
      timings: timingsFile(
        Object.fromEntries(voices.map((voice, i) => [voice, [{ text: "la", start: i }]])),
      ),
      settings: settingsFile({
        voiceStyles: Object.fromEntries(
          voices.map((voice, i) => [voice, { primary: hex(i), secondary: hex(i + 10) }]),
        ),
      }),
      audioName: null,
    });

    expect(parseKbp(result.kbp).palette).toHaveLength(16);
    expect(result.warnings).toContain(
      "The styles use more than 16 colours, so some take the nearest one",
    );
  });
});

describe("round trip", () => {
  test("a KBS project comes back with the same lyrics and timings", () => {
    const imported = kbpToProjectFiles(FIXTURE, { fonts: FONTS });
    const exported = projectFilesToKbp({ ...imported, audioName: imported.audioName });
    const back = kbpToProjectFiles(exported.kbp, { fonts: FONTS });

    expect(back.lyrics).toBe(imported.lyrics);
    expect(back.timings).toEqual(imported.timings);
    expect(back.settings).toBe(imported.settings);
  });

  test("each voice of the app's project comes back with the same segments", () => {
    const project: ProjectFiles = {
      lyrics: "[Anna] la_la\n[Anna+Ben] oh\n[Ben] hm",
      timings: timingsFile({
        Anna: [
          { text: "la_", start: 1 },
          { text: "la\n", start: 1.5, end: 1.7 },
          { text: "oh", start: 2, end: 3 },
        ],
        Ben: [
          { text: "oh\n", start: 2.1 },
          { text: "hm", start: 3, end: 4 },
        ],
      }),
      settings: settingsFile(),
    };
    const back = kbpToProjectFiles(projectFilesToKbp({ ...project, audioName: null }).kbp, {
      fonts: FONTS,
    });

    expect(back.timings).toEqual(project.timings);
  });
});
