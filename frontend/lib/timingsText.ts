// The `timings.txt` format: every voice's segments laid out in pages and lines,
// with each line's display period in its header and footer rows.
// Times are read and written in centiseconds, which is the precision of ASS and KBP.

import { findLastIndex } from "lodash-es";
import {
  BRACKETS_REMOVED,
  DISPLAY_PERIOD_WIDENED,
  MARKUP_REMOVED,
  SPACER_BOUNDS_DROPPED,
  SPACER_PAGE_DROPPED,
  Warnings,
} from "./importWarnings";
import { TimedSegment, clampDisplayPeriods } from "./timedSegments";
import { DEFAULT_VOICE_ID, VoiceId } from "./voices";

export const TIMINGS_TEXT_VERSION = 1;
const SIGNATURE = "Toul timings";

const TIME = String.raw`\d{1,3}:[0-5]\d\.\d{2}`;
const VALUE = `(-|${TIME})`;
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
const SIGNATURE_ROW = new RegExp(`^${SIGNATURE}\\s+(\\d+)$`);
const VOICE_ROW = new RegExp(`^voice\\s+${QUOTED}$`);
const PAGE_ROW = /^page$/;
const BOUND_ROW = new RegExp(`^${VALUE}$`);
const SYLLABLE_ROW = new RegExp(`^${QUOTED}(?:\\s+${VALUE})?(?:\\s+${VALUE})?$`);

// The separators that can end a stored segment, whitespace included for segments stored before
// `parseLyrics` read trailing whitespace as a word break.
const SEPARATOR_RUN = /[\s/_]*$/;

export class TimingsTextError extends Error {
  row: number;

  constructor(row: number, message: string) {
    super(`Row ${row}: ${message}`);
    this.row = row;
  }
}

// Times are centiseconds while parsing, so comparisons are exact.
interface ParsedSyllable {
  text: string;
  start?: number;
  end?: number;
  row: number;
}

interface ParsedLine {
  header: number;
  displayStart?: number;
  displayEnd?: number;
  syllables: ParsedSyllable[];
  // A line with no syllables is a spacer, and its neighbours count it.
  spacersBefore?: number;
  spacersAfter?: number;
}

type ParsedPage = ParsedLine[];

export interface ParsedTimingsText {
  voices: Record<VoiceId, TimedSegment[]>;
  warnings: string[];
}

/**
 * Whether the text starts with the signature, whatever its version.
 * Lyrics and timings are both `.txt`, so this is what tells one from the other.
 */
export function isTimingsText(text: string): boolean {
  const first = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((row) => stripComment(row).trim())
    .find((row) => row !== "");
  return first !== undefined && SIGNATURE_ROW.test(first);
}

/**
 * Parse a `timings.txt` into each voice's segments.
 * A malformed row throws a `TimingsTextError` that names it.
 * Anything the app can't hold but can recover from is dropped or changed, with a warning.
 */
export function parseTimingsText(input: string): ParsedTimingsText {
  const warnings = new Warnings();
  const voices: Record<VoiceId, TimedSegment[]> = {};
  for (const [voice, pages] of parseSections(input, true)) {
    voices[voice] = voiceSegments(pages, warnings);
  }
  return { voices, warnings: warnings.list() };
}

export interface ParsedVoiceTimingsText {
  segments: TimedSegment[];
  warnings: string[];
}

/**
 * Parse one voice's section of a `timings.txt`, as the Edit tab shows it.
 * A section has no signature or `voice` row, so either one is an error.
 */
export function parseVoiceTimingsText(input: string): ParsedVoiceTimingsText {
  const warnings = new Warnings();
  const pages = parseSections(input, false).get(DEFAULT_VOICE_ID);
  const segments = pages ? voiceSegments(pages, warnings) : [];
  return { segments, warnings: warnings.list() };
}

function voiceSegments(pages: ParsedPage[], warnings: Warnings): TimedSegment[] {
  validateTimes(pages);
  const clamped = clampDisplayPeriods(toSegments(pages, warnings));
  for (let i = 0; i < clamped.widened; i++) {
    warnings.add(DISPLAY_PERIOD_WIDENED);
  }
  return clamped.segments;
}

