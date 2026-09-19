import {
  adjustScreenTimestamps,
  LyricSegment,
  LyricsScreen,
  LyricsLine,
  Timestamp,
  denormalizeTimestamps,
  KaraokeOptions,
} from "./timing";
import {
  TITLE_SCREEN_DURATION as TITLE_SCREEN_DURATION,
  INSTRUMENTAL_SCREEN_THRESHOLD,
  SUBTITLE_CANVAS,
  GLYPH_BLOCK_RATIO,
} from "../constants";
import { concat } from "lodash-es";

const FIRST_SCREEN_QUICK_START_THRESHOLD: Timestamp = 1.0;
const SCREEN_QUICK_START_THRESHOLD: Timestamp = 2.0;

const COUNT_IN_MARKS = 3;
const COUNT_IN_MARK_WIDTH_RATIO = 0.55;
const COUNT_IN_MARK_HEIGHT_RATIO = 0.6;

function countInMark(fontSize: number): string {
  // A drawing rather than a glyph.
  // Inline with the lyrics there is a text baseline, so \pbo sits the mark on it.
  // Each mark starts its own path at 0: libass takes a run's advance from its bounding box,
  // so an offset path would overlap the text after it.
  const width = Math.round(fontSize * COUNT_IN_MARK_WIDTH_RATIO);
  const height = Math.round(fontSize * COUNT_IN_MARK_HEIGHT_RATIO);
  return `{\\p1\\pbo${height}}m 0 0 l ${width} 0 ${width} -${height} 0 -${height}{\\p0} `;
}

// What a count-in shows: the configured text, or marks when no text is set.
// The text is one segment, so it sweeps as a whole;
// the marks get one segment each, so they fill one at a time.
function countInSegments(
  options: KaraokeOptions,
  timestamp: Timestamp,
  endTimestamp: Timestamp,
): LyricSegment[] {
  if (options.countInText.trim()) {
    return [new LyricSegment(options.countInText, timestamp, endTimestamp)];
  }
  const mark = countInMark(options.font.size);
  const step = (endTimestamp - timestamp) / COUNT_IN_MARKS;
  return Array.from(
    { length: COUNT_IN_MARKS },
    (_, i) => new LyricSegment(mark, timestamp + i * step, timestamp + (i + 1) * step),
  );
}

export function addQuickStartCountIn(
  screens: LyricsScreen[],
  options: KaraokeOptions,
): LyricsScreen[] {
  const firstSegment = screens[0].lines[0].segments[0];
  if (firstSegment.timestamp > FIRST_SCREEN_QUICK_START_THRESHOLD) {
    return screens;
  }
  /*
    This is the first screen and the lyrics start right away.
    Add a count-in and adjust all other timings accordingly
    */

  // This is how much time we need to add to the beginning:
  const addedTime: Timestamp = options.countInDuration - firstSegment.timestamp;
  // Move every timestamp forward by that much
  const adjustedScreens = adjustScreenTimestamps(screens, addedTime);
  // Reset the first screen start time to the non-adjusted value
  adjustedScreens[0].startTimestamp = screens[0].startTimestamp;
  // Delay the audio on the first screen by the amount we moved forward.
  adjustedScreens[0].audioDelay += addedTime;
  // Add the count-in segments to the beginning
  const newFirstSegment = adjustedScreens[0].lines[0].segments[0];
  adjustedScreens[0].lines[0].addSegmentsToFront(
    countInSegments(options, 0.0, newFirstSegment.timestamp),
  );

  return adjustedScreens;
}

export function addGapCountIns(screens: LyricsScreen[], options: KaraokeOptions): LyricsScreen[] {
  // Add a count-in to the start of a line if there's awhile before the singing starts.
  // Gaps are measured across screen boundaries too, so the previous end carries over.

  const everyLine = options.countInMode === "line";
  let prevEnd: Timestamp = 0.0;
  for (const screen of screens) {
    for (const [index, line] of screen.lines.entries()) {
      if (line.segments.length === 0) {
        continue;
      }
      if ((everyLine || index === 0) && line.timestamp - prevEnd > options.countInThreshold) {
        line.addSegmentsToFront(
          countInSegments(options, line.timestamp - options.countInDuration, line.timestamp),
        );
      }
      prevEnd = line.endTimestamp;
    }
  }
  return screens;
}

