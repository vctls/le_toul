import { LYRIC_MARKERS, VIDEO_SIZE, TITLE_SCREEN_DURATION } from "../constants";
import { addQuickStartCountIn, addScreenCountIns, addTitleScreen, addInstrumentalScreens, displayQuickLinesEarly, deferScreenStarts } from "./adjustments";
import { map, method, isNumber } from "lodash-es";
import { default as BuefyColor } from "buefy/src/utils/color";


export interface KaraokeOptions {
  addTitleScreen: boolean,
  addCountIns: boolean,
  addInstrumentalScreens: boolean,
  addStaggeredLines: boolean,
  useBackgroundVideo: boolean,
  verticalAlignment: VerticalAlignment,
  font: {
    size: number,
    name: string,
    bold?: boolean,
    italic?: boolean
  }
  color: {
    background: BuefyColor,
    primary: BuefyColor,
    secondary: BuefyColor
  }
}

export enum VerticalAlignment {
  Top, Middle, Bottom
}

export const DEFAULT_KARAOKE_OPTIONS: KaraokeOptions = {
  addTitleScreen: true,
  addCountIns: true,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useBackgroundVideo: false,
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
}

interface Segment {
  text: string;
}

interface AssEvent {
  type: string,
  Layer: number,
  Start: string,
  End: string,
  Style: string,
  Name: string,
  MarginL: number,
  MarginR: number,
  MarginV: number,
  Effect: string,
  Text: string
}

//
// ASS Formatting helpers
//

type Color = [number, number, number, number] // RGBA?
type Seconds = number;

function toHex(n: number) { return n.toString(16).toUpperCase().padStart(2, "0") }

function colorToString(color: Color): string {
  // ASS color format is AABBGGRR for some reason, and alpha 0 is opaque
  return "&H" + color.map(toHex).reverse().join("");
}

export function floatToTimecode(t: number): string {
  // Format t (seconds) as HH:MM:SS.ms
  const timecodeParts = [
    Math.floor(t / 3600).toString(),
    Math.floor(t / 60 % 60).toString().padStart(2, "0"),
    [
      Math.floor(t % 60).toString().padStart(2, "0"),
      (t - Math.floor(t)).toFixed(2).slice(2, 4)
    ].join(".")
  ];
  return timecodeParts.join(":")
}

//
// Lyric classes
//