function parseSections(input: string, wholeFile: boolean): Map<VoiceId, ParsedPage[]> {
  const rows = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections = new Map<VoiceId, ParsedPage[]>();
  let signed = !wholeFile;
  let pages: ParsedPage[] | undefined;
  let line: ParsedLine | undefined;
  let afterFooter = false;

  const section = (): ParsedPage[] => {
    // A file with a single voice can leave its `voice` row out.
    if (!pages) {
      pages = [[]];
      sections.set(DEFAULT_VOICE_ID, pages);
    }
    return pages;
  };
  const requireClosedLine = () => {
    if (line) {
      throw new TimingsTextError(line.header, "This line has no footer.");
    }
  };

  for (let index = 0; index < rows.length; index++) {
    const row = index + 1;
    const content = stripComment(rows[index]).trim();
    if (content === "") {
      continue;
    }
    const followsFooter = afterFooter;
    afterFooter = false;

    if (!signed) {
      const match = content.match(SIGNATURE_ROW);
      if (!match) {
        throw new TimingsTextError(
          row,
          `A timings file starts with "${SIGNATURE} ${TIMINGS_TEXT_VERSION}".`,
        );
      }
      if (Number(match[1]) !== TIMINGS_TEXT_VERSION) {
        throw new TimingsTextError(
          row,
          `Version ${match[1]} of the timings format isn't supported.`,
        );
      }
      signed = true;
      continue;
    }

    if (!wholeFile && (SIGNATURE_ROW.test(content) || VOICE_ROW.test(content))) {
      throw new TimingsTextError(
        row,
        "This row belongs to the whole timings file, not to one voice's section.",
      );
    }

    let match: RegExpMatchArray | null;
    if ((match = content.match(VOICE_ROW))) {
      requireClosedLine();
      const voice = unquote(match[1]);
      if (voice.trim() === "") {
        throw new TimingsTextError(row, "A voice needs a name.");
      }
      if (sections.has(voice)) {
        throw new TimingsTextError(row, `The voice "${voice}" already has a section.`);
      }
      pages = [[]];
      sections.set(voice, pages);
    } else if (PAGE_ROW.test(content)) {
      requireClosedLine();
      const current = section();
      if (current[current.length - 1].length > 0) {
        current.push([]);
      }
    } else if ((match = content.match(BOUND_ROW))) {
      const current = section();
      const bound = centiseconds(match[1]);
      if (!line) {
        line = { header: row, displayStart: bound, syllables: [] };
      } else {
        line.displayEnd = bound;
        current[current.length - 1].push(line);
        line = undefined;
        afterFooter = true;
      }
    } else if ((match = content.match(SYLLABLE_ROW))) {
      if (!line) {
        // The previous line's missing footer took this line's header.
        const hint = followsFooter ? " The line before may be missing its footer." : "";
        throw new TimingsTextError(
          row,
          `A syllable has to be inside a line, between a header and a footer.${hint}`,
        );
      }
      line.syllables.push({
        text: unquote(match[1]),
        start: centiseconds(match[2]),
        end: centiseconds(match[3]),
        row,
      });
    } else {
      const kinds = wholeFile
        ? "a voice, a page, a time or a syllable"
        : "a page, a time or a syllable";
      throw new TimingsTextError(row, `This row isn't ${kinds}.`);
    }
  }

  if (!signed) {
    throw new TimingsTextError(
      1,
      `A timings file starts with "${SIGNATURE} ${TIMINGS_TEXT_VERSION}".`,
    );
  }
  requireClosedLine();
  return sections;
}

/**
 * Times never go backwards within a voice, reading starts and ends in file order.
 * An end with no start takes no part, since the renderer ignores it.
 */
function validateTimes(pages: ParsedPage[]): void {
  let previous: number | undefined;
  const check = (time: number, row: number) => {
    if (previous !== undefined && time < previous) {
      throw new TimingsTextError(
        row,
        `Timecodes must not go backwards: ${formatTimecode(previous / 100)} is followed by ${formatTimecode(time / 100)}.`,
      );
    }
    previous = time;
  };

  for (const { start, end, row } of pages.flat().flatMap((line) => line.syllables)) {
    if (start === undefined) {
      continue;
    }
    check(start, row);
    if (end !== undefined) {
      check(end, row);
    }
  }
}

interface Syllable {
  word: string;
  wordEnd: boolean;
  start?: number;
  end?: number;
  row: number;
  line: ParsedLine;
  firstOfLine: boolean;
  lastOfLine: boolean;
  lastOfPage: boolean;
}

/**
 * Rebuild a voice's segments, with the separators the structure implies.
 */