const MAX_EARLY_DISPLAY: Timestamp = 5.0;
const DEFERRED_LEAD_IN: Timestamp = 1.0;

export function deferScreenStarts(
  screens: LyricsScreen[],
  maxEarly: number = MAX_EARLY_DISPLAY,
  leadIn: number = DEFERRED_LEAD_IN,
): LyricsScreen[] {
  // Cap how early a screen is displayed. A screen normally displays from the previous
  // screen's end (which can be the very start of the song), so a voice whose first line
  // is deep into the song would otherwise show its text from 0:00. When a screen would
  // appear more than `maxEarly` seconds before its first line animates, pull its display
  // start to `leadIn` seconds before that line. Used for non-primary voices, which have
  // no title/instrumental screens to fill the gap. The (per-voice) count-in still applies.
  for (const screen of screens) {
    if (screen.lines.length === 0) {
      continue;
    }
    const firstAnimation = screen.lines[0].timestamp;
    const start = screen.startTimestamp ?? 0;
    if (start < firstAnimation - maxEarly) {
      screen.startTimestamp = Math.max(0, firstAnimation - leadIn);
    }
  }
  return screens;
}

function getIntroLength(screens: LyricsScreen[]): number {
  // Get the length of the song intro
  return screens[0].lines[0].timestamp;
}

export function trimStart(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Trim [adjustment] seconds from the start of the first screen, keeping other timestamps the same.
  let otherScreens = screens.slice(1);
  const trimmedScreen = screens[0].trimDisplayStart(adjustment);
  return concat([trimmedScreen], otherScreens);
}

const INSTRUMENTAL_BAR_WIDTH_FRACTION = 0.6;
const INSTRUMENTAL_BAR_HEIGHT_RATIO = 0.7;

function instrumentalBar(fontSize: number): string {
  // A drawing, not text: the sweep fills it smoothly and its width doesn't depend on the font.
  // Drawing coordinates are script units and ignore Fontsize, so we size it ourselves.
  // Alone on its line, libass places the bar from its top edge,
  // so the offset drops it into the block a line of text would cover.
  // Leaving \p1 unclosed swallows the rest of the line.
  const width = Math.round(SUBTITLE_CANVAS.width * INSTRUMENTAL_BAR_WIDTH_FRACTION);
  const height = Math.round(fontSize * INSTRUMENTAL_BAR_HEIGHT_RATIO);
  const top = Math.round((fontSize * GLYPH_BLOCK_RATIO - height) / 2);
  const bottom = top + height;
  return `{\\p1}m 0 ${top} l ${width} ${top} ${width} ${bottom} 0 ${bottom}{\\p0}`;
}

function createInstrumentalScreen(
  startTime: Timestamp,
  duration: number,
  fontSize: number,
): LyricsScreen {
  // Create an INSTRUMENTAL screen lasting [duration] seconds
  const line = new LyricsLine([
    new LyricSegment(instrumentalBar(fontSize), startTime, startTime + duration),
  ]);
  const screen = new LyricsScreen([line]);
  screen.startTimestamp = startTime;
  return screen;
}

export function addInstrumentalScreens(
  screens: LyricsScreen[],
  options: KaraokeOptions,
): LyricsScreen[] {
  // Add instrumental countdown screens between screens with a long gap
  if (screens.length < 2) {
    return screens;
  }
  // We need to use actual segment times, not calculated screen start/end times
  const currentScreen = screens[1];
  const prevScreenEnd = screens[0].endTimestamp;
  const screenStart = currentScreen.segments[0].timestamp;
  const screenGap = screenStart - prevScreenEnd;
  if (screenGap < INSTRUMENTAL_SCREEN_THRESHOLD) {
    return [screens[0]].concat(addInstrumentalScreens(screens.slice(1), options));
  } else {
    const instrumentalScreen = createInstrumentalScreen(
      screens[0].endTimestamp,
      screenGap,
      options.font.size,
    );
    const adjustedScreens = trimStart(screens.slice(1), screenGap);
    return [screens[0], instrumentalScreen].concat(
      addInstrumentalScreens(adjustedScreens, options),
    );
  }
}

