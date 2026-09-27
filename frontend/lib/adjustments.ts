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

// One entry per mark, fading in towards the beat the singing starts on.
const COUNT_IN_MARK_ALPHAS = [0x80, 0x40, 0x00];
const COUNT_IN_MARKS_MAX = COUNT_IN_MARK_ALPHAS.length;
const COUNT_IN_MARK_WIDTH_RATIO = 0.4;
const COUNT_IN_MARK_HEIGHT_RATIO = 0.6;
// Script units, so the marks stay the same distance apart in any font at any size.
const COUNT_IN_MARK_GAP = 5;

function countInMark(fontSize: number, last: boolean): string {
  // A drawing rather than a glyph.
  // Inline with the lyrics there is a text baseline, so \pbo sits the mark on it.
  // Each mark starts its own path at 0: libass takes a run's advance from its bounding box,
  // so an offset path would overlap the text after it.
  // The gap is a second, empty contour widening that box, so it stays in script units
  // rather than taking the width of a space in the current font.
  const width = Math.round(fontSize * COUNT_IN_MARK_WIDTH_RATIO);
  const height = Math.round(fontSize * COUNT_IN_MARK_HEIGHT_RATIO);
  const rect = `m 0 0 l ${width} 0 ${width} -${height} 0 -${height}`;
  const pad = width + COUNT_IN_MARK_GAP;
  // The last mark is followed by the lyrics, so an ordinary word space separates them.
  const gap = last ? "" : ` m ${pad} 0 l ${pad} 0`;
  return `{\\p1\\pbo${height}}${rect}${gap}{\\p0}${last ? " " : ""}`;
}

/**
 * Split count-in text into at most three marks that join back into it,
 * by word when it has spaces and by character otherwise.
 * Leftover words or characters go to the first marks.
 */
function countInTextMarks(text: string): string[] {
  const body = text.trim();
  if (!body) {
    return [];
  }
  const units = /\s/.test(body)
    ? body.split(/(?<=\s)(?=\S)/)
    : Array.from(new Intl.Segmenter().segment(body), ({ segment }) => segment);
  const markCount = Math.min(COUNT_IN_MARKS_MAX, units.length);
  const marks: string[] = [];
  for (let i = 0, start = 0; i < markCount; i++) {
    const size = Math.floor(units.length / markCount) + (i < units.length % markCount ? 1 : 0);
    marks.push(units.slice(start, start + size).join(""));
    start += size;
  }
  // The text's own leading and trailing spaces stay, as in a fixed count-in.
  marks[0] = text.slice(0, text.indexOf(body)) + marks[0];
  marks[markCount - 1] += text.slice(text.indexOf(body) + body.length);
  return marks;
}

function countInMarkTexts(options: KaraokeOptions): string[] {
  const marks = countInTextMarks(options.countInText);
  if (marks.length > 0) {
    return marks;
  }
  return Array.from({ length: COUNT_IN_MARKS_MAX }, (_, i) =>
    countInMark(options.font.size, i === COUNT_IN_MARKS_MAX - 1),
  );
}

/**
 * The last markCount marks, ending as the singing starts, faintest first.
 * A full count-in lasts countInThreshold, whatever the number of marks.
 * They are sliced from the front,
 * because slice(-markCount) returns every mark when markCount is 0.
 */
function countInMarks(
  options: KaraokeOptions,
  marks: string[],
  markCount: number,
  endTimestamp: Timestamp,
): LyricSegment[] {
  const step = options.countInThreshold / marks.length;
  const timestamp = endTimestamp - markCount * step;
  const alphas = COUNT_IN_MARK_ALPHAS.slice(COUNT_IN_MARKS_MAX - markCount);
  return marks.slice(marks.length - markCount).map((mark, i) => {
    const hex = alphas[i].toString(16).padStart(2, "0").toUpperCase();
    return new LyricSegment(
      `{\\alpha&H${hex}&}${mark}`,
      timestamp + i * step,
      timestamp + (i + 1) * step,
    );
  });
}

