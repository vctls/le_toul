// The Karaoke Builder Studio project format (.kbp), read and written as a plain document.
// This module knows the file layout only. What its content means to the app lives in kbpConvert.ts.

export const KBP_DIVIDER = "-".repeat(29);

export interface KbpStyle {
  // 0 to 19, written as Style00 to Style19 and referenced from lines as A to T.
  number: number;
  name: string;
  // Palette indexes for the text, outline, wiped text and wiped outline.
  colors: [number, number, number, number];
  fontName: string;
  fontSize: number;
  // Any of B, I, U and S.
  fontStyle: string;
  charset: number;
  outlines: [number, number, number, number];
  shadows: [number, number];
  wipeStyle: number;
  uppercase: boolean;
}

// Times are in centiseconds.
export interface KbpSyllable {
  text: string;
  start: number;
  end: number;
  wipe: number;
}

export interface KbpLine {
  align: string;
  // A letter, A for Style00. Lowercase marks a fixed line, shown without a wipe.
  style: string;
  // When the line is shown and hidden, separately from its syllables.
  start: number;
  end: number;
  right: number;
  down: number;
  rotation: number;
  syllables: KbpSyllable[];
}

export interface KbpPage {
  // The `remove/display` part of an FX line, or null for the default transition.
  transition: string | null;
  lines: KbpLine[];
}

export interface KbpDocument {
  // 16 colours of three hex digits each. Entry 0 is the screen background.
  palette: string[];
  styles: KbpStyle[];
  margins: number[];
  other: number[];
  // In file order. Multi-line values are joined with \n.
  trackInfo: Record<string, string>;
  pages: KbpPage[];
  // The raw lyric lines of an unsynced project (Status 0), or null.
  unsyncedLyrics: string[] | null;
  images: string[];
  mods: string | null;
}

const LINE_HEADER = /^([LCR])\/([A-Za-z])\/(-?\d+)\/(-?\d+)\/(-?\d+)\/(-?\d+)\/(-?\d+)$/;
// Syllable text cannot hold an unescaped slash, so the text is whatever precedes the three times.
const SYLLABLE = /^(.*)\/ *(-?\d+)\/(-?\d+)\/(-?\d+)$/;
const STYLE_START = /^Style(\d{2}),/;
const TRACK_INFO_START = "'--- Track Information ---";
const TRACK_INFO_KEY_WIDTH = 10;
const SYLLABLE_TEXT_WIDTH = 15;

function isData(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("'");
}

function toNumbers(text: string, count: number, what: string): number[] {
  const numbers = text.split(",").map((part) => Number(part.trim()));
  if (numbers.length !== count || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`Expected ${count} numbers for the ${what}, got "${text.trim()}".`);
  }
  return numbers;
}

/**
 * A style takes three lines. Its name and font name may hold commas, so fields are counted from the ends.
 */
function parseStyle(lines: string[]): KbpStyle {
  const head = lines[0].trim().split(",");
  const font = lines[1].trim().split(",");
  const other = lines[2].trim().split(",");
  if (head.length < 6 || font.length < 4 || other.length !== 8) {
    throw new Error(`Malformed style "${lines[0].trim()}".`);
  }
  const colors = toNumbers(head.slice(-4).join(","), 4, "style colours");
  const numbers = toNumbers(other.slice(0, 7).join(","), 7, "style outlines and shadows");
  return {
    number: Number(head[0].slice("Style".length)),
    name: head.slice(1, -4).join(","),
    colors: colors as KbpStyle["colors"],
    fontName: font.slice(0, -3).join(","),
    fontSize: Number(font[font.length - 3]),
    fontStyle: font[font.length - 2].trim(),
    charset: Number(font[font.length - 1]),
    outlines: numbers.slice(0, 4) as KbpStyle["outlines"],
    shadows: numbers.slice(4, 6) as KbpStyle["shadows"],
    wipeStyle: numbers[6],
    uppercase: other[7].trim() === "U",
  };
}

function parseTrackInfo(lines: string[]): Record<string, string> {
  const info: Record<string, string> = {};
  let previous: string | null = null;
  for (const line of lines) {
    if (line.trim() === "" || line.startsWith("'")) {
      continue;
    }
    if (line.startsWith(" ") && previous !== null) {
      info[previous] += "\n" + line.trim();
      continue;
    }
    const key = line.split(/\s/, 1)[0];
    info[key] = line.slice(key.length).trim();
    previous = key;
  }
  return info;
}

