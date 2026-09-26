// Conversion between a Karaoke Builder Studio project and the three files the app reads and writes:
// lyrics.txt, timings.json and settings.yaml.
// The app only ever sees those files, so nothing here touches a store.

import yaml from "js-yaml";
import { SUBTITLE_CANVAS } from "@/constants";
import {
  KbpDocument,
  KbpLine,
  KbpPage,
  KbpStyle,
  KbpSyllable,
  parseKbp,
  serializeKbp,
} from "./kbp";
import { parseLyrics } from "./timing";
import { TimedSegment, TimingsFile, TIMINGS_FILE_VERSION } from "./timedSegments";
import { DEFAULT_VOICE_ID, parseAnnotatedLyrics, TAG_PATTERN, VoiceId } from "./voices";
import { ParsedSettingsFile, parseSettingsYaml } from "./settingsFile";
import { convertSpacesToUnderscores } from "./lyrics";
import { BRACKETS_REMOVED, MARKUP_REMOVED, SPACER_DROPPED, Warnings } from "./importWarnings";

// kbp2ass scales a KBP font size by the output height over the 216-high CDG canvas, and by 1.4
// for the difference between the two font size conventions.
const FONT_SCALE = (SUBTITLE_CANVAS.height / 216) * 1.4;

// KBS's own timing, as measured on its files: a line shows 3 s before its page's first syllable
// and hides 0.5 s after its own last one.
const LINE_LEAD_CS = 300;
const LINE_TAIL_CS = 50;

const MAX_STYLES = 20;
// kbputils' page size when it builds a .kbp. KBS's real limit depends on the font and margins.
const COMFORTABLE_LINES_PER_PAGE = 6;

// KBS's default palette, which fills the entries an export doesn't use.
// prettier-ignore
const DEFAULT_PALETTE = [
  "055", "FFF", "000", "E70", "940", "CFF", "033", "0DD",
  "077", "FCF", "303", "F3F", "818", "000", "FFF", "000",
];

const EXPORT_COMMENT = "Exported from The Tüül";

export interface ProjectFiles {
  lyrics: string;
  timings: TimingsFile;
  settings: string;
}

export interface KbpImport extends ProjectFiles {
  // The basename of the song the project was made with, which the .kbp doesn't carry.
  audioName: string | null;
  warnings: string[];
}

export interface KbpExportSource extends ProjectFiles {
  audioName: string | null;
}

export interface KbpExport {
  kbp: string;
  warnings: string[];
}

function toHexColor(kbpColor: string): string {
  return "#" + [...kbpColor.toUpperCase()].map((digit) => digit + digit).join("");
}

function toKbpColor(hexColor: string): string {
  const channels = hexColor.replace("#", "").match(/../g) ?? ["00", "00", "00"];
  return channels
    .map((channel) => Math.round(parseInt(channel, 16) / 17).toString(16))
    .join("")
    .toUpperCase();
}

function basename(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.trim();
  return name ? name : null;
}

interface ImportedSyllable {
  // The segment text without its separator, as parseLyrics will yield it.
  word: string;
  wordEnd: boolean;
  start?: number;
  end?: number;
}

function styleFor(document: KbpDocument, letter: string, warnings: Warnings): KbpStyle {
  const number = letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
  const style = document.styles.find((s) => s.number === number);
  if (style) {
    return style;
  }
  warnings.add(`Lines in an undefined style ${letter.toUpperCase()} use Style00`);
  return document.styles.find((s) => s.number === 0) ?? document.styles[0];
}

/**
 * The line's syllables as segment words. Spaces around a syllable become word boundaries,
 * and characters that are lyric markup in the app are removed.
 */
function importSyllables(
  line: KbpLine,
  style: KbpStyle,
  isPageStart: boolean,
  warnings: Warnings,
): ImportedSyllable[] {
  const fixed = line.style === line.style.toLowerCase();
  const syllables: ImportedSyllable[] = [];

  line.syllables.forEach((syllable: KbpSyllable, index) => {
    let text = syllable.text;
    if (/[/_]/.test(text)) {
      warnings.add(MARKUP_REMOVED);
      text = text.replace(/[/_]/g, "");
    }
    if (style.uppercase) {
      text = text.toUpperCase();
    }

    const word = text.trim();
    if (index === 0 && isPageStart && word !== "" && !/[\p{L}\p{N}]/u.test(word)) {
      warnings.add(
        `A lead-in syllable "${word}" was dropped, since the app draws its own count-ins`,
      );
      return;
    }
    const previous = syllables[syllables.length - 1];
    if (previous && /^\s/.test(text)) {
      previous.wordEnd = true;
    }
    if (word === "") {
      return;
    }
    syllables.push({
      word,
      wordEnd: /\s$/.test(text),
      ...(fixed ? {} : { start: syllable.start, end: syllable.end }),
    });
  });

  if (fixed && syllables.length > 0) {
    warnings.add("A fixed line was imported untimed, since the app has no text without a wipe");
  }
  return syllables;
}

