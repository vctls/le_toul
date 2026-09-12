import { addTitleScreen, addInstrumentalScreens, addQuickStartCountIn, addScreenCountIns, displayQuickLinesEarly, deferScreenStarts } from "./adjustments";
import { compileLyricTimings, denormalizeTimestamps, LyricEvent, LyricSegment, LyricsLine, LyricsScreen, KaraokeOptions, VerticalAlignment } from "./timing";
import { testLyrics, shortIntroTestEvents } from "./timing.spec";
import { LYRIC_MARKERS, DEFAULT_COUNT_IN_TEXT, DEFAULT_COUNT_IN_THRESHOLD, DEFAULT_COUNT_IN_DURATION } from "@/constants";
import { default as BuefyColor } from "buefy/src/utils/color";

const DEFAULT_OPTIONS: KaraokeOptions = {
    addTitleScreen: true,
    addCountIns: true,
    countInText: DEFAULT_COUNT_IN_TEXT,
    countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
    countInDuration: DEFAULT_COUNT_IN_DURATION,
    addInstrumentalScreens: true,
    addStaggeredLines: true,
    useBackgroundVideo: false,
    verticalAlignment: VerticalAlignment.Middle,
    font: {
        size: 22,
        name: "Arial Narrow"
    },
    color: {
        background: BuefyColor.parse("black"),
        primary: BuefyColor.parse("#FF00FF"),
        secondary: BuefyColor.parse("#00FFFF")
    }
}

const DEFAULT_ASS_OPTIONS = {
    "Fontsize": 20,
    "Fontname": "Arial Narrow"
}

test('addTitleScreenToShortIntroSong', () => {
    const titleScreenAss = `Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,114,,{\\k0}{\\kf200}Tüülin' Around
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Singer,0,0,144,,{\\k200}{\\kf200}The Tüüls
`
    const screens = denormalizeTimestamps(compileLyricTimings(testLyrics, shortIntroTestEvents), 60.0);
    const screensWithTitle = addTitleScreen(screens, "Tüülin' Around", "The Tüüls");
    expect(screensWithTitle.length).toBe(3);
    expect(screensWithTitle[0].toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).toBe(titleScreenAss);
    expect(screensWithTitle[0].audioDelay).toBe(4);
});

test('screen count-ins use the configured text, threshold and duration', () => {
    const lyrics = "That was a long intro"
    const timings: LyricEvent[] = [[30.0, LYRIC_MARKERS.SEGMENT_START], [35.0, LYRIC_MARKERS.SEGMENT_END]]
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, countInText: "1 2 3 ", countInThreshold: 5.0, countInDuration: 3.0 }

    const screens = addScreenCountIns(denormalizeTimestamps(compileLyricTimings(lyrics, timings), 60.0), options);

    const countIn = screens[0].lines[0].segments[0];
    expect(countIn.text).toBe("1 2 3 ");
    expect(countIn.timestamp).toBe(27.0);
    expect(countIn.endTimestamp).toBe(30.0);
});

test('no screen count-in when the gap is within the threshold', () => {
    const lyrics = "That was a long intro"
    const timings: LyricEvent[] = [[30.0, LYRIC_MARKERS.SEGMENT_START], [35.0, LYRIC_MARKERS.SEGMENT_END]]
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, countInThreshold: 40.0, countInDuration: 3.0 }

    const screens = addScreenCountIns(denormalizeTimestamps(compileLyricTimings(lyrics, timings), 60.0), options);

    expect(screens[0].lines[0].segments[0].text).toBe(lyrics);
});

test('quick start count-in uses the configured text and duration', () => {
    const options: KaraokeOptions = { ...DEFAULT_OPTIONS, countInText: "go! ", countInDuration: 3.0 }
    const screens = denormalizeTimestamps(compileLyricTimings(testLyrics, shortIntroTestEvents), 60.0);

    const adjusted = addQuickStartCountIn(screens, options);

    const countIn = adjusted[0].lines[0].segments[0];
    expect(countIn.text).toBe("go! ");
    expect(countIn.timestamp).toBe(0.0);
    expect(countIn.endTimestamp).toBe(3.0);
    expect(adjusted[0].audioDelay).toBe(3.0 - shortIntroTestEvents[0][0]);
});

