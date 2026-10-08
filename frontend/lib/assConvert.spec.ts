import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import {
  assToProjectFiles,
  DELAY_UNKNOWN,
  FORMATTING_DROPPED,
  RENDERED_EFFECTS,
  SCREENS_GUESSED,
  TEMPLATE_LINES_DROPPED,
  UNTIMED_LINES,
} from "./assConvert";
import { MARKUP_REMOVED } from "./importWarnings";
import { createMultiVoiceAssFile, DEFAULT_KARAOKE_OPTIONS, KaraokeOptions } from "./timing";
import { TimedSegment } from "./timedSegments";

const FONTS = ["Arial Narrow", "Georgia"];
const SONG_DURATION = 60;

function ass(
  events: string[],
  styles: string[] = ["Style: Default,Georgia,20"],
  info = "",
): string {
  return [
    "[Script Info]",
    info,
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Outline",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
  ].join("\n");
}

function roundTrip(tracks: { voice: string; segments: TimedSegment[] }[], options: KaraokeOptions) {
  const text = createMultiVoiceAssFile(
    tracks.map((track) => ({ ...track, options })),
    SONG_DURATION,
    "Pale Moon",
    "The Placeholders",
  );
  return assToProjectFiles(text, { fonts: FONTS });
}

describe("assToProjectFiles on the app's own files", () => {
  // Every line ends on a release, which the writer keeps as a gap before the next line.
  const segments: TimedSegment[] = [
    { text: "Hel/", start: 10 },
    { text: "lo_", start: 10.5 },
    { text: "moon\n", start: 11, end: 12 },
    { text: "Bright_", start: 13 },
    { text: "night\n\n", start: 13.5, end: 14.5 },
    { text: "After_", start: 30 },
    { text: "the_", start: 30.5, end: 30.8 },
    { text: "break", start: 31, end: 32 },
  ];

  it("drops the title screen, count-ins and instrumental screens", () => {
    const imported = roundTrip([{ voice: "Voice 1", segments }], DEFAULT_KARAOKE_OPTIONS);

    expect(imported.lyrics).toBe("Hel/lo_moon\nBright_night\n\nAfter_the_break");
    expect(imported.timings).toEqual({ "Voice 1": segments });
    expect(imported.warnings).toEqual([]);
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.song).toEqual({ title: "Pale Moon", artist: "The Placeholders" });
    expect(settings.videoOptions.font).toMatchObject({ name: "Arial Narrow", size: 20 });
    expect(settings.videoOptions.color).toMatchObject({ primary: "#FF00FF", secondary: "#00FFFF" });
  });

  it("moves the timings back by the delay the title screen and a quick start added", () => {
    const early = segments.map((segment) => ({
      ...segment,
      start: (segment.start as number) - 9.5,
      ...(segment.end ? { end: segment.end - 9.5 } : {}),
    }));
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments: early, options: DEFAULT_KARAOKE_OPTIONS }],
      SONG_DURATION,
      "Pale Moon",
      "The Placeholders",
    );
    expect(text).toMatch(/^Audio Delay: [1-9]/m);

    expect(assToProjectFiles(text, { fonts: FONTS }).timings).toEqual({ "Voice 1": early });
  });

  it("warns that a file older than its Audio Delay field may be late", () => {
    const text = createMultiVoiceAssFile(
      [{ voice: "Voice 1", segments, options: DEFAULT_KARAOKE_OPTIONS }],
      SONG_DURATION,
      "Pale Moon",
      "The Placeholders",
    ).replace(/^Audio Delay: .*\n/m, "");

    const imported = assToProjectFiles(text, { fonts: FONTS });
    expect(imported.warnings).toEqual([DELAY_UNKNOWN]);
    expect(imported.timings).toEqual({ "Voice 1": segments });
  });

  it("drops fixed count-ins too", () => {
    const options = { ...DEFAULT_KARAOKE_OPTIONS, dynamicCountIns: false, countInText: "♪" };
    const imported = roundTrip([{ voice: "Voice 1", segments }], options);
    expect(imported.timings).toEqual({ "Voice 1": segments });
  });

  it("reads each voice back from the actor field, with its screens", () => {
    const anna: TimedSegment[] = [
      { text: "Hello_", start: 10 },
      { text: "world\n\n", start: 10.5, end: 11 },
      { text: "Again_", start: 30 },
      { text: "now", start: 30.5, end: 31 },
    ];
    const ben: TimedSegment[] = [
      { text: "Good/", start: 11.5 },
      { text: "bye\n\n", start: 12, end: 12.5 },
      { text: "Fine", start: 31.5, end: 32 },
    ];
    const options = {
      ...DEFAULT_KARAOKE_OPTIONS,
      font: { ...DEFAULT_KARAOKE_OPTIONS.font, name: "Georgia" },
    };
    const imported = roundTrip(
      [
        { voice: "Anna", segments: anna },
        { voice: "Ben", segments: ben },
      ],
      options,
    );

    expect(imported.lyrics).toBe(
      "[Anna] Hello_world\n[Ben] Good/bye\n\n[Anna] Again_now\n[Ben] Fine",
    );
    expect(imported.timings).toEqual({ Anna: anna, Ben: ben });
  });
});