function lineMarkup(syllables: ImportedSyllable[]): string {
  return syllables
    .map((s, i) => (i === syllables.length - 1 ? s.word : s.word + (s.wordEnd ? "_" : "/")))
    .join("");
}

/**
 * Style names become voice tags, where `+` separates voices and brackets delimit the tag.
 */
function voiceNames(styles: KbpStyle[]): Map<number, VoiceId> {
  const names = new Map<number, VoiceId>();
  const taken = new Set<string>();
  for (const style of styles) {
    const base =
      style.name
        .replace(/[+[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || `Style ${style.number}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) {
      name = `${base} ${n}`;
    }
    taken.add(name);
    names.set(style.number, name);
  }
  return names;
}

/**
 * KBS always writes an end, usually at the next start or 1 cs before it.
 * Such an end is left open, or the renderer would draw a 1 cs gap between the two syllables.
 */
function toSegmentTimes(syllables: ImportedSyllable[]): void {
  const timed = syllables.filter((s) => s.start !== undefined);
  timed.forEach((syllable, i) => {
    const next = timed[i + 1];
    const start = syllable.start as number;
    const end = syllable.end as number;
    const open = next !== undefined && end >= (next.start as number) - 1;
    syllable.start = start / 100;
    syllable.end = open || end <= start ? undefined : end / 100;
  });
}

function segmentWord(text: string): string {
  return text.replace(/(\n\n|[\n/_])$/, "").trim();
}

function styleSettings(
  document: KbpDocument,
  base: KbpStyle | undefined,
  voiceStyles: [VoiceId, KbpStyle][],
  fonts: string[],
  warnings: Warnings,
): Record<string, unknown> {
  const color = (index: number) => toHexColor(document.palette[index] ?? "000");
  const fontName = (style: KbpStyle): string | undefined => {
    if (fonts.includes(style.fontName)) {
      return style.fontName;
    }
    warnings.add(`The font "${style.fontName}" isn't bundled with the app, so it was left out`);
    return undefined;
  };
  const fontSize = (style: KbpStyle) => Math.round(style.fontSize * FONT_SCALE);

  const videoOptions: Record<string, unknown> = {
    color: { background: color(0) },
  };
  if (base) {
    const name = fontName(base);
    videoOptions.font = {
      ...(name ? { name } : {}),
      size: fontSize(base),
      bold: base.fontStyle.includes("B"),
      italic: base.fontStyle.includes("I"),
    };
    videoOptions.color = {
      background: color(0),
      primary: color(base.colors[2]),
      secondary: color(base.colors[0]),
    };
  }

  const overrides: Record<VoiceId, Record<string, unknown>> = {};
  for (const [voice, style] of voiceStyles) {
    if (!base || style === base) continue;
    const override: Record<string, unknown> = {};
    const name = style.fontName !== base.fontName ? fontName(style) : undefined;
    if (name) override.fontName = name;
    if (style.fontSize !== base.fontSize) override.fontSize = fontSize(style);
    const bold = style.fontStyle.includes("B");
    const italic = style.fontStyle.includes("I");
    if (bold !== base.fontStyle.includes("B")) override.bold = bold;
    if (italic !== base.fontStyle.includes("I")) override.italic = italic;
    if (style.colors[2] !== base.colors[2]) override.primary = color(style.colors[2]);
    if (style.colors[0] !== base.colors[0]) override.secondary = color(style.colors[0]);
    if (style.colors[1] !== base.colors[1]) override.outline = color(style.colors[1]);
    if (Object.keys(override).length > 0) overrides[voice] = override;
  }

  return { videoOptions, voiceStyles: overrides };
}

function settingsYaml(document: KbpDocument, styles: Record<string, unknown>): string {
  const song: Record<string, string> = {};
  if (document.trackInfo.Title) song.title = document.trackInfo.Title;
  if (document.trackInfo.Artist) song.artist = document.trackInfo.Artist;
  return yaml.dump({ song, ...styles });
}

function unsyncedLyrics(lines: string[]): string {
  return lines
    .map((line) => convertSpacesToUnderscores(line.trimEnd()))
    .join("\n")
    .trim();
}

/**
 * Throws when the file isn't a KBS project, or when the converter would produce timings that don't
 * line up with the lyrics it produced.
 */
export function kbpToProjectFiles(text: string, options: { fonts: string[] }): KbpImport {
  const document = parseKbp(text);
  const warnings = new Warnings();
  const audioName = basename(document.trackInfo.Audio ?? "");

  if (document.pages.some((page) => page.transition !== null)) {
    warnings.add("Page transitions were dropped");
  }
  if (document.images.length > 0) {
    warnings.add("The background slideshow was dropped");
  }
  if (document.mods !== null) {
    warnings.add("Pitch and speed changes were dropped");
  }

  // Styles in the order lines first use them.
  const used: KbpStyle[] = [];
  const pages = document.pages.map((page) =>
    page.lines.map((line) => {
      const style = styleFor(document, line.style, warnings);
      if (!used.includes(style)) used.push(style);
      if (line.align !== "C" || line.right !== 0 || line.down !== 0 || line.rotation !== 0) {
        warnings.add("Line positions were dropped, since the app lays out its own screens");
      }
      return { line, style };
    }),
  );
  const names = voiceNames(used);
  const multiVoice = used.length > 1;
  const voiceOf = (style: KbpStyle): VoiceId =>
    multiVoice ? (names.get(style.number) as VoiceId) : DEFAULT_VOICE_ID;

  const pageTexts: string[] = [];
  const syllablesByVoice: Record<VoiceId, ImportedSyllable[]> = {};
  let previousVoice: VoiceId | null = null;
  for (const lines of pages) {
    const lineTexts: string[] = [];
    for (const { line, style } of lines) {
      const syllables = importSyllables(line, style, lineTexts.length === 0, warnings);
      if (syllables.length === 0) {
        warnings.add(SPACER_DROPPED);
        continue;
      }
      let markup = lineMarkup(syllables);
      if (markup.startsWith("[")) {
        warnings.add(BRACKETS_REMOVED);
        markup = markup.replace(/[[\]]/g, "");
        syllables.forEach((s) => (s.word = s.word.replace(/[[\]]/g, "")));
      }
      const voice = voiceOf(style);
      if (multiVoice && voice !== previousVoice) {
        markup = `[${voice}] ${markup}`;
      }
      previousVoice = voice;
      lineTexts.push(markup);
      (syllablesByVoice[voice] ??= []).push(...syllables);
    }
    if (lineTexts.length > 0) {
      pageTexts.push(lineTexts.join("\n"));
    }
  }

  const lyrics = document.unsyncedLyrics
    ? unsyncedLyrics(document.unsyncedLyrics)
    : pageTexts.join("\n\n");

  const timings: TimingsFile = { version: TIMINGS_FILE_VERSION, voices: {} };
  const annotated = parseAnnotatedLyrics(lyrics);
  for (const [voice, syllables] of Object.entries(syllablesByVoice)) {
    toSegmentTimes(syllables);
    const segments = parseLyrics(annotated.lyricTextByVoice[voice] ?? "", true);
    const mismatch =
      segments.length !== syllables.length ||
      segments.some((segment, i) => segmentWord(segment.text) !== syllables[i].word);
    if (mismatch) {
      throw new Error(`The converted timings for ${voice} don't line up with its lyrics.`);
    }
    timings.voices[voice] = segments.map(({ text }, i): TimedSegment => {
      const { start, end } = syllables[i];
      return {
        text,
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
      };
    });
  }

  const base =
    used.find((s) => s.number === 0) ?? used[0] ?? document.styles.find((s) => s.number === 0);
  const styles = styleSettings(
    document,
    base,
    used.map((style) => [voiceOf(style), style]),
    options.fonts,
    warnings,
  );

  return {
    lyrics,
    timings,
    settings: settingsYaml(document, styles),
    audioName,
    warnings: warnings.list(),
  };
}

interface ExportStyle {
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  text: string;
  wipe: string;
  outline: string;
}

interface ExportLine {
  voiceIndex: number;
  syllables: KbpSyllable[];
}

interface ExportPage {
  lines: ExportLine[];
  first: number;
  last: number;
}

function exportStyles(
  { videoOptions, voiceStyles = {} }: ParsedSettingsFile,
  voices: VoiceId[],
): ExportStyle[] {
  const base: ExportStyle = {
    fontName: videoOptions.font?.name ?? "Arial",
    fontSize: videoOptions.font?.size ?? 20,
    // The app draws bold unless told otherwise.
    bold: videoOptions.font?.bold ?? true,
    italic: videoOptions.font?.italic ?? false,
    text: videoOptions.color?.secondary?.toString() ?? "#00FFFF",
    wipe: videoOptions.color?.primary?.toString() ?? "#FF00FF",
    outline: videoOptions.color?.background?.toString() ?? "#000000",
  };
  const styles = voices.map((voice): ExportStyle => {
    const o = voiceStyles[voice] ?? {};
    return {
      fontName: o.fontName ?? base.fontName,
      fontSize: o.fontSize ?? base.fontSize,
      bold: o.bold ?? base.bold,
      italic: o.italic ?? base.italic,
      text: o.secondary?.toString() ?? base.text,
      wipe: o.primary?.toString() ?? base.wipe,
      outline: o.outline?.toString() ?? base.outline,
    };
  });
  return styles.length > 0 ? styles : [base];
}

/**
 * Entry 0 is the screen background, which the app draws in its outline colour.
 */
class Palette {
  colors: string[];
  private full = false;

  constructor(
    background: string,
    private warnings: Warnings,
  ) {
    this.colors = [toKbpColor(background)];
  }

  indexOf(hexColor: string): number {
    const color = toKbpColor(hexColor);
    const found = this.colors.indexOf(color);
    if (found !== -1) {
      return found;
    }
    if (this.colors.length < 16) {
      this.colors.push(color);
      return this.colors.length - 1;
    }
    if (!this.full) {
      this.full = true;
      this.warnings.add("The styles use more than 16 colours, so some take the nearest one");
    }
    return this.nearest(color);
  }

  private nearest(color: string): number {
    const rgb = (c: string) => [...c].map((d) => parseInt(d, 16));
    const target = rgb(color);
    let best = 0;
    let bestDistance = Infinity;
    this.colors.forEach((candidate, i) => {
      const distance = rgb(candidate).reduce((sum, v, k) => sum + (v - target[k]) ** 2, 0);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  entries(): string[] {
    return [...this.colors, ...DEFAULT_PALETTE.slice(this.colors.length)];
  }
}

/**
 * A voice's timed segments grouped into pages of lines by their separators.
 * Untimed segments are left out, and an open end runs to 1 cs before the next start, as KBS writes it.
 */
function voicePages(
  segments: TimedSegment[],
  voiceIndex: number,
  durationCs: number | null,
): ExportPage[] {
  const pages: ExportPage[] = [];
  let lines: ExportLine[] = [];
  let syllables: KbpSyllable[] = [];
  const all: { syllable: KbpSyllable; end?: number }[] = [];

  const closeLine = () => {
    if (syllables.length > 0) {
      const last = syllables[syllables.length - 1];
      last.text = last.text.trimEnd();
      lines.push({ voiceIndex, syllables });
    }
    syllables = [];
  };
  const closePage = () => {
    closeLine();
    if (lines.length > 0) {
      pages.push({ lines, first: 0, last: 0 });
    }
    lines = [];
  };

  for (const segment of segments) {
    const text = segment.text.replace(/\n+$/, "").replace(/_$/, " ").replace(/\/$/, "");
    if (segment.start !== undefined && text.trim() !== "") {
      const syllable: KbpSyllable = {
        text,
        start: Math.round(segment.start * 100),
        end: 0,
        wipe: 0,
      };
      syllables.push(syllable);
      all.push({
        syllable,
        end: segment.end === undefined ? undefined : Math.round(segment.end * 100),
      });
    }
    if (segment.text.endsWith("\n\n")) {
      closePage();
    } else if (segment.text.endsWith("\n")) {
      closeLine();
    }
  }
  closePage();

  all.forEach(({ syllable, end }, i) => {
    const next = all[i + 1]?.syllable.start;
    if (next !== undefined) {
      syllable.end = end !== undefined && end < next ? end : Math.max(next - 1, syllable.start);
    } else {
      syllable.end =
        end ??
        (durationCs !== null && durationCs > syllable.start ? durationCs : syllable.start + 100);
    }
  });

  for (const page of pages) {
    const pageSyllables = page.lines.flatMap((line) => line.syllables);
    page.first = Math.min(...pageSyllables.map((s) => s.start));
    page.last = Math.max(...pageSyllables.map((s) => s.end));
  }
  return pages;
}

/**
 * Pages of different voices that overlap in time share one KBS page, with each voice's lines kept together.
 */
function mergePages(pages: ExportPage[]): ExportPage[] {
  const sorted = [...pages].sort((a, b) => a.first - b.first);
  const merged: ExportPage[] = [];
  for (const page of sorted) {
    const current = merged[merged.length - 1];
    if (current && page.first <= current.last) {
      current.lines.push(...page.lines);
      current.last = Math.max(current.last, page.last);
    } else {
      merged.push({ ...page, lines: [...page.lines] });
    }
  }
  for (const page of merged) {
    page.lines.sort(
      (a, b) => a.voiceIndex - b.voiceIndex || a.syllables[0].start - b.syllables[0].start,
    );
  }
  return merged;
}

/**
 * A line shows 3 s before its page starts, or once the line in its slot on the previous page has gone,
 * whichever is later, and never after its own first syllable.
 */
function layOutLines(pages: ExportPage[]): KbpPage[] {
  let previous: KbpLine[] = [];
  return pages.map((page) => {
    const lines = page.lines.map((line, slot): KbpLine => {
      const first = line.syllables[0].start;
      const last = line.syllables[line.syllables.length - 1].end;
      const before = previous[Math.min(slot, previous.length - 1)];
      const start = Math.min(
        first,
        Math.max(0, page.first - LINE_LEAD_CS, before ? before.end + 1 : 0),
      );
      return {
        align: "C",
        style: String.fromCharCode("A".charCodeAt(0) + Math.min(line.voiceIndex, MAX_STYLES - 1)),
        start,
        end: last + LINE_TAIL_CS,
        right: 0,
        down: 0,
        rotation: 0,
        syllables: line.syllables,
      };
    });
    previous = lines;
    return { transition: null, lines };
  });
}

export function projectFilesToKbp(source: KbpExportSource): KbpExport {
  const warnings = new Warnings();
  const settings = parseSettingsYaml(source.settings);
  const { song } = settings;
  const voices = parseAnnotatedLyrics(source.lyrics).voices;
  const styles = exportStyles(settings, voices);
  if (voices.length > MAX_STYLES) {
    warnings.add(
      `KBS allows ${MAX_STYLES} styles, so voices past the ${MAX_STYLES}th share the last one`,
    );
  }

  const palette = new Palette(styles[0].outline, warnings);
  const kbpStyles: KbpStyle[] = styles.slice(0, MAX_STYLES).map((style, number) => {
    const outline = palette.indexOf(style.outline);
    return {
      number,
      name: (voices[number] ?? "Default").replace(/,/g, " "),
      colors: [palette.indexOf(style.text), outline, palette.indexOf(style.wipe), outline],
      fontName: style.fontName,
      fontSize: Math.max(1, Math.round(style.fontSize / FONT_SCALE)),
      fontStyle: (style.bold ? "B" : "") + (style.italic ? "I" : ""),
      charset: 0,
      outlines: [2, 2, 2, 2],
      shadows: [0, 0],
      wipeStyle: 0,
      uppercase: false,
    };
  });

  const durationCs = song.duration ? Math.round(song.duration * 100) : null;
  const pages = mergePages(
    voices.flatMap((voice, i) => voicePages(source.timings.voices[voice] ?? [], i, durationCs)),
  );
  if (pages.some((page) => page.lines.length > COMFORTABLE_LINES_PER_PAGE)) {
    warnings.add(
      `Some pages have more than ${COMFORTABLE_LINES_PER_PAGE} lines, which may not fit on a KBS screen`,
    );
  }

  const synced = pages.length > 0;
  const document: KbpDocument = {
    palette: palette.entries(),
    styles: kbpStyles,
    margins: [2, 2, 7, 12],
    other: [0, 2],
    trackInfo: {
      Status: synced ? "1" : "0",
      Title: song.title ?? "",
      Artist: song.artist ?? "",
      Audio: source.audioName ?? "",
      BuildFile: "",
      Intro: "",
      Outro: "",
      Comments: EXPORT_COMMENT,
    },
    pages: synced ? layOutLines(pages) : [],
    unsyncedLyrics: synced
      ? null
      : source.lyrics.split("\n").map((line) => line.replace(TAG_PATTERN, "").replace(/_/g, " ")),
    images: [],
    mods: null,
  };
  return { kbp: serializeKbp(document), warnings: warnings.list() };
}