test('addInstrumentalScreen', () => {
    const lyrics = "screen one\n\nscreen two"
    const timings: LyricEvent[] = [
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [20.0, LYRIC_MARKERS.SEGMENT_START],
        [21.0, LYRIC_MARKERS.SEGMENT_END]
    ]
    let screens = compileLyricTimings(lyrics, timings);

    screens = denormalizeTimestamps(addInstrumentalScreens(screens), 60.0);
    expect(screens.length).toBe(3)

    const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,129,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,129,,{\\k0}{\\kf1800}||||||||||||||||||||||||||||||||||
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,129,,{\\k0}{\\kf100}screen two
`
    expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(ass);
    const instrumentalScreen: LyricsScreen = screens[1];
    expect(instrumentalScreen.startTimestamp).toBeTruthy();

});

test('addInstrumentalScreenFor3ScreenSong', () => {
    const lyrics = "screen one\n\nscreen two\n\nscreen three"
    const timings: LyricEvent[] = [
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
        [20.0, LYRIC_MARKERS.SEGMENT_START],
        [21.0, LYRIC_MARKERS.SEGMENT_END],
        [30.0, LYRIC_MARKERS.SEGMENT_START],
        [31.0, LYRIC_MARKERS.SEGMENT_END],
    ]
    let screens = compileLyricTimings(lyrics, timings)
        ;
    screens = denormalizeTimestamps(addInstrumentalScreens(screens), 60.0);
    expect(screens.length).toBe(5)

    const ass = `Dialogue: 0,0:00:00.00,0:00:02.00,Default,Singer,0,0,129,,{\\k100}{\\kf100}screen one


Dialogue: 0,0:00:02.00,0:00:20.00,Default,Singer,0,0,129,,{\\k0}{\\kf1800}||||||||||||||||||||||||||||||||||
Dialogue: 0,0:00:20.00,0:00:21.00,Default,Singer,0,0,129,,{\\k0}{\\kf100}screen two


Dialogue: 0,0:00:21.00,0:00:30.00,Default,Singer,0,0,129,,{\\k0}{\\kf900}||||||||||||||||||||||||||||||||||
Dialogue: 0,0:00:30.00,0:00:31.00,Default,Singer,0,0,129,,{\\k0}{\\kf100}screen three
`
    expect(screens.map((s) => s.toAssEvents(DEFAULT_ASS_OPTIONS, DEFAULT_OPTIONS)).join("")).toBe(ass);

});

test('fast lines display early', () => {
    const screens = [
        new LyricsScreen(), // ignored title screen
        new LyricsScreen([
            new LyricsLine([new LyricSegment("one", 1.0)]),
            new LyricsLine([new LyricSegment("two", 2.0)])
        ]),
        new LyricsScreen([
            new LyricsLine([new LyricSegment("three", 3.0)]),
            new LyricsLine([new LyricSegment("four", 4.0)])
        ])
    ]
    screens[1].startTimestamp = 0;
    const denormalizedScreens = denormalizeTimestamps(screens, 4);
    const adjustedScreens = displayQuickLinesEarly(denormalizedScreens, DEFAULT_OPTIONS)
    expect(adjustedScreens[1].lines[0].customDisplayEndTime).toBe(2.5)
    expect(adjustedScreens[2].lines[0].customDisplayStartTime).toBe(2.75)

})

describe("deferScreenStarts", () => {
    function screenStartingAt(displayStart: number, firstLineTime: number): LyricsScreen {
        const screen = new LyricsScreen([new LyricsLine([new LyricSegment("la", firstLineTime, firstLineTime + 1)])]);
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
})