describe("assToProjectFiles on other files", () => {
  it("imports the source lines of a karaoke template, without display periods", () => {
    const imported = assToProjectFiles(
      ass(
        [
          "Comment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,template pre-line all,{\\fad(300,200)}",
          "Comment: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,karaoke,{\\k25}Hel{\\k25}lo {\\k20}{\\k30}moon",
          "Dialogue: 0,0:00:09.10,0:00:11.20,Default,,0,0,0,fx,{\\k90\\fad(300,200)}{\\k25}Hel{\\k25}lo {\\k20}{\\k30}moon",
        ],
        undefined,
        "Title: Pale Moon",
      ),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Hel/lo_moon");
    expect(imported.timings).toEqual({
      "Voice 1": [
        { text: "Hel/", start: 10 },
        { text: "lo_", start: 10.25, end: 10.5 },
        { text: "moon", start: 10.7, end: 11 },
      ],
    });
    expect(imported.warnings).toEqual([TEMPLATE_LINES_DROPPED]);
    expect((yaml.load(imported.settings) as any).song).toEqual({ title: "Pale Moon" });
  });

  it("imports the commented-out source lines an effect tool left unmarked", () => {
    const imported = assToProjectFiles(
      ass([
        'Comment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,template line,!retime("line")!{\\k90}',
        "Comment: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\k50}Pale {\\k50}moon",
        "Dialogue: 1,0:00:09.50,0:00:10.50,Default,,0,0,0,,{\\an5\\pos(100,20)}Pale",
        "Dialogue: 1,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\an5\\pos(140,20)}moon",
      ]),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Pale_moon");
    expect(imported.timings["Voice 1"]).toEqual([
      { text: "Pale_", start: 10 },
      { text: "moon", start: 10.5, end: 11 },
    ]);
    expect(imported.warnings).toEqual([TEMPLATE_LINES_DROPPED]);
  });

  it("warns when most lines look like rendered effects", () => {
    const imported = assToProjectFiles(
      ass([
        "Dialogue: 1,0:00:09.50,0:00:10.50,Default,,0,0,0,,{\\an5\\pos(100,20)}Pale",
        "Dialogue: 1,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\an5\\move(140,20,140,10)}moon",
        "Dialogue: 0,0:00:12.00,0:00:13.00,Default,,0,0,0,,{\\pos(140,20)}A whole line",
      ]),
      { fonts: FONTS },
    );
    expect(imported.warnings).toContain(RENDERED_EFFECTS);
  });

  it("makes a voice of each style, and keeps a shown line's display period", () => {
    const imported = assToProjectFiles(
      ass(
        [
          "Dialogue: 0,0:00:01.00,0:00:03.00,Lead,,0,0,0,,{\\fad(100,100)}{\\k100}{\\k50}Sun",
          "Dialogue: 0,0:00:02.00,0:00:04.00,Back,,0,0,0,,{\\k100}{\\k50}Moon",
        ],
        [
          "Style: Lead,Georgia,20,&H000000FF,&H00FFFFFF",
          "Style: Back,Comic Sans,20,&H00FF0000,&H00FFFFFF",
        ],
      ),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("[Lead] Sun\n[Back] Moon");
    expect(imported.timings).toEqual({
      Lead: [{ text: "Sun", start: 2, end: 2.5, displayStart: 1, displayEnd: 3 }],
      Back: [{ text: "Moon", start: 3, end: 3.5, displayStart: 2, displayEnd: 4 }],
    });
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.videoOptions.color.primary).toBe("#FF0000");
    expect(settings.voiceStyles).toEqual({ Back: { primary: "#0000FF" } });
    expect(imported.warnings).toContain(FORMATTING_DROPPED);
    expect(imported.warnings).toContain(
      `The font "Comic Sans" isn't bundled with the app, so it was left out`,
    );
  });

  it("names voices after actors when the file has several", () => {
    const imported = assToProjectFiles(
      ass([
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,Anna,0,0,0,,{\\k50}Sun",
        "Dialogue: 0,0:00:02.00,0:00:03.00,Default,Ben,0,0,0,,{\\k50}Moon",
      ]),
      { fonts: FONTS },
    );
    expect(Object.keys(imported.timings)).toEqual(["Anna", "Ben"]);
  });

  it("times an untagged line from its start to its end", () => {
    const imported = assToProjectFiles(
      ass(["Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Just a/b words"]),
      { fonts: FONTS },
    );

    expect(imported.lyrics).toBe("Just_ab_words");
    expect(imported.timings["Voice 1"]).toEqual([
      { text: "Just_", start: 1 },
      { text: "ab_" },
      { text: "words", end: 4 },
    ]);
    expect(imported.warnings).toEqual([MARKUP_REMOVED, UNTIMED_LINES]);
  });

  it("breaks screens at pauses, and splits long runs evenly", () => {
    const line = (second: number) =>
      `Dialogue: 0,0:00:${String(second).padStart(2, "0")}.00,0:00:${String(second + 1).padStart(2, "0")}.00,Default,,0,0,0,,{\\k100}L${second}`;
    const imported = assToProjectFiles(ass([1, 2, 3, 4, 5, 6, 10, 11].map(line)), {
      fonts: FONTS,
    });

    expect(imported.lyrics).toBe("L1\nL2\nL3\n\nL4\nL5\nL6\n\nL10\nL11");
    expect(imported.warnings).toContain(SCREENS_GUESSED);
  });

  it("scales sizes to the app's canvas", () => {
    const imported = assToProjectFiles(
      ass(
        ["Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\k50}Sun"],
        ["Style: Default,Georgia,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,4"],
        "PlayResX: 1920\nPlayResY: 1080",
      ),
      { fonts: FONTS },
    );
    const settings = yaml.load(imported.settings) as Record<string, any>;
    expect(settings.videoOptions.font.size).toBe(16);
    expect(settings.videoOptions.outlineWidth).toBe(1.1);
  });

  it("throws on a file without lyrics", () => {
    expect(() => assToProjectFiles(ass([]), { fonts: FONTS })).toThrow(/no lyrics/);
  });
});