function toSegments(pages: ParsedPage[], warnings: Warnings): TimedSegment[] {
  const syllables: Syllable[] = [];
  for (const page of pages) {
    const lines = countSpacers(page, warnings);

    lines.forEach((line, l) => {
      let texts = line.syllables.map(({ text }) => {
        if (/[/_]/.test(text)) {
          warnings.add(MARKUP_REMOVED);
          return text.replace(/[/_]/g, "");
        }
        return text;
      });
      if (texts[0].trimStart().startsWith("[")) {
        warnings.add(BRACKETS_REMOVED);
        texts = texts.map((text) => text.replace(/[[\]]/g, ""));
      }

      line.syllables.forEach(({ start, end, row }, s) => {
        const text = texts[s];
        const previous = syllables[syllables.length - 1];
        // A leading space ends the previous syllable's word, as in KBP.
        if (previous && /^\s/.test(text)) {
          previous.wordEnd = true;
        }
        syllables.push({
          word: text.trim(),
          wordEnd: /\s$/.test(text),
          start,
          end,
          row,
          line,
          firstOfLine: s === 0,
          lastOfLine: s === line.syllables.length - 1,
          lastOfPage: s === line.syllables.length - 1 && l === lines.length - 1,
        });
      });
    });
  }

  // Textless timings come from events past the end of the lyrics,
  // so they can only follow the last word.
  const lastText = findLastIndex(syllables, ({ word }) => word !== "");
  const misplaced = syllables.findIndex(({ word }, i) => word === "" && i < lastText);
  if (misplaced >= 0) {
    throw new TimingsTextError(
      syllables[misplaced].row,
      "A syllable needs text, unless it comes after the voice's last syllable with text.",
    );
  }

  return syllables.map((syllable, i) => {
    const segment: TimedSegment = { text: syllable.word + separatorOf(syllable, i >= lastText) };
    if (syllable.start !== undefined) {
      segment.start = syllable.start / 100;
    }
    if (syllable.end !== undefined) {
      segment.end = syllable.end / 100;
    }
    if (syllable.firstOfLine) {
      const { displayStart, displayEnd, spacersBefore, spacersAfter } = syllable.line;
      if (displayStart !== undefined) {
        segment.displayStart = displayStart / 100;
      }
      if (displayEnd !== undefined) {
        segment.displayEnd = displayEnd / 100;
      }
      if (spacersBefore) {
        segment.spacersBefore = spacersBefore;
      }
      if (spacersAfter) {
        segment.spacersAfter = spacersAfter;
      }
    }
    return segment;
  });
}

/**
 * The page's lines without its spacers, each counted on the line below it,
 * or on the page's last line when it's at the bottom.
 */
function countSpacers(page: ParsedPage, warnings: Warnings): ParsedLine[] {
  const lines = page.filter((line) => line.syllables.length > 0);
  if (lines.length === 0) {
    warnings.add(SPACER_PAGE_DROPPED);
    return [];
  }
  let spacers = 0;
  for (const line of page) {
    if (line.syllables.length > 0) {
      line.spacersBefore = spacers;
      spacers = 0;
      continue;
    }
    if (line.displayStart !== undefined || line.displayEnd !== undefined) {
      warnings.add(SPACER_BOUNDS_DROPPED);
    }
    spacers++;
  }
  lines[lines.length - 1].spacersAfter = spacers;
  return lines;
}

function separatorOf(syllable: Syllable, isLast: boolean): string {
  if (isLast) {
    return "";
  }
  if (syllable.lastOfPage) {
    return "\n\n";
  }
  if (syllable.lastOfLine) {
    return "\n";
  }
  return syllable.wordEnd ? "_" : "/";
}

interface WrittenLine {
  displayStart?: number;
  displayEnd?: number;
  spacersBefore?: number;
  spacersAfter?: number;
  syllables: { text: string; start?: number; end?: number }[];
}

/**
 * Write every voice's segments as a `timings.txt`.
 * The lyrics' voices come first, in their order,
 * then the timed voices the lyrics no longer name,
 * which `reconcileVoices` may still carry across a rename.
 */
export function writeTimingsText(
  byVoice: Record<VoiceId, TimedSegment[]>,
  lyricVoices: VoiceId[],
): string {
  const isTimed = (voice: VoiceId) => byVoice[voice].some(({ start }) => start !== undefined);
  const voices = [
    ...lyricVoices.filter((voice) => byVoice[voice] !== undefined),
    ...Object.keys(byVoice).filter((voice) => !lyricVoices.includes(voice) && isTimed(voice)),
  ];

  const rows = [`${SIGNATURE} ${TIMINGS_TEXT_VERSION}`];
  for (const voice of voices) {
    rows.push("", `voice ${quote(voice)}`, "", ...sectionRows(byVoice[voice]));
  }
  return rows.join("\n") + "\n";
}

/**
 * Write one voice's section of a `timings.txt`, without the signature and the `voice` row.
 */
export function writeVoiceTimingsText(segments: TimedSegment[]): string {
  const rows = sectionRows(segments);
  return rows.length > 0 ? rows.join("\n") + "\n" : "";
}

