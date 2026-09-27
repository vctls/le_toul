import {
  LYRIC_MARKERS,
  SUBTITLE_CANVAS,
  GLYPH_BLOCK_RATIO,
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_COUNT_IN_TEXT,
  DEFAULT_COUNT_IN_THRESHOLD,
  DEFAULT_COUNT_IN_DURATION,
  DEFAULT_DYNAMIC_COUNT_INS,
} from "@/constants";
import {
  addQuickStartCountIn,
  addGapCountIns,
  addTitleScreen,
  addInstrumentalScreens,
  applyStoredDisplayPeriods,
  displayQuickLinesEarly,
  deferScreenStarts,
  earliestStoredStart,
  endTitleScreenBy,
  fitInstrumentalScreens,
  placeStaggeredScreens,
} from "./adjustments";
import { giveWayToStoredPeriods } from "./screenSlots";
import { BUNDLED_SYMBOLS, FALLBACK_FONTS } from "./fonts";
import { map, method, isNumber } from "lodash-es";
import { default as BuefyColor } from "buefy/src/utils/color";
// This import must stay type-only,
// because timedSegments imports parseLyrics from here at runtime.
import type { TimedSegment } from "./timedSegments";

// "mkv" also carries the vocals and the original mix as extra audio tracks.
export const OUTPUT_FORMATS = ["mp4", "mkv"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Which gaps get a count-in: none at all, only the gap before a screen's first line, or
// the gap before any line.
export const COUNT_IN_MODES = ["none", "screen", "line"] as const;
export type CountInMode = (typeof COUNT_IN_MODES)[number];

export interface KaraokeOptions {
  addTitleScreen: boolean;
  countInMode: CountInMode;
  countInText: string;
  // Draw marks sized to the gap instead of showing countInText for countInDuration.
  // Also changes countInThreshold from the gap a line needs to earn a count-in
  // into the gap that earns a full one.
  dynamicCountIns: boolean;
  countInThreshold: number;
  countInDuration: number;
  addInstrumentalScreens: boolean;
  addStaggeredLines: boolean;
  // When this is off, every line follows the automatic rules, but the stored periods are kept.
  useStoredDisplayPeriods: boolean;
  useBackgroundVideo: boolean;
  outputFormat: OutputFormat;
  verticalAlignment: VerticalAlignment;
  font: {
    size: number;
    name: string;
    bold?: boolean;
    italic?: boolean;
  };
  color: {
    background: BuefyColor;
    primary: BuefyColor;
    secondary: BuefyColor;
  };
}

export enum VerticalAlignment {
  Top,
  Middle,
  Bottom,
}

export const DEFAULT_KARAOKE_OPTIONS: KaraokeOptions = {
  addTitleScreen: true,
  countInMode: DEFAULT_COUNT_IN_MODE,
  countInText: DEFAULT_COUNT_IN_TEXT,
  dynamicCountIns: DEFAULT_DYNAMIC_COUNT_INS,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useStoredDisplayPeriods: true,
  useBackgroundVideo: false,
  outputFormat: "mp4",
  verticalAlignment: VerticalAlignment.Middle,
  font: {
    size: 20,
    name: "Arial Narrow",
  },
  color: {
    background: BuefyColor.parse("black"),
    primary: BuefyColor.parse("#FF00FF"),
    secondary: BuefyColor.parse("#00FFFF"),
  },
};

export interface Segment {
  text: string;
}

interface AssEvent {
  type: string;
  Layer: number;
  Start: string;
  End: string;
  Style: string;
  Name: string;
  MarginL: number;
  MarginR: number;
  MarginV: number;
  Effect: string;
  Text: string;
}

//
// ASS Formatting helpers
//

type Color = [number, number, number, number]; // RGBA?
type Seconds = number;

function toHex(n: number) {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function colorToString(color: Color): string {
  // ASS color format is AABBGGRR for some reason, and alpha 0 is opaque
  return "&H" + color.map(toHex).reverse().join("");
}

export function floatToTimecode(t: number): string {
  // Format t (seconds) as HH:MM:SS.cc. Every field is derived from one rounded centisecond count:
  // rounding the fraction on its own drops the carry at .995 and up, which silently shifts the
  // timecode a second earlier.
  const totalCentiseconds = Math.round(t * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = (totalCentiseconds - centiseconds) / 100;
  const timecodeParts = [
    Math.floor(totalSeconds / 3600).toString(),
    Math.floor((totalSeconds / 60) % 60)
      .toString()
      .padStart(2, "0"),
    [
      (totalSeconds % 60).toString().padStart(2, "0"),
      centiseconds.toString().padStart(2, "0"),
    ].join("."),
  ];
  return timecodeParts.join(":");
}

//
// Lyric classes
//

// A segment's text, then the run of separators that ends it.
const SEGMENT_PATTERN = /([^\n/_]*)([\n/_]*)/g;

/**
 * Parse marked up lyrics into segments.
 * Line breaks separate segments, and blank lines separate screens.
 * Underscores separate segments on word boundaries within a line.
 * Sla/shes separate segments within a word.
 *
 * A run of separators counts as its strongest one,
 * and a segment of whitespace joins the run around it.
 * So `foo_\n` ends a line rather than drawing the underscore,
 * and several blank lines are a single screen break.
 * Whitespace at the end of a segment is a word break,
 * and the last segment has no separator.
 */
export function parseLyrics(lyricsText: string, includeMarkup: boolean = false): Segment[] {
  const segments: { text: string; separators: string }[] = [];
  for (const [, body, separators] of lyricsText.matchAll(SEGMENT_PATTERN)) {
    const text = body.trim();
    const run = /\s$/.test(body) ? "_" + separators : separators;
    if (text !== "") {
      segments.push({ text, separators: run });
    } else if (segments.length > 0) {
      segments[segments.length - 1].separators += run;
    }
  }
  return segments.map(({ text, separators }, i) => ({
    text: i === segments.length - 1 ? text : text + strongestSeparator(separators, includeMarkup),
  }));
}

function strongestSeparator(separators: string, includeMarkup: boolean): string {
  const newlines = separators.split("\n").length - 1;
  if (newlines > 1) {
    return "\n\n";
  }
  if (newlines === 1) {
    return "\n";
  }
  if (separators.includes("_")) {
    return includeMarkup ? "_" : " ";
  }
  if (separators.includes("/")) {
    return includeMarkup ? "/" : "";
  }
  return "";
}

/**
 * The drawn form of a segment's stored text.
 * A trailing `_` is the space between two words.
 * A trailing `/` is an invisible split inside one.
 * Newlines stay: the renderer groups lines on them.
 */
export function displayText(text: string): string {
  if (text.endsWith("_")) {
    return text.slice(0, -1) + " ";
  }
  if (text.endsWith("/")) {
    return text.slice(0, -1);
  }
  return text;
}

function width(segment: TimedSegment): number {
  return Math.max(displayText(segment.text).trim().length, 1);
}

/**
 * Give every hole a start, so a freshly split word doesn't vanish while its syllables are untimed.
 *
 * Only a hole timed on BOTH sides is filled. An untimed head or tail is work not done yet,
 * and filling it would spread an untimed second half of a song across the rest of the track.
 *
 * This runs on the render path only.
 * Nothing is written back, so a hole stays a hole in Adjust and Edit.
 */
export function resolveStarts(segments: TimedSegment[]): TimedSegment[] {
  const resolved = segments.map((segment) => ({ ...segment }));

  let i = 0;
  while (i < resolved.length) {
    if (resolved[i].start !== undefined) {
      i++;
      continue;
    }

    let end = i;
    while (end < resolved.length && resolved[end].start === undefined) {
      end++;
    }

    const before = i > 0 ? resolved[i - 1] : undefined;
    const after = end < resolved.length ? resolved[end] : undefined;
    if (before?.start !== undefined && after?.start !== undefined) {
      // A hole starts after the preceding segment has ended. Anchoring on that segment's start
      // instead would put the hole inside it, which the region layer rejects as an overlap.
      // The anchor is capped at the next start, or an end already dragged past it would move holes backwards.
      const release = before.end === undefined ? undefined : Math.min(before.end, after.start);
      const lower = release ?? before.start;
      // With an explicit end the span belongs to the holes alone. Without one the preceding
      // segment runs into them, so it takes a share too.
      const share = [
        release === undefined ? width(before) : 0,
        ...resolved.slice(i, end).map(width),
      ];
      const total = share.reduce((sum, w) => sum + w, 0);
      const span = after.start - lower;

      let consumed = 0;
      for (let k = i; k < end; k++) {
        consumed += share[k - i];
        resolved[k].start = lower + (span * consumed) / total;
      }
    }

    i = end;
  }

  return resolved;
}

export class LyricSegmentIterator {
  segments: Segment[];
  includeMarkup: boolean;
  constructor(lyrics: string, includeMarkup: boolean = false) {
    this.includeMarkup = includeMarkup;
    this.segments = parseLyrics(lyrics, includeMarkup);
  }

  *[Symbol.iterator](): IterableIterator<Segment> {
    for (let s of this.segments) {
      yield s;
    }
  }
}

export class LyricSegment {
  text: string;
  timestamp: number;
  endTimestamp?: number;

  constructor(text: string, timestamp: number, endTimestamp?: number) {
    this.text = text;
    this.timestamp = timestamp;
    this.endTimestamp = endTimestamp;
  }

  toString(): string {
    return this.text;
  }

  adjustTimestamps(adjustment: number): LyricSegment {
    const newTs = this.timestamp + adjustment;
    const newEndTs = this.endTimestamp === undefined ? undefined : this.endTimestamp + adjustment;
    return new LyricSegment(this.text, newTs, newEndTs);
  }

  toAss() {
    // Render this segment as part of an ASS event line
    const durationInCentiseconds = Math.floor(((this.endTimestamp ?? 0) - this.timestamp) * 100);
    return `{\\kf${durationInCentiseconds}}${this.text}`;
  }
}

export type ScreenKind = "lyrics" | "title" | "instrumental";

export class LyricsScreen {
  lines: LyricsLine[];
  kind: ScreenKind = "lyrics";
  startTimestamp?: Timestamp;
  // Seconds to delay the start of the audio. Only valid on the title screen and first lyrics screen.
  audioDelay: number = 0.0;
  // For staggered timings, this screen's first lines are displayed early, in the slots the previous
  // screen's first lines leave, so the block may be laid out as if it had that screen's line count
  // instead of its own (see placeStaggeredScreens).
  positionAsLineCount?: number;
  // Staggered lines show this screen's first lines while the previous screen is still displayed.
  staggered = false;
  // Multi-voice only: when this screen overlaps another voice in time, it is confined to a
  // vertical "lane" so the voices don't interleave (see createMultiVoiceAssFile). When unset,
  // the screen uses the full height (normal centered/aligned layout).
  verticalZone?: { top: number; height: number } | null = null;

  constructor(lines: LyricsLine[] = [], audioDelay = 0.0) {
    this.lines = lines;
    this.audioDelay = audioDelay;
  }

  get endTimestamp(): Timestamp {
    if (this.lines.length == 0) {
      return this.startTimestamp ?? 0;
    }
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get singStart(): Timestamp {
    return this.lines[0].timestamp;
  }

  get singEnd(): Timestamp {
    return this.lines[this.lines.length - 1].endTimestamp;
  }

  get segments(): LyricSegment[] {
    return this.lines.flatMap((l) => l.segments);
  }

  getLineY(
    lineInScreen: number,
    fontSize: number,
    alignment: VerticalAlignment = VerticalAlignment.Middle,
  ): number {
    // Get the Y coordinate of the top of the given line in the screen
    // Pad screen with 1 line height
    const lineHeight = fontSize * 1.5;
    // The block is normally as tall as this screen's own lines, but a staggered screen is
    // positioned as if it had the previous screen's line count (see positionAsLineCount).
    const lineCount = this.positionAsLineCount ?? this.lines.length;
    // libass draws each line from the top of its slot,
    // so the slack between the glyphs and the 1.5x slot all ends up below the last line.
    // Centre on the glyphs rather than the slots, or the block sits half that slack too high.
    // Lanes use the same block as the screen,
    // so a voice doesn't jump when its screens start or stop overlapping another voice.
    const blockHeight = (lineCount - 1) * lineHeight + fontSize * GLYPH_BLOCK_RATIO;
    let firstLineTopMargin: number;
    // When confined to a lane (overlapping another voice), center the lines within the
    // lane regardless of the global alignment, so each voice stays a contiguous block.
    if (this.verticalZone) {
      const laneMiddle = this.verticalZone.top + this.verticalZone.height / 2;
      firstLineTopMargin = laneMiddle - blockHeight / 2;
    } else {
      switch (alignment) {
        case VerticalAlignment.Top:
          firstLineTopMargin = lineHeight;
          break;
        case VerticalAlignment.Middle:
          const screenMiddle = SUBTITLE_CANVAS.height / 2;
          firstLineTopMargin = screenMiddle - blockHeight / 2;
          break;
        case VerticalAlignment.Bottom:
          firstLineTopMargin = SUBTITLE_CANVAS.height - (lineCount + 1) * lineHeight;
          break;
      }
    }
    return Math.round(firstLineTopMargin + lineInScreen * lineHeight);
  }

  toAssEvents(
    formatParams: Record<string, unknown>,
    videoOptions: KaraokeOptions,
    styleName: string = "Default",
  ) {
    const self = this;
    return (
      this.lines
        .map((l, i) =>
          l.toAssEvent(
            self.startTimestamp ?? 0,
            self.endTimestamp,
            styleName,
            self.getLineY(i, formatParams["Fontsize"] as number, videoOptions.verticalAlignment),
          ),
        )
        .join("\n") + "\n"
    );
  }

  adjustTimestamps(adjustment: number): LyricsScreen {
    const lines = map(this.lines, method("adjustTimestamps", adjustment));
    const screen = new LyricsScreen(lines, this.audioDelay);
    screen.kind = this.kind;
    screen.startTimestamp = this.startTimestamp;
    if (isNumber(this.startTimestamp)) {
      screen.startTimestamp = this.startTimestamp + adjustment;
    }
    // else {
    //   screen.startTimestamp = adjustment;
    // }
    return screen;
  }

  trimDisplayStart(adjustment: number): LyricsScreen {
    // Adjust the start of this screen's display by [adjustment]
    const newStartTime = this.startTimestamp ? this.startTimestamp + adjustment : adjustment;
    if (newStartTime > this.lines[0].timestamp) {
      throw Error(
        `Cannot adjust screen display start by ${adjustment}s: display start is ${this.startTimestamp}, first line animates at ${this.lines[0].timestamp}`,
      );
    }
    const trimmedScreen = new LyricsScreen(this.lines, this.audioDelay);
    trimmedScreen.kind = this.kind;
    trimmedScreen.startTimestamp = newStartTime;
    return trimmedScreen;
  }
}

export class LyricsLine {
  segments: LyricSegment[];

  // Times to start/end display of the line, as opposed to animation. If none, screen start/end times
  // will be used.
  customDisplayStartTime?: Timestamp;
  customDisplayEndTime?: Timestamp;
  fadeInDuration: Seconds = 0.0;
  fadeOutDuration: Seconds = 0.0;
  // The display period the user stored, in the same time base as the segments.
  // It replaces the automatic one once every other pass has run (see applyStoredDisplayPeriods).
  storedDisplayStart?: Timestamp;
  storedDisplayEnd?: Timestamp;
  // The index of the segment that starts this line and holds its stored period.
  headIndex?: number;
  // An automatic bound moved to make way for another line at the same height (see giveWayToStoredPeriods).
  startGaveWay = false;
  endGaveWay = false;

  constructor(segments: LyricSegment[] = []) {
    this.segments = segments;
  }

  toString(): string {
    return `LyricsLine(${this.segments.map((s) => s.toString()).join(" ")})`;
  }

  get timestamp(): Timestamp {
    if (this.segments.length == 0) {
      return 0.0;
    }
    return this.segments[0].timestamp;
  }

  set timestamp(ts: Timestamp) {
    this.segments[0].timestamp = ts;
  }

  get endTimestamp(): Timestamp {
    if (this.segments.length == 0) {
      return this.timestamp;
    }
    return this.segments[this.segments.length - 1].endTimestamp ?? 0;
  }

  addSegmentToFront(newSegment: LyricSegment) {
    this.segments.unshift(newSegment);
  }

  addSegmentsToFront(newSegments: LyricSegment[]) {
    this.segments.unshift(...newSegments);
  }

  decorateAssLine(segments: LyricSegment[], displayStartTime: Timestamp): string {
    // Decorate the line with karaoke tags
    // An ASS line starts with {k<digits>} which is centiseconds within the current
    // line to start animating.
    // That is followed by {\kf<digits>} which is how long to animate the text
    // following the tag.

    // Delay between line display and start of line animation
    let singStartDelay = Math.floor((this.timestamp - displayStartTime) * 100);
    if (singStartDelay < 0) {
      console.error(`Negative line startTime: ${this}: ${singStartDelay}`);
      singStartDelay = 0;
    }
    let line = `{\\k${singStartDelay}}`;
    let previousEnd: number | undefined = undefined;
    for (const s of segments) {
      if (previousEnd !== undefined && previousEnd < s.timestamp) {
        // Insert a blank segment to represent a gap between segments
        const blankSegment = new LyricSegment("", previousEnd, s.timestamp);
        line += blankSegment.toAss();
      }
      line += s.toAss();
      previousEnd = s.endTimestamp;
    }
    return this.addAssFades(line);
  }

  toAssEvent(
    screenStart: Timestamp,
    screenEnd: Timestamp,
    style: string,
    topMargin: number,
  ): string {
    if (isNaN(this.timestamp) || isNaN(screenStart) || isNaN(screenEnd)) {
      console.error("NaN value for line", this.toString(), screenStart, screenEnd);
      throw Error("NaN value for timestamp");
    }
    const displayStart = this.customDisplayStartTime ?? screenStart;
    const displayEnd = this.customDisplayEndTime ?? screenEnd;
    const e: AssEvent = {
      type: "Dialogue",
      Layer: 0,
      Start: floatToTimecode(displayStart),
      End: floatToTimecode(displayEnd),
      Style: style,
      Name: "Singer",
      MarginL: 0,
      MarginR: 0,
      MarginV: topMargin,
      Effect: "",
      Text: this.decorateAssLine(this.segments, displayStart),
    };
    return (
      `${e.type}: ` +
      (
        [
          "Layer",
          "Start",
          "End",
          "Style",
          "Name",
          "MarginL",
          "MarginR",
          "MarginV",
          "Effect",
          "Text",
        ] as (keyof AssEvent)[]
      )
        .map((k) => e[k])
        .join(",")
    );
  }

  addAssFades(assLine: string): string {
    if (this.fadeInDuration == 0 && this.fadeOutDuration == 0) {
      return assLine;
    }
    return (
      `{\\fad(${Math.floor(this.fadeInDuration * 1000)},${Math.floor(this.fadeOutDuration * 1000)})}` +
      assLine
    );
  }

  adjustTimestamps(adjustment: number): LyricsLine {
    const line = new LyricsLine(map(this.segments, method("adjustTimestamps", adjustment)));
    const shift = (time: Timestamp | undefined) =>
      time === undefined ? undefined : time + adjustment;
    line.customDisplayStartTime = shift(this.customDisplayStartTime);
    line.customDisplayEndTime = shift(this.customDisplayEndTime);
    line.storedDisplayStart = shift(this.storedDisplayStart);
    line.storedDisplayEnd = shift(this.storedDisplayEnd);
    line.fadeInDuration = this.fadeInDuration;
    line.fadeOutDuration = this.fadeOutDuration;
    line.headIndex = this.headIndex;
    return line;
  }
}

export type LyricEvent = [number, number];
export type Timestamp = number;

/**
 * Group timed segments into the lines and screens the renderer draws.
 * Each segment carries its own text, so there are no two sequences to keep in step.
 */
export function compileLyricTimings(segments: TimedSegment[]): LyricsScreen[] {
  const screens: LyricsScreen[] = [];
  let screen = new LyricsScreen();
  let line = new LyricsLine();
  // A line's display period lives on its first segment, which may be untimed.
  let head: TimedSegment | undefined;
  let headIndex = 0;
  const closeLine = () => {
    if (line.segments.length > 0) {
      line.storedDisplayStart = head?.displayStart;
      line.storedDisplayEnd = head?.displayEnd;
      line.headIndex = headIndex;
      screen.lines.push(line);
      line = new LyricsLine();
    }
    head = undefined;
  };

  for (const [index, segment] of segments.entries()) {
    const { text, start, end } = segment;
    if (!head) {
      head = segment;
      headIndex = index;
    }
    // An untimed segment draws nothing, but its separator still breaks the line or screen,
    // so the break below runs either way.
    // Empty text means a timing with no lyric (see fromEvents).
    if (start !== undefined && text !== "") {
      line.segments.push(new LyricSegment(displayText(text), start, end));
    }
    if (text.endsWith("\n")) {
      closeLine();
    }
    if (text.endsWith("\n\n") && screen.lines.length > 0) {
      screens.push(screen);
      screen = new LyricsScreen();
    }
  }

  closeLine();
  if (screen.lines.length > 0) {
    screens.push(screen);
  }
  return screens;
}

export function setSegmentEndTimes(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Infer end times of segments if they are not already set, and clamp explicit end times so a segment
  // can't extend past the next one. Within a single voice you can't sing two segments at once,
  // so an end later than the next segment's start (e.g. a release dragged too far in the Adjust tab)
  // would otherwise double-colour two lines at the same time.
  const segments: LyricSegment[] = screens.flatMap((s) => s.lines.flatMap((l) => l.segments));
  segments.forEach((segment, i) => {
    const nextStart = i < segments.length - 1 ? segments[i + 1].timestamp : songDuration;
    if (!segment.endTimestamp) {
      segment.endTimestamp = nextStart;
    } else if (segment.endTimestamp > nextStart) {
      segment.endTimestamp = nextStart;
    }
  });
  return screens;
}

export function setScreenStartTimes(screens: LyricsScreen[]): LyricsScreen[] {
  // Set start times for screens to the end times of the previous screen
  let prevScreen = null;
  for (const screen of screens) {
    if (!prevScreen) {
      screen.startTimestamp = 0.0;
    } else {
      screen.startTimestamp = prevScreen.endTimestamp;
    }
    prevScreen = screen;
  }
  return screens;
}

export function adjustScreenTimestamps(
  screens: LyricsScreen[],
  adjustment: number,
): LyricsScreen[] {
  // Adjust all timings in [screens] forward by [adjustment] seconds.
  return map(screens, method("adjustTimestamps", adjustment));
}

export function denormalizeTimestamps(
  screens: LyricsScreen[],
  songDuration: number,
): LyricsScreen[] {
  // Explicitly set various timestamps
  return setScreenStartTimes(setSegmentEndTimes(screens, songDuration));
}

// Build the display parameters (one ASS style row's fields) for a style named `styleName`.
function buildDisplayParams(formatParams: Object, styleName: string): Record<string, unknown> {
  const displayParams: Record<string, unknown> = {
    Name: styleName,
    Fontname: "Arial Narrow",
    Fontsize: 20,
    PrimaryColour: [255, 0, 255, 255],
    SecondaryColour: [0, 255, 255, 255],
    OutlineColour: [0, 0, 0, 255],
    BackColour: [0, 0, 0, 0],
    Bold: -1,
    Italic: 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0,
    Angle: 0,
    BorderStyle: 1,
    Outline: 0,
    Shadow: 0,
    Alignment: 8,
    MarginL: 0,
    MarginR: 0,
    MarginV: 0,
    Encoding: 0,
    ...formatParams,
  };

  for (const key of ["PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour"]) {
    displayParams[key] = colorToString(displayParams[key] as Color);
  }
  return displayParams;
}

export interface VoiceTrackRender {
  styleName: string;
  displayParams: Record<string, unknown>;
  screens: LyricsScreen[];
  options: KaraokeOptions;
}

// One capture group per fallback font, matching a run of the characters it stands in for.
const FALLBACK_RUN = new RegExp(
  FALLBACK_FONTS.map(({ chars }) => `(${chars}+(?: +${chars}+)*)`).join("|"),
  "gu",
);

// Which of the characters the fallback fonts stand in for each uploaded font can draw, by family name.
// A bundled font draws what BUNDLED_SYMBOLS lists. Any other font counts as drawing none.
export type GlyphCoverage = Readonly<Record<string, ReadonlySet<number>>>;

/**
 * Switch every run of CJK text or symbols outside override blocks to the fallback font for it,
 * unless the style's font can draw the whole run.
 * FFmpeg.wasm's libass has no fontconfig, so it can't fall back to another font on its own.
 */
export function withFallbackFonts(
  events: string,
  fontName: string,
  covered: ReadonlySet<number> = new Set(),
): string {
  const drawable = (word: string) => [...word].every((c) => covered.has(c.codePointAt(0)!));
  return events.replace(/(\{[^}]*\})|[^{]+/g, (chunk, block) =>
    block
      ? chunk
      : chunk.replace(FALLBACK_RUN, (run, ...groups) => {
          const { family } = FALLBACK_FONTS[groups.findIndex((group) => group !== undefined)];
          const tag = (text: string) => `{\\fn${family}}${text}{\\fn}`;
          // Odd indexes hold the spaces between words.
          const parts = run.split(/( +)/);
          const words = parts.filter((_, i) => i % 2 === 0);
          if (family === fontName || words.every(drawable)) {
            return run;
          }
          if (!words.some(drawable)) {
            return tag(run);
          }
          return parts
            .map((part, i) => (i % 2 === 0 && !drawable(part) ? tag(part) : part))
            .join("");
        }),
  );
}

// Render one ASS document from one or more styled tracks. Each track contributes its own
// [V4+ Styles] row and its screens' events, tagged with that track's style. All tracks
// share the same style field set (Format line), since displayParams always has every key.
function renderAssDocument(tracks: VoiceTrackRender[], glyphCoverage: GlyphCoverage): string {
  const formatKeys = Object.keys(tracks[0].displayParams);
  const styleLines = tracks
    .map((t) => `Style: ${formatKeys.map((k) => t.displayParams[k]).join(",")}`)
    .join("\n");
  // The canvas the line positions in getLineY were computed against.
  const videoWidth = SUBTITLE_CANVAS.width;
  const videoHeight = SUBTITLE_CANVAS.height;

  let assText = `[Script Info]
; Script generated by The Tüül - https://the-tuul.com
ScriptType: v4.00+
LayoutResX: ${videoWidth}
LayoutResY: ${videoHeight}
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
YCbCr Matrix: None
WrapStyle: 0

[V4+ Styles]
Format: ${formatKeys.join(", ")}
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const track of tracks) {
    const fontName = track.displayParams.Fontname as string;
    const covered = glyphCoverage[fontName] ?? BUNDLED_SYMBOLS[fontName];
    for (const screen of track.screens) {
      const events = screen.toAssEvents(track.displayParams, track.options, track.styleName);
      assText += withFallbackFonts(events, fontName, covered);
    }
  }
  return assText;
}

function createSubtitles(
  screens: LyricsScreen[],
  options: KaraokeOptions,
  formatParams: Object,
  glyphCoverage: GlyphCoverage,
): string {
  const displayParams = buildDisplayParams(formatParams, "Default");
  return renderAssDocument(
    [{ styleName: "Default", displayParams, screens, options }],
    glyphCoverage,
  );
}

/**
 * One voice's screens as the automatic rules lay them out, before any stored display period applies.
 */
function createAutomaticScreens(
  segments: TimedSegment[],
  songDuration: number,
  title: string,
  artist: string,
  options: KaraokeOptions,
): LyricsScreen[] {
  let screens = compileLyricTimings(resolveStarts(segments));
  if (screens.length === 0) {
    // No lyrics yet (e.g. a timings file was loaded before lyrics were entered). The decorators below
    // index into screens[0], so bail early.
    return screens;
  }
  screens = denormalizeTimestamps(screens, songDuration);
  if (options.countInMode !== "none") {
    screens = addQuickStartCountIn(screens, options);
    screens = addGapCountIns(screens, options);
  }
  if (options.addTitleScreen) {
    screens = addTitleScreen(screens, title, artist);
  }
  if (options.addStaggeredLines) {
    screens = displayQuickLinesEarly(screens, options);
  }
  if (options.addInstrumentalScreens) {
    screens = addInstrumentalScreens(screens, options);
  }
  return screens;
}

/**
 * One voice's screens with its stored display periods applied.
 * Unlike `layOutVoices`, this leaves automatic periods that overlap a stored one as they are.
 */
export function createScreens(
  segments: TimedSegment[],
  songDuration: number,
  title: string,
  artist: string,
  options: KaraokeOptions,
): LyricsScreen[] {
  let screens = createAutomaticScreens(segments, songDuration, title, artist, options);
  if (options.useStoredDisplayPeriods) {
    screens = applyStoredDisplayPeriods(screens);
    endTitleScreenBy(screens, earliestStoredStart(screens));
    screens = fitInstrumentalScreens(screens);
  }
  return screens;
}

// Derive the ASS style format params (font + colors + bold/italic) from karaoke options.
function optionsToFormatParams(options: KaraokeOptions): Record<string, unknown> {
  const primaryColor = options.color.primary;
  const secondaryColor = options.color.secondary;
  const outlineColor = options.color.background;

  const formatParams: Record<string, unknown> = {
    Fontname: options.font.name,
    Fontsize: options.font.size,
    PrimaryColour: [primaryColor.red, primaryColor.green, primaryColor.blue, 0],
    SecondaryColour: [secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0],
    OutlineColour: [outlineColor.red, outlineColor.green, outlineColor.blue, 0],
    BorderStyle: 1,
    Outline: 1,
    Shadow: 0,
  };
  // Only override Bold/Italic when explicitly set, so default output is unchanged.
  // ASS uses -1 for bold-on and 1 for italic-on.
  if (options.font.bold !== undefined) {
    formatParams["Bold"] = options.font.bold ? -1 : 0;
  }
  if (options.font.italic !== undefined) {
    formatParams["Italic"] = options.font.italic ? 1 : 0;
  }
  return formatParams;
}

export function createAssFile(
  segments: TimedSegment[],
  songDuration: number,
  title: string,
  artist: string,
  options: KaraokeOptions,
  glyphCoverage: GlyphCoverage = {},
) {
  // Entry point to subtitles. Creates an .ass file from the given info.
  const [{ screens }] = layOutVoices(
    [{ voice: "", segments, options }],
    songDuration,
    title,
    artist,
  );
  return createSubtitles(screens, options, optionsToFormatParams(options), glyphCoverage);
}

export interface VoiceTrack {
  voice: string;
  segments: TimedSegment[];
  options: KaraokeOptions;
}

// Turn an arbitrary voice id into a valid, unique ASS style name.
function styleNameForVoice(index: number): string {
  return `V${index}`;
}

// Entry point for multi-voice subtitles. Each voice is rendered independently (its own lyrics, timings, and
// style) and composited into one ASS file. This mirrors the core design choice (see frontend/lib/voices.ts):
// a voice is a self-contained single-voice project, so we just run the normal `createScreens` per voice and
// concatenate the resulting dialogue events into one document — ASS handles overlapping events natively,
// which is exactly why independent voices compose cleanly here.
//
// The title and instrumental-break screens are genuinely global (one song, shown once), so only the FIRST
// track contributes them, or else every voice would draw its own and they'd stack. Count-ins, by contrast,
// stay PER VOICE — each voice gets its own "***" lead-in before its lines. Non-first voices have no
// title/instrumental screens to fill the lead-in, so they also get `deferScreenStarts` to stop their
// text displaying from 0:00 when their first line is deep into the song.
function screensOverlapInTime(a: LyricsScreen, b: LyricsScreen): boolean {
  if (a.startTimestamp == null || b.startTimestamp == null) {
    return false;
  }
  return a.startTimestamp < b.endTimestamp && b.startTimestamp < a.endTimestamp;
}

// Per-voice vertical lanes (the "centered alone, lanes when overlapping" layout).
// A screen that is displayed at the same time as any *other* voice's screen is confined to
// its voice's horizontal band (voice 0 on top, voice 1 below, ...), so simultaneous voices
// stack as separate blocks instead of letting libass's collision-avoidance interleave them.
// Screens with no cross-voice overlap keep their default full-height centered layout.
// This runs on the automatic periods, so a stored period never moves a line to another height.
function assignVoiceLanes(renders: VoiceTrackRender[]): void {
  const voiceCount = renders.length;
  if (voiceCount < 2) {
    return;
  }
  const laneHeight = SUBTITLE_CANVAS.height / voiceCount;
  renders.forEach((render, index) => {
    const lane = { top: index * laneHeight, height: laneHeight };
    for (const screen of render.screens) {
      const overlapsOtherVoice = renders.some(
        (other, otherIndex) =>
          otherIndex !== index && other.screens.some((os) => screensOverlapInTime(screen, os)),
      );
      if (overlapsOtherVoice) {
        screen.verticalZone = lane;
      }
    }
    // A staggered screen's early lines share the slots of the previous screen's lines,
    // so the two screens are either both in the lane or both out of it.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [i, screen] of render.screens.entries()) {
        const previous = render.screens[i - 1];
        if (i > 0 && screen.staggered && !previous.verticalZone !== !screen.verticalZone) {
          previous.verticalZone = screen.verticalZone = lane;
          changed = true;
        }
      }
    }
  });
}

/**
 * Every voice's screens as the video lays them out, lanes included, in the order of `tracks`.
 * Heights come from the automatic periods alone, and stored periods only change when lines are shown.
 */
export function layOutVoices(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
): VoiceTrackRender[] {
  const renders: VoiceTrackRender[] = tracks.map((track, index) => {
    const isPrimary = index === 0;
    // The title and instrumental-break screens are global: only the primary voice contributes them.
    // Count-ins stay per voice. Non-primary voices have no title/instrumental to fill long gaps,
    // so cap how early their screens display.
    const options: KaraokeOptions = isPrimary
      ? track.options
      : { ...track.options, addTitleScreen: false, addInstrumentalScreens: false };
    let screens = createAutomaticScreens(track.segments, songDuration, title, artist, options);
    if (!isPrimary) {
      screens = deferScreenStarts(screens);
    }
    const styleName = styleNameForVoice(index);
    return {
      styleName,
      displayParams: buildDisplayParams(optionsToFormatParams(options), styleName),
      screens,
      options,
    };
  });
  assignVoiceLanes(renders);
  for (const render of renders) {
    placeStaggeredScreens(render.screens, render.options);
    if (render.options.useStoredDisplayPeriods) {
      render.screens = fitInstrumentalScreens(applyStoredDisplayPeriods(render.screens));
    }
  }
  // The title screen is global, so it gives way to every voice's stored periods.
  const storedStarts = renders
    .filter((render) => render.options.useStoredDisplayPeriods)
    .map((render) => earliestStoredStart(render.screens))
    .filter((start) => start !== undefined);
  if (renders.length > 0 && storedStarts.length > 0) {
    endTitleScreenBy(renders[0].screens, Math.min(...storedStarts));
  }
  giveWayToStoredPeriods(renders);
  return renders;
}

export function createMultiVoiceAssFile(
  tracks: VoiceTrack[],
  songDuration: number,
  title: string,
  artist: string,
  glyphCoverage: GlyphCoverage = {},
): string {
  if (tracks.length === 0) {
    return "";
  }
  return renderAssDocument(layOutVoices(tracks, songDuration, title, artist), glyphCoverage);
}
