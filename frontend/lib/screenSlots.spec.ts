import { describe, expect, it } from "vitest";
import { DEFAULT_KARAOKE_OPTIONS, KaraokeOptions, layOutVoices, LyricsScreen } from "./timing";
import { TimedSegment } from "./timedSegments";
import { LINE_FADE } from "./screenSlots";

const options: KaraokeOptions = {
  ...DEFAULT_KARAOKE_OPTIONS,
  addTitleScreen: false,
  countInMode: "none",
  addInstrumentalScreens: false,
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
      addInstrumentalScreens: true,
    });
    const instrumental = screens.find((screen) => screen.kind === "instrumental");

    expect(lines(screens)[0].end).toBe(2 + LINE_FADE);
    expect(instrumental?.startTimestamp).toBe(2 + LINE_FADE);
  });
});
