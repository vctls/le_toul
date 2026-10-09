import { describe, expect, it } from "vitest";
import { DEFAULT_KARAOKE_OPTIONS, KaraokeOptions, layOutVoices, LyricsScreen } from "./timing";
import { TimedSegment } from "./timedSegments";
import { LINE_FADE, titleFrameTime } from "./screenSlots";
import { displayEndOf } from "./adjustments";
import { TITLE_SCREEN_DURATION } from "@/constants";

const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  addTitleScreen: false,
  countInMode: "none",
  instrumentalThreshold: 0,
  addStaggeredLines: false,
};

function layOut(segments: TimedSegment[], trackOptions: KaraokeOptions = options): LyricsScreen[] {
  return layOutVoices([{ voice: "v", segments, options: trackOptions }], 30, "", "")[0].screens;
}

// The ASS file holds fades in milliseconds.
const ms = (time: number | undefined) => time && Math.round(time * 1000) / 1000;

function lines(screens: LyricsScreen[]) {
  return screens
    .filter((screen) => screen.kind === "lyrics")
    .flatMap((screen) =>
      screen.lines.map((line) => ({
        start: ms(line.customDisplayStartTime ?? screen.startTimestamp),
        end: ms(line.customDisplayEndTime ?? screen.endTimestamp),
        fadeIn: ms(line.fadeInDuration),
        fadeOut: ms(line.fadeOutDuration),
      })),
    );
}

// Two screens of one line each, so the lines share a height.
function twoScreens(second: Partial<TimedSegment>, first: Partial<TimedSegment> = {}) {
  return [
    { text: "a\n\n", start: 1, end: 2, ...first },
    { text: "b", start: 5, end: 6, ...second },
  ];
}

describe("fadeLines", () => {
  it("keeps a line shown to fade out, and shows the next one at its height after it", () => {
    const [a, b] = lines(layOut(twoScreens({})));

    expect(a).toEqual({ start: 0, end: 2 + LINE_FADE, fadeIn: LINE_FADE, fadeOut: LINE_FADE });
    expect(b).toEqual({
      start: 2 + LINE_FADE,
      end: 6 + LINE_FADE,
      fadeIn: LINE_FADE,
      fadeOut: LINE_FADE,
    });
  });

  it("splits the time between two lines' animations when it is too short for both fades", () => {
    const [a, b] = lines(layOut(twoScreens({ start: 2.2 })));

    expect(a.end).toBeCloseTo(2.1);
    expect(b.start).toBeCloseTo(2.1);
    expect(a.fadeOut).toBeCloseTo(0.1);
    expect(b.fadeIn).toBeCloseTo(0.1);
  });

  it("doesn't fade a line that animates as soon as it is shown", () => {
    const [a, b] = lines(layOut(twoScreens({ start: 2 })));

    expect([a.end, a.fadeOut]).toEqual([2, 0]);
    expect([b.start, b.fadeIn]).toEqual([2, 0]);
  });

  it("never moves a stored bound, but fades inside it", () => {
    const [atTimings, next] = lines(layOut(twoScreens({}, { displayEnd: 2 })));
    expect([atTimings.end, atTimings.fadeOut]).toEqual([2, 0]);
    expect(next.start).toBe(2);

    const [later] = lines(layOut(twoScreens({}, { displayEnd: 4 })));
    expect([later.end, later.fadeOut]).toEqual([4, LINE_FADE]);
  });

  it("doesn't keep a line shown past the end of the song", () => {
    const [a] = lines(layOut([{ text: "a", start: 1 }]));

    expect([a.end, a.fadeOut]).toEqual([30, 0]);
  });

  it("starts an instrumental screen once the line before it has faded out", () => {
    const screens = layOut(twoScreens({ start: 20, end: 21 }), {
      ...options,
      instrumentalThreshold: 8,
    });
    const instrumental = screens.find((screen) => screen.kind === "instrumental");

    expect(lines(screens)[0].end).toBe(2 + LINE_FADE);
    expect(instrumental?.startTimestamp).toBe(2 + LINE_FADE);
  });

  it("fades the title and artist in and out together with the title screen", () => {
    const screens = layOut([{ text: "a", start: 10, end: 11 }], {
      ...options,
      addTitleScreen: true,
    });
    const [title, artist] = screens[0].lines;

    expect([title.fadeInDuration, title.fadeOutDuration]).toEqual([LINE_FADE, LINE_FADE]);
    expect([artist.fadeInDuration, artist.fadeOutDuration]).toEqual([LINE_FADE, LINE_FADE]);
    expect(displayEndOf(title, screens[0])).toBe(TITLE_SCREEN_DURATION);
    expect(displayEndOf(artist, screens[0])).toBe(TITLE_SCREEN_DURATION);
  });

  it("doesn't keep the title shown past a stored display start", () => {
    const screens = layOut([{ text: "a", start: 10, end: 11, displayStart: 3 }], {
      ...options,
      addTitleScreen: true,
    });
    const [title, artist] = screens[0].lines;

    expect([title.customDisplayEndTime, title.fadeOutDuration]).toEqual([3, LINE_FADE]);
    expect([artist.customDisplayEndTime, artist.fadeOutDuration]).toEqual([3, LINE_FADE]);
  });
});

describe("titleFrameTime", () => {
  const titled = { ...options, addTitleScreen: true };
  const frameTime = (segments: TimedSegment[], title: string, artist: string) =>
    titleFrameTime(layOutVoices([{ voice: "v", segments, options: titled }], 30, title, artist)[0]);

  it("falls in the middle of the title screen", () => {
    expect(frameTime([{ text: "a", start: 10, end: 11 }], "Song", "Band")).toBe(
      TITLE_SCREEN_DURATION / 2,
    );
  });

  it("falls in the middle of a title screen cut short by a stored display start", () => {
    expect(frameTime([{ text: "a", start: 10, end: 11, displayStart: 3 }], "Song", "Band")).toBe(
      1.5,
    );
  });

  it("is null without a title screen", () => {
    const render = layOutVoices(
      [{ voice: "v", segments: [{ text: "a", start: 10, end: 11 }], options }],
      30,
      "Song",
      "Band",
    )[0];

    expect(titleFrameTime(render)).toBeNull();
  });

  it("is null when there is neither a title nor an artist", () => {
    expect(frameTime([{ text: "a", start: 10, end: 11 }], "", " ")).toBeNull();
  });
});
