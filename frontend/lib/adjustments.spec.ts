import {
  addTitleScreen,
  addInstrumentalScreens,
  addQuickStartCountIn,
  addGapCountIns,
  displayQuickLinesEarly,
  deferScreenStarts,
} from "./adjustments";
import {
  compileLyricTimings,
  denormalizeTimestamps,
  LyricEvent,
  LyricSegment,
  LyricsLine,
  LyricsScreen,
  KaraokeOptions,
  CountInMode,
  VerticalAlignment,
} from "./timing";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";
import { LYRIC_MARKERS, DEFAULT_COUNT_IN_THRESHOLD, DEFAULT_COUNT_IN_DURATION } from "@/constants";
import { default as BuefyColor } from "buefy/src/utils/color";

// Pinned rather than taken from the default, which is now empty and draws marks instead.
const TEST_COUNT_IN_TEXT = "••• ";

const DEFAULT_OPTIONS: KaraokeOptions = {
  addTitleScreen: true,
  countInMode: "screen",
  countInText: TEST_COUNT_IN_TEXT,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useBackgroundVideo: false,
  outputFormat: "mp4",
  verticalAlignment: VerticalAlignment.Middle,
  font: {
    size: 22,
    name: "Arial Narrow",
  },
  color: {
    background: BuefyColor.parse("black"),
    primary: BuefyColor.parse("#FF00FF"),
    secondary: BuefyColor.parse("#00FFFF"),
  },
};

const DEFAULT_ASS_OPTIONS = {
  Fontsize: 20,
  Fontname: "Arial Narrow",
};

test("addTitleScreenToShortIntroSong", () => {
  const titleScreenAss = `Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,118,,{\\k0}{\\kf200}Tüülin' Around
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,148,,{\\k200}{\\kf200}The Tüüls
`;
  const screens = denormalizeTimestamps(
    compileLyricTimings(testLyrics, shortIntroTestEvents),
    60.0,
  );
  const screensWithTitle = addTitleScreen(screens, "Tüülin' Around", "The Tüüls");
  expect(screensWithTitle.length).toBe(3);
  expect(screensWithTitle[0].toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).toBe(
    titleScreenAss,
  );
  expect(screensWithTitle[0].audioDelay).toBe(4);
});

test("count-ins use the configured text, threshold and duration", () => {
  const lyrics = "That was a long intro";
  const timings: LyricEvent[] = [
    [30.0, LYRIC_MARKERS.SEGMENT_START],
    [35.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInText: "1 2 3 ",
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(lyrics, timings), 60.0),
    options,
  );

  const countIn = screens[0].lines[0].segments[0];
  expect(countIn.text).toBe("1 2 3 ");
  expect(countIn.timestamp).toBe(27.0);
  expect(countIn.endTimestamp).toBe(30.0);
});

test("no count-in when the gap is within the threshold", () => {
  const lyrics = "That was a long intro";
  const timings: LyricEvent[] = [
    [30.0, LYRIC_MARKERS.SEGMENT_START],
    [35.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInThreshold: 40.0,
    countInDuration: 3.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(lyrics, timings), 60.0),
    options,
  );

  expect(screens[0].lines[0].segments[0].text).toBe(lyrics);
});

const MID_SCREEN_GAP_LYRICS = "first line\nsecond line";
const MID_SCREEN_GAP_TIMINGS: LyricEvent[] = [
  [1.0, LYRIC_MARKERS.SEGMENT_START],
  [2.0, LYRIC_MARKERS.SEGMENT_END],
  [20.0, LYRIC_MARKERS.SEGMENT_START],
  [21.0, LYRIC_MARKERS.SEGMENT_END],
];

function screenWithMidScreenGap(countInMode: CountInMode): LyricsScreen {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode,
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };
  return addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(MID_SCREEN_GAP_LYRICS, MID_SCREEN_GAP_TIMINGS), 60.0),
    options,
  )[0];
}

test("line mode gives a mid-screen line its own count-in", () => {
  const screen = screenWithMidScreenGap("line");

  expect(screen.lines[0].segments[0].text).toBe("first line\n");
  const countIn = screen.lines[1].segments[0];
  expect(countIn.text).toBe(TEST_COUNT_IN_TEXT);
  expect(countIn.timestamp).toBe(17.0);
  expect(countIn.endTimestamp).toBe(20.0);
});

test("marks stand in for a count-in with no text", () => {
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    countInText: "",
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };
  const screen = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(MID_SCREEN_GAP_LYRICS, MID_SCREEN_GAP_TIMINGS), 60.0),
    options,
  )[0];

  // fontSize 22 => a 12x13 mark, sitting on the baseline via \pbo, with a trailing space.
  const mark = `{\\p1\\pbo13}m 0 0 l 12 0 12 -13 0 -13{\\p0} `;
  const segments = screen.lines[1].segments;
  // One segment per mark, so the sweep fills them one at a time over the 3s count-in.
  expect(segments.slice(0, 3).map((s) => s.text)).toEqual([mark, mark, mark]);
  expect(segments.slice(0, 3).map((s) => s.timestamp)).toEqual([17.0, 18.0, 19.0]);
  expect(segments[2].endTimestamp).toBe(20.0);
  expect(segments[3].text).toBe("second line");
});

test("screen mode leaves a mid-screen line alone", () => {
  const screen = screenWithMidScreenGap("screen");

  expect(screen.lines[1].segments[0].text).toBe("second line");
});