// Dynamic count-ins spend a fixed time per mark,
// so they tick at the same rate whatever the gap and never reach back past the previous line.
// Fixed ones are all or nothing: the text can't be shortened without misleading the singer,
// so a gap too short for it gets none.
function countInSegments(
  options: KaraokeOptions,
  endTimestamp: Timestamp,
  gap: Timestamp,
): LyricSegment[] {
  if (!options.dynamicCountIns) {
    if (gap <= options.countInThreshold) {
      return [];
    }
    const timestamp = endTimestamp - options.countInDuration;
    return [new LyricSegment(options.countInText, timestamp, endTimestamp)];
  }
  const marks = countInMarkTexts(options);
  const step = options.countInThreshold / marks.length;
  const markCount = Math.min(marks.length, Math.floor(gap / step));
  return countInMarks(options, marks, markCount, endTimestamp);
}

function countInLength(options: KaraokeOptions): Timestamp {
  return options.dynamicCountIns ? options.countInThreshold : options.countInDuration;
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
  const addedTime: Timestamp = countInLength(options) - firstSegment.timestamp;
  // Move every timestamp forward by that much
  const adjustedScreens = adjustScreenTimestamps(screens, addedTime);
  // Reset the first screen start time to the non-adjusted value
  adjustedScreens[0].startTimestamp = screens[0].startTimestamp;
  // Delay the audio on the first screen by the amount we moved forward.
  adjustedScreens[0].audioDelay += addedTime;
  // The song was moved to make room for a whole count-in, so this one is never cut short.
  const newFirstSegment = adjustedScreens[0].lines[0].segments[0];
  const marks = countInMarkTexts(options);
  adjustedScreens[0].lines[0].addSegmentsToFront(
    options.dynamicCountIns
      ? countInMarks(options, marks, marks.length, newFirstSegment.timestamp)
      : [new LyricSegment(options.countInText, 0.0, newFirstSegment.timestamp)],
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
      if (everyLine || index === 0) {
        line.addSegmentsToFront(countInSegments(options, line.timestamp, line.timestamp - prevEnd));
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
  screen.kind = "instrumental";
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
  denormalizedScreen.kind = "title";
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
    // The first two slots leave early, or fewer so that a line stays below them.
    // The next screen's lines in those slots take their place.
    const leavingSlots = Math.min(2, screen.slotOf(screen.lines.length - 1));
    const earlyRemovalLines = screen.lines.filter((_, j) => screen.slotOf(j) < leavingSlots);
    if (earlyRemovalLines.length === 0) {
      continue;
    }
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
    const earlyDisplayLines = nextScreen.lines.filter(
      (_, j) => nextScreen.slotOf(j) < leavingSlots,
    );
    nextScreen.earlySlots = leavingSlots;
    placeStaggeredScreen(screen, nextScreen, displayOptions);

    earlyDisplayLines.forEach((line, i) => {
      line.customDisplayStartTime = earlyDisplayTime;
      line.fadeInDuration = (earlyDisplayTime - earlyRemovalTime) / 2;
    });
  }
  return screens;
}

/**
 * Lay a staggered screen out as if it had the previous screen's slot count
 * when its own would put its first slot below the previous screen's first slot.
 * That puts its early lines in the slots the previous screen's first lines leave.
 */
function placeStaggeredScreen(
  previous: LyricsScreen,
  screen: LyricsScreen,
  options: KaraokeOptions,
): void {
  const { size } = options.font;
  const alignment = options.verticalAlignment;
  screen.positionAsSlotCount = undefined;
  if (
    previous.getLineY(0, size, alignment, options) < screen.getLineY(0, size, alignment, options)
  ) {
    screen.positionAsSlotCount = previous.positionAsSlotCount ?? previous.slots;
  }
}

/**
 * Show a staggered screen's early lines at the usual time again,
 * and keep the previous screen's lines in those slots until then.
 */
export function unstagger(previous: LyricsScreen, screen: LyricsScreen): void {
  const early = (s: LyricsScreen) => s.lines.filter((_, i) => s.slotOf(i) < screen.earlySlots);
  for (const line of early(previous)) {
    line.customDisplayEndTime = undefined;
    line.fadeOutDuration = 0;
  }
  for (const line of early(screen)) {
    line.customDisplayStartTime = undefined;
    line.fadeInDuration = 0;
  }
  screen.earlySlots = 0;
  screen.positionAsSlotCount = undefined;
}

/**
 * Place every staggered screen again, once voice lanes have moved the blocks.
 * A screen in a lane is centred in it whatever the alignment, so the first placement no longer holds.
 */
export function placeStaggeredScreens(screens: LyricsScreen[], options: KaraokeOptions): void {
  for (const [i, screen] of screens.entries()) {
    if (i > 0 && screen.staggered) {
      placeStaggeredScreen(screens[i - 1], screen, options);
    }
  }
}

/**
 * A line's stored display period replaces the automatic one, widened to contain what the line draws,
 * count-in included.
 * This runs last, so it sees every count-in and replaces what the staggered-lines pass set.
 * A stored side has no fade, since the user chose when the line appears or disappears.
 */
export function applyStoredDisplayPeriods(screens: LyricsScreen[]): LyricsScreen[] {
  for (const line of screens.flatMap((screen) => screen.lines)) {
    if (line.storedDisplayStart !== undefined) {
      line.customDisplayStartTime = Math.min(line.storedDisplayStart, line.timestamp);
      line.fadeInDuration = 0;
    }
    if (line.storedDisplayEnd !== undefined) {
      line.customDisplayEndTime = Math.max(line.storedDisplayEnd, line.endTimestamp);
      line.fadeOutDuration = 0;
    }
  }
  return screens;
}

export function displayStartOf(line: LyricsLine, screen: LyricsScreen): Timestamp {
  return line.customDisplayStartTime ?? screen.startTimestamp ?? 0;
}

export function displayEndOf(line: LyricsLine, screen: LyricsScreen): Timestamp {
  return line.customDisplayEndTime ?? screen.endTimestamp;
}

/**
 * The earliest time a stored display period shows a line, which the title screen gives way to.
 */
export function earliestStoredStart(screens: LyricsScreen[]): Timestamp | undefined {
  const starts = screens.flatMap((screen) =>
    screen.lines
      .filter((line) => line.storedDisplayStart !== undefined)
      .map((line) => displayStartOf(line, screen)),
  );
  return starts.length > 0 ? Math.min(...starts) : undefined;
}

/**
 * The title screen ends when a stored display period first shows a line.
 * The user asked for the line to be there, and the title is filler.
 */
export function endTitleScreenBy(screens: LyricsScreen[], time: Timestamp | undefined): void {
  const title = screens.find((screen) => screen.kind === "title");
  if (!title || time === undefined) {
    return;
  }
  const start = title.startTimestamp ?? 0;
  // The screen stays even when it loses every line, since it can carry the audio delay.
  title.lines = title.lines.filter((line) => {
    line.customDisplayEndTime = Math.min(displayEndOf(line, title), time);
    return line.customDisplayEndTime > start;
  });
}

/**
 * An instrumental screen only covers the time when no line of its voice is displayed,
 * so stored display periods that reach into the break shorten it, or remove it.
 */
export function fitInstrumentalScreens(screens: LyricsScreen[]): LyricsScreen[] {
  return screens.filter((screen, i) => {
    if (screen.kind !== "instrumental") {
      return true;
    }
    const lyrics = (range: LyricsScreen[]) => range.filter((s) => s.kind === "lyrics");
    const endsBefore = lyrics(screens.slice(0, i)).flatMap((s) =>
      s.lines.map((line) => displayEndOf(line, s)),
    );
    const startsAfter = lyrics(screens.slice(i + 1)).flatMap((s) =>
      s.lines.map((line) => displayStartOf(line, s)),
    );
    const start = Math.max(screen.startTimestamp ?? 0, ...endsBefore);
    const end = Math.min(screen.endTimestamp, ...startsAfter);
    if (end <= start) {
      return false;
    }
    const [bar] = screen.lines[0].segments;
    bar.timestamp = start;
    bar.endTimestamp = end;
    screen.startTimestamp = start;
    return true;
  });
}