function sectionRows(segments: TimedSegment[]): string[] {
  return toPages(segments).flatMap((page, p) => [
    ...(p > 0 ? [""] : []),
    "page",
    ...page.flatMap((line, l) => [
      ...spacerRows(line.spacersBefore),
      "",
      ...lineRows(line),
      ...(l === page.length - 1 ? spacerRows(line.spacersAfter) : []),
    ]),
  ]);
}

/**
 * A spacer is a header followed directly by its footer, and it has no display period.
 */
function spacerRows(count: number | undefined): string[] {
  return Array.from({ length: count ?? 0 }, () => ["", "-", "-"]).flat();
}

type Break = "page" | "line" | "word" | "split" | "none";

function breakOf(separators: string): Break {
  const newlines = separators.split("\n").length - 1;
  if (newlines > 1) {
    return "page";
  }
  if (newlines === 1) {
    return "line";
  }
  return /[\s_]/.test(separators) ? "word" : "split";
}

/**
 * Lay a voice's segments out in pages and lines.
 * Segments stored before `parseLyrics` collapsed its separators are written as what they draw.
 */
function toPages(segments: TimedSegment[]): WrittenLine[][] {
  const parts = segments.map((segment) => {
    const separators = (segment.text.match(SEPARATOR_RUN) as RegExpMatchArray)[0];
    const word = segment.text.slice(0, segment.text.length - separators.length).trim();
    return { segment, word, separators };
  });

  // An empty segment before the last word draws nothing, and the parser would reject it.
  // It's left out with its timing, and its break goes to the segment before it.
  const lastText = findLastIndex(parts, ({ word }) => word !== "");
  const kept: typeof parts = [];
  parts.forEach((part, i) => {
    if (part.word === "" && i < lastText) {
      if (kept.length > 0) {
        kept[kept.length - 1].separators += part.separators;
      }
      return;
    }
    kept.push({ ...part });
  });

  const lastKeptText = findLastIndex(kept, ({ word }) => word !== "");
  const pages: WrittenLine[][] = [[]];
  let line: WrittenLine | undefined;
  kept.forEach(({ segment, word, separators }, i) => {
    if (!line) {
      const { displayStart, displayEnd, spacersBefore, spacersAfter } = segment;
      line = { displayStart, displayEnd, spacersBefore, spacersAfter, syllables: [] };
    }
    const kind: Break = i >= lastKeptText ? "none" : breakOf(separators);
    line.syllables.push({
      text: kind === "word" ? `${word} ` : word,
      start: segment.start,
      end: segment.end,
    });
    if (kind === "line" || kind === "page") {
      pages[pages.length - 1].push(line);
      line = undefined;
    }
    if (kind === "page") {
      pages.push([]);
    }
  });
  if (line) {
    pages[pages.length - 1].push(line);
  }
  return pages.filter((page) => page.length > 0);
}

/**
 * The times start in one column per line, so a one-syllable edit doesn't realign its neighbours.
 */
function lineRows(line: WrittenLine): string[] {
  const quoted = line.syllables.map(({ text }) => quote(text));
  const column = Math.max(...quoted.map(width)) + 2;
  const syllableRows = line.syllables.map(({ start, end }, i) => {
    const values =
      end !== undefined
        ? [boundText(start), formatTimecode(end)]
        : start !== undefined
          ? [formatTimecode(start)]
          : [];
    if (values.length === 0) {
      return quoted[i];
    }
    return quoted[i] + " ".repeat(column - width(quoted[i])) + values.join("  ");
  });
  return [boundText(line.displayStart), ...syllableRows, boundText(line.displayEnd)];
}

export function formatTimecode(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cc = totalCs % 100;
  const totalSec = (totalCs - cc) / 100;
  const ss = totalSec % 60;
  const mm = (totalSec - ss) / 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}.${pad(cc)}`;
}

function boundText(time: number | undefined): string {
  return time === undefined ? "-" : formatTimecode(time);
}

function width(text: string): number {
  return [...text].length;
}

function centiseconds(value: string | undefined): number | undefined {
  if (value === undefined || value === "-") {
    return undefined;
  }
  const [minutes, rest] = value.split(":");
  const [seconds, hundredths] = rest.split(".");
  return (Number(minutes) * 60 + Number(seconds)) * 100 + Number(hundredths);
}

function quote(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * Only `\"` and `\\` are escapes. A backslash before any other character is kept as it is.
 */
function unquote(text: string): string {
  return text.replace(/\\(["\\])/g, "$1");
}

/**
 * A `#` starts a comment outside quotes only.
 */
function stripComment(row: string): string {
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (quoted && char === "\\") {
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "#" && !quoted) {
      return row.slice(0, i);
    }
  }
  return row;
}