function parseHeader(lines: string[], document: KbpDocument): void {
  const nextData = (from: number): number => {
    let i = from + 1;
    while (i < lines.length && !isData(lines[i])) i++;
    if (i === lines.length) {
      throw new Error(`Nothing follows "${lines[from].trim()}".`);
    }
    return i;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("'Palette Colours")) {
      i = nextData(i);
      document.palette = lines[i].trim().split(",");
      if (
        document.palette.length !== 16 ||
        document.palette.some((c) => !/^[0-9A-F]{3}$/i.test(c))
      ) {
        throw new Error("The palette must hold 16 colours of three hex digits.");
      }
    } else if (STYLE_START.test(line)) {
      const second = nextData(i);
      const third = nextData(second);
      document.styles.push(parseStyle([lines[i], lines[second], lines[third]]));
      i = third;
    } else if (line.startsWith("'Margins")) {
      i = nextData(i);
      document.margins = toNumbers(lines[i], 4, "margins");
    } else if (line.startsWith("'Other")) {
      i = nextData(i);
      document.other = toNumbers(lines[i], 2, "border colour and detail level");
    } else if (line === TRACK_INFO_START) {
      document.trackInfo = parseTrackInfo(lines.slice(i + 1));
      return;
    }
  }
}

/**
 * Two kinds of corruption are known from KBS files in the wild, and both are repaired here,
 * following kbputils:
 * a syllable line split in two ("Foo" then "/  123/456/0"), which KBS may also save back as a
 * zero-timed syllable followed by an empty one, and a stray blank line inside a line's syllables.
 */
function parsePage(lines: string[], pageNumber: number): KbpPage {
  const page: KbpPage = { transition: null, lines: [] };
  let current: KbpLine | null = null;
  let partial: string | null = null;

  const fail = (line: string): never => {
    throw new Error(`Unexpected line on page ${pageNumber}: "${line}".`);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line: string = partial === null ? raw : partial + raw;
    partial = null;

    const header = line.match(LINE_HEADER);
    if (header) {
      const [, align, style, ...times] = header;
      const [start, end, right, down, rotation] = times.map(Number);
      current = { align, style, start, end, right, down, rotation, syllables: [] };
      page.lines.push(current);
      continue;
    }
    if (line.trim() === "") {
      current = null;
      continue;
    }
    if (current === null && line.startsWith("FX/") && page.lines.length === 0) {
      page.transition = line.slice("FX/".length);
      continue;
    }

    const syllable = line.match(SYLLABLE);
    if (!syllable) {
      if (current === null && page.lines.length === 0) {
        fail(line);
      }
      partial = line;
      continue;
    }
    if (current === null) {
      // A syllable after a blank line, with no header of its own, still belongs to the line before.
      current = page.lines[page.lines.length - 1] ?? fail(line);
    }

    let [, text, start, end, wipe] = syllable;
    const next = lines[i + 1];
    if (text !== "" && start === "0" && end === "0" && next?.startsWith("/")) {
      const repaired = next.match(SYLLABLE);
      if (repaired && repaired[1] === "") {
        [, , start, end, wipe] = repaired;
        i++;
      }
    }
    current.syllables.push({
      // kbputils writes {~} where KBS writes {-}, both for a literal slash.
      text: text.replace(/\{[-~]\}/g, "/"),
      start: Number(start),
      end: Number(end),
      wipe: Number(wipe),
    });
  }
  if (partial !== null) {
    fail(partial);
  }
  return page;
}

/**
 * Throws only when the text cannot be read as a KBS project at all.
 */