export function parseLyrics(lyricsText: string, includeMarkup: boolean = false): Segment[] {
  // Parse marked up lyrics into segments.
  // Line breaks separate segments.
  // Double line breaks separate screens.
  // Underscores separate segments on word boundaries between a line.
  // Sla/shes separate segments within a word.
  lyricsText = lyricsText.trimStart();
  const segments = [];
  let currentSegment = "";
  for (let i = 0; i < lyricsText.length; i++) {
    let finishSegment = false;
    let char = lyricsText[i];
    if (["\n", "/", "_"].includes(char) || i == lyricsText.length - 1) {
      finishSegment = true;
      if (!includeMarkup) {
        if (char == "/") {
          char = "";
        } else if (char == "_") {
          char = " "
        }
      }
    }
    if (char == "\n" && currentSegment == "" && segments.length > 0) {
      segments[segments.length - 1].text += char;
      continue;
    }
    currentSegment += char;
    if (finishSegment) {
      segments.push({
        text: currentSegment.trimStart(),
      });
      currentSegment = "";
    }
  }
  return segments;
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

export function adjustSegmentTiming(segment: number, timings: Array<LyricEvent>, newValues: { start: number, end?: number }): Array<LyricEvent> {
  // Adjust the timing of a segment. When newValues.end is a number, the
  // segment is given an explicit SEGMENT_END marker (creating one if needed);
  // when it's undefined, any existing SEGMENT_END marker is dropped so the
  // segment runs up against the next one.
  let currentSegment = -1;
  const result: Array<LyricEvent> = [];
  let sawTargetEnd = false;

  const flushPendingEnd = () => {
    if (currentSegment === segment && !sawTargetEnd && isNumber(newValues.end)) {
      result.push([newValues.end, LYRIC_MARKERS.SEGMENT_END]);
      sawTargetEnd = true;
    }
  };

  for (const [t, m] of timings) {
    if (m == LYRIC_MARKERS.SEGMENT_START) {
      // Insert a SEGMENT_END for the target segment if it didn't have one
      // and the caller is introducing one.
      flushPendingEnd();
      currentSegment++;
    }

    if (currentSegment != segment) {
      result.push([t, m]);
      continue;
    }

    if (m == LYRIC_MARKERS.SEGMENT_START) {
      result.push([newValues.start, m]);
    } else if (m == LYRIC_MARKERS.SEGMENT_END) {
      sawTargetEnd = true;
      if (isNumber(newValues.end)) {
        result.push([newValues.end, m]);
      }
      // else: drop the marker. Segment becomes open-ended
    }
  }

  // Target segment is the last one in the array. Flush a pending end.
  flushPendingEnd();

  if (currentSegment < segment) {
    throw new Error(`Segment ${segment} not found in timings`);
  }
  return result;
}

export class LyricSegment {
  text: string;
  timestamp: number;
  endTimestamp?: number;

  constructor(text: string, timestamp: number, endTimestamp: number = null) {
    this.text = text;
    this.timestamp = timestamp;
    this.endTimestamp = endTimestamp;
  }

  toString(): string {
    return this.text;
  }

  adjustTimestamps(adjustment: number): LyricSegment {
    const newTs = this.timestamp + adjustment;
    const newEndTs = this.endTimestamp === null ? null : this.endTimestamp + adjustment;
    return new LyricSegment(this.text, newTs, newEndTs);
  }

  toAss() {
    // Render this segment as part of an ASS event line
    const durationInCentiseconds = Math.floor((this.endTimestamp - this.timestamp) * 100);
    return `{\\kf${durationInCentiseconds}}${this.text}`
  }
}

export class LyricsScreen {
  lines: LyricsLine[];
  startTimestamp?: Timestamp;
  // Seconds to delay the start of the audio. Only valid on the title screen and first lyrics screen.
  audioDelay: number = 0.0;
  // For staggered timings, we might need to adjust the top margin of the first line
  customFirstLineTopMargin?: number = null;
  // Multi-voice only: when this screen overlaps another voice in time, it is confined to
  // a vertical "lane" so the voices don't interleave (see createMultiVoiceAssFile). When
  // unset, the screen uses the full height (normal centered/aligned layout).
  verticalZone?: { top: number; height: number } | null = null;

  constructor(lines: LyricsLine[] = [], audioDelay = 0.0) {
    this.lines = lines;
    this.audioDelay = audioDelay;
  }

  get endTimestamp(): Timestamp {
    if (this.lines.length == 0) {
      return this.startTimestamp;
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
    return this.lines.flatMap(l => l.segments);
  }

  getLineY(lineInScreen: number, fontSize: number, alignment: VerticalAlignment = VerticalAlignment.Middle): number {
    // Get the Y coordinate of the top of the given line in the screen
    // Pad screen with 1 line height
    const lineCount = this.lines.length;
    const lineHeight = fontSize * 1.5;
    // When confined to a lane (overlapping another voice), center the lines within the
    // lane regardless of the global alignment, so each voice stays a contiguous block.
    if (this.verticalZone) {
      const laneMiddle = this.verticalZone.top + this.verticalZone.height / 2;
      const firstLineTopMargin = laneMiddle - (lineCount * lineHeight / 2);
      return Math.round(firstLineTopMargin + (lineInScreen * lineHeight));
    }
    let firstLineTopMargin = this.customFirstLineTopMargin;
    if (firstLineTopMargin === null) {
      switch (alignment) {
        case VerticalAlignment.Top:
          firstLineTopMargin = lineHeight;
          break;
        case VerticalAlignment.Middle:
          const screenMiddle = VIDEO_SIZE.height / 2;
          firstLineTopMargin = screenMiddle - (lineCount * lineHeight / 2)
          break;
        case VerticalAlignment.Bottom:
          firstLineTopMargin = VIDEO_SIZE.height - ((lineCount + 1) * lineHeight);
          break;
      }
    }
    return Math.round(firstLineTopMargin + (lineInScreen * lineHeight))
  }

  toAssEvents(formatParams: Object, videoOptions: KaraokeOptions, styleName: string = "Default") {
    const self = this;
    return this.lines.map((l, i) => l.toAssEvent(self.startTimestamp, self.endTimestamp, styleName, self.getLineY(i, formatParams["Fontsize"], videoOptions.verticalAlignment))).join("\n") + "\n";
  }

  adjustTimestamps(adjustment: number): LyricsScreen {
    const lines = map(this.lines, method('adjustTimestamps', adjustment));
    const screen = new LyricsScreen(lines, this.audioDelay);
    screen.startTimestamp = this.startTimestamp;
    if (isNumber(screen.startTimestamp)) {
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
      throw Error(`Cannot adjust screen display start by ${adjustment}s: display start is ${this.startTimestamp}, first line animates at ${this.lines[0].timestamp}`);
    }
    const trimmedScreen = new LyricsScreen(this.lines, this.audioDelay);
    trimmedScreen.startTimestamp = newStartTime;
    return trimmedScreen;
  }
}

export class LyricsLine {

  segments: LyricSegment[];

  // Times to start/end display of the line, as opposed to animation.
  // If none, screen start/end times will be used.
  customDisplayStartTime?: Timestamp = null;
  customDisplayEndTime?: Timestamp = null;
  fadeInDuration: Seconds = 0.0;
  fadeOutDuration: Seconds = 0.0;

  constructor(segments: LyricSegment[] = []) {
    this.segments = segments;
  }

  toString(): string {
    return `LyricsLine(${this.segments.map(s => s.toString()).join(" ")})`;
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
    return this.segments[this.segments.length - 1].endTimestamp;
  }

  addSegmentToFront(newSegment: LyricSegment) {
    this.segments.unshift(newSegment);
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
    let previousEnd = null;
    for (const s of segments) {
      if (previousEnd !== null && previousEnd < s.timestamp) {
        // Insert a blank segment to represent a gap between segments
        const blankSegment = new LyricSegment("", previousEnd, s.timestamp)
        line += blankSegment.toAss()
      }
      line += s.toAss()
      previousEnd = s.endTimestamp;
    }
    return this.addAssFades(line);
  }

  toAssEvent(screenStart: Timestamp, screenEnd: Timestamp, style: string, topMargin: number): string {
    if (isNaN(this.timestamp) || isNaN(screenStart) || isNaN(screenEnd)) {
      console.error("NaN value for line", this.toString(), screenStart, screenEnd);
      throw Error("NaN value for timestamp");
    }
    const displayStart = this.customDisplayStartTime || screenStart;
    const displayEnd = this.customDisplayEndTime || screenEnd;
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
      Text: this.decorateAssLine(this.segments, displayStart)
    }
    return `${e.type}: ` + ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"].map(k => e[k]).join(",");
  }

  addAssFades(assLine: string): string {
    if (this.fadeInDuration == 0 && this.fadeOutDuration == 0) {
      return assLine;
    }
    return `{\\fad(${Math.floor(this.fadeInDuration * 1000)},${Math.floor(this.fadeOutDuration * 1000)})}` + assLine
  }

  adjustTimestamps(adjustment: number): LyricsLine {
    const segments = map(this.segments, method('adjustTimestamps', adjustment))
    return new LyricsLine(segments);
  }

}

export type LyricEvent = [number, number]
export type Timestamp = number

export function compileLyricTimings(lyrics: string, events: LyricEvent[]): LyricsScreen[] {
  // Read keyboard events in the order they were pressed and construct
  // objects for screens and lines that include the given timing information.
  const segments = (new LyricSegmentIterator(lyrics))[Symbol.iterator]();
  const screens = [];
  let previousSegment = null;
  let line = null;
  let screen = null;

  if (lyrics.length == 0 || events.length == 0) {
    return [];
  }

  try {
    for (const e of events) {
      const timestamp = e[0];
      const marker = e[1];
      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        const nextSegment = segments.next();
        if (nextSegment.done) {
          console.error("compileLyricTimings: More SEGMENT_START events than lyric segments available", {
            lyrics, totalEvents: events.length, currentScreens: screens.length
          });
          break;
        }
        const segmentText = nextSegment.value.text;
        const segment = new LyricSegment(segmentText, timestamp);
        if (!screen) {
          screen = new LyricsScreen();
        }
        if (!line) {
          line = new LyricsLine();
        }
        line.segments.push(segment);
        if (segmentText.endsWith("\n")) {
          screen.lines.push(line);
          line = null;
        }
        if (segmentText.endsWith("\n\n")) {
          screens.push(screen);
          screen = null;
        }
        previousSegment = segment;
      } else if (marker == LYRIC_MARKERS.SEGMENT_END) {
        if (previousSegment !== null) {
          previousSegment.endTimestamp = timestamp;
        }
      }
    }

    if (line !== null) {
      screen.lines.push(line);
    }
    if (screen !== null && screen.lines.length > 0) {
      screens.push(screen);
    }
  } catch (e) {
    console.error("compileLyricTimings error", e, lyrics, events);
  }
  return screens;
}