export function addTitleScreen(
  screens: LyricsScreen[],
  title: string,
  artist: string,
): LyricsScreen[] {
  const introLength = getIntroLength(screens);
  // If the vocals start right at the beginning of the song, don't start the audio until the title screen is over.
  let audioDelay = 0.0;
  let adjustedLyricScreens;
  if (introLength > TITLE_SCREEN_DURATION) {
    // Long intro, start audio during title screen
    adjustedLyricScreens = trimStart(screens, TITLE_SCREEN_DURATION);
  } else {
    // Short intro, delay audio until after title screen
    audioDelay = TITLE_SCREEN_DURATION;
    adjustedLyricScreens = adjustScreenTimestamps(screens, TITLE_SCREEN_DURATION);
  }
  const titleScreen = new LyricsScreen(
    [
      new LyricsLine([new LyricSegment(title, 0.0, TITLE_SCREEN_DURATION / 2)]),
      new LyricsLine([new LyricSegment(artist, TITLE_SCREEN_DURATION / 2, TITLE_SCREEN_DURATION)]),
    ],
    audioDelay,
  );
  const denormalizedScreen = denormalizeTimestamps([titleScreen], TITLE_SCREEN_DURATION)[0];
  const screensWithTitle = adjustedLyricScreens.slice();
  screensWithTitle.unshift(denormalizedScreen);
  return screensWithTitle;
}

export function displayQuickLinesEarly(
  screens: LyricsScreen[],
  displayOptions: KaraokeOptions,
): LyricsScreen[] {
  // If the lyrics on the next screen start right away, display the first few lines early
  // Skip the title screen and the last screen.
  for (let i = 1; i < screens.length - 1; i++) {
    const screen = screens[i];
    const nextScreen = screens[i + 1];
    if (nextScreen.singStart - screen.singEnd > SCREEN_QUICK_START_THRESHOLD) {
      continue;
    }
    if (screen.lines.length < 2) {
      continue;
    }

    const earlyRemovalLines = screen.lines.slice(0, Math.min(2, screen.lines.length - 1));
    const lineAfterEarlyRemovals = screen.lines[earlyRemovalLines.length];
    // Remove earlyRemovalLines when the line after them is halfway done singing
    const earlyRemovalTime =
      lineAfterEarlyRemovals.timestamp +
      (lineAfterEarlyRemovals.endTimestamp - lineAfterEarlyRemovals.timestamp) * 0.5;
    const earlyDisplayTime =
      lineAfterEarlyRemovals.timestamp +
      (lineAfterEarlyRemovals.endTimestamp - lineAfterEarlyRemovals.timestamp) * 0.75;
    earlyRemovalLines.forEach((line) => {
      line.customDisplayEndTime = earlyRemovalTime;
      line.fadeOutDuration = (earlyDisplayTime - earlyRemovalTime) / 2;
    });

    // TODO what if nextScreen.length == 2 and screen.length == 3?
    const earlyDisplayLines = nextScreen.lines.slice(0, earlyRemovalLines.length);
    // Adjust y positions so they don't overwrite remaining lines. The next screen's block
    // is laid out as if it had this screen's line count, which puts its first line in the
    // slot this screen's first line is vacating. Recording the line count rather than the
    // resulting Y keeps this correct once voice lanes are assigned (multi-voice), which
    // happens after this pass and moves the whole block.
    const fontSize = displayOptions.font.size;
    const alignment = displayOptions.verticalAlignment;
    if (screen.getLineY(0, fontSize, alignment) < nextScreen.getLineY(0, fontSize, alignment)) {
      nextScreen.positionAsLineCount = screen.positionAsLineCount ?? screen.lines.length;
    }

    earlyDisplayLines.forEach((line, i) => {
      line.customDisplayStartTime = earlyDisplayTime;
      line.fadeInDuration = (earlyDisplayTime - earlyRemovalTime) / 2;
    });
  }
  return screens;
}