export function parseKbp(text: string): KbpDocument {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sections: string[][] = [];
  for (const line of lines) {
    if (line.trimEnd() === KBP_DIVIDER) {
      sections.push([]);
    } else if (sections.length > 0) {
      sections[sections.length - 1].push(line);
    }
  }

  const document: KbpDocument = {
    palette: [],
    styles: [],
    margins: [],
    other: [],
    trackInfo: {},
    pages: [],
    unsyncedLyrics: null,
    images: [],
    mods: null,
  };
  let sawHeader = false;

  for (const section of sections) {
    const nameIndex = section.findIndex(isData);
    if (nameIndex === -1) {
      continue;
    }
    const rest = section.slice(nameIndex + 1);
    switch (section[nameIndex].trim()) {
      case "HEADERV2":
        parseHeader(rest, document);
        sawHeader = true;
        break;
      case "PAGEV2":
        document.pages.push(parsePage(rest, document.pages.length + 1));
        break;
      case "LYRICSV2":
        document.unsyncedLyrics = rest;
        break;
      case "IMAGE":
        document.images.push(...rest.filter(isData));
        break;
      case "MODS":
        document.mods = rest.find(isData) ?? null;
        break;
    }
  }

  if (!sawHeader || document.palette.length === 0) {
    throw new Error("This isn't a Karaoke Builder Studio project: it has no header or palette.");
  }
  return document;
}

function styleLines(style: KbpStyle): string[] {
  return [
    `  Style${String(style.number).padStart(2, "0")},${style.name},${style.colors.join(",")}`,
    `    ${style.fontName},${style.fontSize},${style.fontStyle},${style.charset}`,
    `    ${[...style.outlines, ...style.shadows, style.wipeStyle].join(",")},${style.uppercase ? "U" : "L"}`,
    "",
  ];
}

function trackInfoLines(info: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(info)) {
    if (key === "Comments") {
      lines.push("");
    }
    const [first, ...rest] = value.split("\n");
    lines.push(key.padEnd(TRACK_INFO_KEY_WIDTH) + first);
    lines.push(...rest.map((line) => " ".repeat(TRACK_INFO_KEY_WIDTH) + line));
  }
  return lines;
}

function pageLines(page: KbpPage): string[] {
  const lines = [KBP_DIVIDER, "PAGEV2"];
  if (page.transition !== null) {
    lines.push(`FX/${page.transition}`);
  }
  for (const line of page.lines) {
    const { align, style, start, end, right, down, rotation } = line;
    lines.push([align, style, start, end, right, down, rotation].join("/"));
    for (const syllable of line.syllables) {
      const text = syllable.text.replace(/\//g, "{-}") + "/";
      lines.push(
        text.padEnd(SYLLABLE_TEXT_WIDTH) + [syllable.start, syllable.end, syllable.wipe].join("/"),
      );
    }
    lines.push("");
  }
  return lines;
}

/**
 * Lays the file out the way KBS itself writes it, CRLF line endings included.
 */
export function serializeKbp(document: KbpDocument): string {
  const lines = [
    KBP_DIVIDER,
    "KARAOKE BUILDER STUDIO",
    "www.KaraokeBuilder.com",
    "",
    KBP_DIVIDER,
    "HEADERV2",
    "",
    "'--- Template Information ---",
    "",
    "'Palette Colours (0-15)",
    "  " + document.palette.join(","),
    "",
    "'Styles (00-19)",
    "'  Number,Name",
    "'  Colour: Text,Outline,Text Wipe,Outline Wipe",
    "'  Font  : Name,Size,Style,Charset",
    "'  Other : Outline*4,Shadow*2,Wiping,Uppercase",
    "",
    ...document.styles.flatMap(styleLines),
    "  StyleEnd",
    "",
    "'Margins : L,R,T,Line Spacing",
    "  " + document.margins.join(","),
    "",
    "'Other: Border Colour,Detail Level",
    "  " + document.other.join(","),
    "",
    TRACK_INFO_START,
    "",
    ...trackInfoLines(document.trackInfo),
    "",
  ];

  if (document.unsyncedLyrics !== null) {
    lines.push(KBP_DIVIDER, "LYRICSV2", ...document.unsyncedLyrics);
    return lines.join("\r\n");
  }

  lines.push(...document.pages.flatMap(pageLines));
  for (const image of document.images) {
    lines.push(KBP_DIVIDER, "IMAGE", image, "");
  }
  if (document.mods !== null) {
    lines.push(KBP_DIVIDER, "MODS", document.mods, "");
  }
  lines.push(KBP_DIVIDER, "", "");
  return lines.join("\r\n");
}