export function setSegmentEndTimes(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
  // Infer end times of segments if they are not already set, and clamp explicit end times
  // so a segment can't extend past the next one. Within a single voice you can't sing two
  // segments at once, so an end later than the next segment's start (e.g. a release dragged
  // too far in the Adjust tab) would otherwise double-colour two lines at the same time.
  const segments: LyricSegment[] = screens.flatMap(s => s.lines.flatMap(l => l.segments));
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

export function adjustScreenTimestamps(screens: LyricsScreen[], adjustment: number): LyricsScreen[] {
  // Adjust all timings in [screens] forward by [adjustment] seconds.
  return map(screens, method('adjustTimestamps', adjustment));
}

export function denormalizeTimestamps(screens: LyricsScreen[], songDuration: number): LyricsScreen[] {
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
    ...formatParams
  };

  for (const key of ["PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour"]) {
    displayParams[key] = colorToString(displayParams[key] as Color);
  }
  return displayParams;
}

interface VoiceTrackRender {
  styleName: string;
  displayParams: Record<string, unknown>;
  screens: LyricsScreen[];
  options: KaraokeOptions;
}

// Render one ASS document from one or more styled tracks. Each track contributes its own
// [V4+ Styles] row and its screens' events, tagged with that track's style. All tracks
// share the same style field set (Format line), since displayParams always has every key.
function renderAssDocument(tracks: VoiceTrackRender[]): string {
  const formatKeys = Object.keys(tracks[0].displayParams);
  const styleLines = tracks
    .map((t) => `Style: ${formatKeys.map((k) => t.displayParams[k]).join(",")}`)
    .join("\n");
  // libass default values
  const videoWidth = 384;
  const videoHeight = 288;

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
`
  for (const track of tracks) {
    for (const screen of track.screens) {
      assText += screen.toAssEvents(track.displayParams, track.options, track.styleName)
    }
  }
  return assText;
}

function createSubtitles(screens: LyricsScreen[], options: KaraokeOptions, formatParams: Object): string {
  const displayParams = buildDisplayParams(formatParams, "Default");
  return renderAssDocument([{ styleName: "Default", displayParams, screens, options }]);
}

export function createScreens(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string, options: KaraokeOptions): LyricsScreen[] {
  let screens = compileLyricTimings(lyrics, lyricEvents);
  if (screens.length === 0) {
    // No lyrics yet (e.g. a timings file was loaded before lyrics were
    // entered). The decorators below index into screens[0], so bail early.
    return screens;
  }
  screens = denormalizeTimestamps(screens, songDuration);
  if (options.addCountIns) {
    screens = addQuickStartCountIn(screens);
    screens = addScreenCountIns(screens);
  }
  if (options.addTitleScreen) {
    screens = addTitleScreen(screens, title, artist);
  }
  if (options.addStaggeredLines) {
    screens = displayQuickLinesEarly(screens, options);
  }
  if (options.addInstrumentalScreens) {
    screens = addInstrumentalScreens(screens);
  }
  return screens
}

// Derive the ASS style format params (font + colors + bold/italic) from karaoke options.
function optionsToFormatParams(options: KaraokeOptions): Record<string, unknown> {
  const primaryColor = options.color.primary;
  const secondaryColor = options.color.secondary;
  const outlineColor = options.color.background;

  const formatParams: Record<string, unknown> = {
    "Fontname": options.font.name,
    "Fontsize": options.font.size,
    "PrimaryColour": [primaryColor.red, primaryColor.green, primaryColor.blue, 0],
    "SecondaryColour": [secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0],
    "OutlineColour": [outlineColor.red, outlineColor.green, outlineColor.blue, 0],
    "BorderStyle": 1,
    "Outline": 1,
    "Shadow": 0,
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

export function createAssFile(lyrics: string, lyricEvents: LyricEvent[], songDuration: number, title: string, artist: string, options: KaraokeOptions) {
  // Entry point to subtitles. Creates an .ass file from the given info.
  const screensWithTitle = createScreens(lyrics, lyricEvents, songDuration, title, artist, options);
  return createSubtitles(screensWithTitle, options, optionsToFormatParams(options));
}

export interface VoiceTrack {
  voice: string;
  lyrics: string;
  timings: LyricEvent[];
  options: KaraokeOptions;
}

// Turn an arbitrary voice id into a valid, unique ASS style name.
function styleNameForVoice(index: number): string {
  return `V${index}`;
}

// Entry point for multi-voice subtitles. Each voice is rendered independently (its own
// lyrics, timings, and style) and composited into one ASS file. This mirrors the core
// design choice (see frontend/lib/voices.ts): a voice is a self-contained single-voice
// project, so we just run the normal `createScreens` per voice and concatenate the
// resulting dialogue events into one document — ASS handles overlapping events natively,
// which is exactly why independent voices compose cleanly here.
//
// The title and instrumental-break screens are genuinely global (one song, shown once),
// so only the FIRST track contributes them; otherwise every voice would draw its own and
// they'd stack. Count-ins, by contrast, stay PER VOICE — each voice gets its own "***"
// lead-in before its lines. Non-first voices have no title/instrumental screens to fill
// the lead-in, so they also get `deferScreenStarts` to stop their text displaying from
// 0:00 when their first line is deep into the song.
function screensOverlapInTime(a: LyricsScreen, b: LyricsScreen): boolean {
  if (a.startTimestamp == null || b.startTimestamp == null) {
    return false;
  }
  return a.startTimestamp < b.endTimestamp && b.startTimestamp < a.endTimestamp;
}

// Per-voice vertical lanes (the "centered alone, lanes when overlapping" layout). A screen
// that is displayed at the same time as any *other* voice's screen is confined to its
// voice's horizontal band (voice 0 on top, voice 1 below, ...), so simultaneous voices
// stack as separate blocks instead of letting libass's collision-avoidance interleave
// them. Screens with no cross-voice overlap keep their default full-height centered layout.
function assignVoiceLanes(renders: VoiceTrackRender[]): void {
  const voiceCount = renders.length;
  if (voiceCount < 2) {
    return;
  }
  const laneHeight = VIDEO_SIZE.height / voiceCount;
  renders.forEach((render, index) => {
    for (const screen of render.screens) {
      const overlapsOtherVoice = renders.some(
        (other, otherIndex) =>
          otherIndex !== index && other.screens.some((os) => screensOverlapInTime(screen, os))
      );
      if (overlapsOtherVoice) {
        screen.verticalZone = { top: index * laneHeight, height: laneHeight };
      }
    }
  });
}

export function createMultiVoiceAssFile(tracks: VoiceTrack[], songDuration: number, title: string, artist: string): string {
  if (tracks.length === 0) {
    return "";
  }
  const renders: VoiceTrackRender[] = tracks.map((track, index) => {
    const isPrimary = index === 0;
    // The title and instrumental-break screens are global: only the primary voice
    // contributes them. Count-ins stay per voice. Non-primary voices have no
    // title/instrumental to fill long gaps, so cap how early their screens display.
    const options: KaraokeOptions = isPrimary
      ? track.options
      : { ...track.options, addTitleScreen: false, addInstrumentalScreens: false };
    let screens = createScreens(track.lyrics, track.timings, songDuration, title, artist, options);
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
  return renderAssDocument(renders);
}