test("no count-in on a line that follows on from the previous one", () => {
  const lyrics = "first line\nsecond line";
  const timings: LyricEvent[] = [
    [10.0, LYRIC_MARKERS.SEGMENT_START],
    [11.0, LYRIC_MARKERS.SEGMENT_END],
    [12.0, LYRIC_MARKERS.SEGMENT_START],
    [13.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  const options: KaraokeOptions = {
    ...DEFAULT_OPTIONS,
    countInMode: "line",
    countInThreshold: 5.0,
    countInDuration: 3.0,
  };

  const screens = addGapCountIns(
    denormalizeTimestamps(compileLyricTimings(lyrics, timings), 60.0),
    options,
  );

  expect(screens[0].lines[0].segments[0].text).toBe(TEST_COUNT_IN_TEXT);
  expect(screens[0].lines[1].segments[0].text).toBe("second line");
});

test("quick start count-in uses the configured text and duration", () => {
  const options: KaraokeOptions = { ...DEFAULT_OPTIONS, countInText: "go! ", countInDuration: 3.0 };
  const screens = denormalizeTimestamps(
    compileLyricTimings(testLyrics, shortIntroTestEvents),
    60.0,
  );

  const adjusted = addQuickStartCountIn(screens, options);

  const countIn = adjusted[0].lines[0].segments[0];
  expect(countIn.text).toBe("go! ");
  expect(countIn.timestamp).toBe(0.0);
  expect(countIn.endTimestamp).toBe(3.0);
  expect(adjusted[0].audioDelay).toBe(3.0 - shortIntroTestEvents[0][0]);
});

test("addInstrumentalScreen", () => {
  const lyrics = "screen one\n\nscreen two";
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [20.0, LYRIC_MARKERS.SEGMENT_START],
    [21.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  let screens = compileLyricTimings(lyrics, timings);

  screens = denormalizeTimestamps(addInstrumentalScreens(screens, DEFAULT_OPTIONS), 60.0);
  expect(screens.length).toBe(3);

  const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,133,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,133,,{\\k0}{\\kf1800}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen two
`;
  expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(
    ass,
  );
  const instrumentalScreen: LyricsScreen = screens[1];
  expect(instrumentalScreen.startTimestamp).toBeTruthy();
});

test("addInstrumentalScreenFor3ScreenSong", () => {
  const lyrics = "screen one\n\nscreen two\n\nscreen three";
  const timings: LyricEvent[] = [
    [1.0, LYRIC_MARKERS.SEGMENT_START],
    [2.0, LYRIC_MARKERS.SEGMENT_END],
    [20.0, LYRIC_MARKERS.SEGMENT_START],
    [21.0, LYRIC_MARKERS.SEGMENT_END],
    [30.0, LYRIC_MARKERS.SEGMENT_START],
    [31.0, LYRIC_MARKERS.SEGMENT_END],
  ];
  let screens = compileLyricTimings(lyrics, timings);
  screens = denormalizeTimestamps(addInstrumentalScreens(screens, DEFAULT_OPTIONS), 60.0);
  expect(screens.length).toBe(5);

  const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,133,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,133,,{\\k0}{\\kf1800}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen two


Dialogue: 0,0:00:21.00,0:00:30.00,Default,Singer,0,0,133,,{\\k0}{\\kf900}{\\p1}m 0 5 l 307 5 307 20 0 20{\\p0}
Dialogue: 0,0:00:30.00,0:00:31.00,Default,Singer,0,0,133,,{\\k0}{\\kf100}screen three
`;
  expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(
    ass,
  );
});

test("fast lines display early", () => {
  const screens = [
    new LyricsScreen(), // ignored title screen
    new LyricsScreen([
      new LyricsLine([new LyricSegment("one", 1.0)]),
      new LyricsLine([new LyricSegment("two", 2.0)]),
    ]),
    new LyricsScreen([
      new LyricsLine([new LyricSegment("three", 3.0)]),
      new LyricsLine([new LyricSegment("four", 4.0)]),
    ]),
  ];
  screens[1].startTimestamp = 0;
  const denormalizedScreens = denormalizeTimestamps(screens, 4);
  const adjustedScreens = displayQuickLinesEarly(denormalizedScreens, DEFAULT_OPTIONS);
  expect(adjustedScreens[1].lines[0].customDisplayEndTime).toBe(2.5);
  expect(adjustedScreens[2].lines[0].customDisplayStartTime).toBe(2.75);
});

describe("deferScreenStarts", () => {
  function screenStartingAt(displayStart: number, firstLineTime: number): LyricsScreen {
    const screen = new LyricsScreen([
      new LyricsLine([new LyricSegment("la", firstLineTime, firstLineTime + 1)]),
    ]);
    screen.startTimestamp = displayStart;
    return screen;
  }

  it("pulls a far-too-early display start to just before the first line", () => {
    // First line at 2:14 but display would start at 0 -> defer to leadIn before the line.
    const screens = deferScreenStarts([screenStartingAt(0, 134)]);
    expect(screens[0].startTimestamp).toBe(133); // 134 - 1s lead-in
  });

  it("leaves a screen that already displays close to its line alone", () => {
    const screens = deferScreenStarts([screenStartingAt(8, 10)]); // only 2s early
    expect(screens[0].startTimestamp).toBe(8);
  });
});
