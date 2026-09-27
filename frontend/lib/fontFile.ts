import { FALLBACK_FONTS } from "./fonts";

// libass matches an ASS style's `Fontname` against the family name stored inside the font, not against the file's name,
// both in the browser preview and in FFmpeg's ass filter.

// Family name IDs from the OpenType `name` table, preferred first: 16 is the typographic family, 1 the legacy one,
// which on multi-style fonts carries a split-out name like "Metal Mania Semibold".
const FAMILY_NAME_IDS = [16, 1];

const PLATFORM_UNICODE = 0;
const PLATFORM_MACINTOSH = 1;
const PLATFORM_WINDOWS = 3;
const PLATFORM_PREFERENCE = [PLATFORM_WINDOWS, PLATFORM_UNICODE, PLATFORM_MACINTOSH];

const SFNT_VERSIONS = [
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO', PostScript outlines
  0x74727565, // 'true', an older TrueType marker
];
const TTC_TAG = 0x74746366; // 'ttcf', a font collection holding several faces
const WOFF_TAGS = [0x774f4646, 0x774f4632]; // 'wOFF', 'wOF2'
const NAME_TAG = 0x6e616d65; // 'name'
const CMAP_TAG = 0x636d6170; // 'cmap'

const FALLBACK_CHAR = new RegExp(FALLBACK_FONTS.map(({ chars }) => chars).join("|"), "u");

// Messages reach the user as-is.
export class UnreadableFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableFontError";
  }
}

function sfntOffset(view: DataView): number {
  const tag = view.getUint32(0);
  if (tag === TTC_TAG) {
    if (view.byteLength < 16) {
      throw new UnreadableFontError("This font collection file is truncated.");
    }
    // A collection holds several faces, and the file is identified by its first.
    return view.getUint32(12);
  }
  if (WOFF_TAGS.includes(tag)) {
    throw new UnreadableFontError(
      "Web font formats (.woff and .woff2) can't be used for lyrics. Please upload a .ttf or .otf file.",
    );
  }
  if (!SFNT_VERSIONS.includes(tag)) {
    throw new UnreadableFontError("This doesn't look like a TrueType or OpenType font file.");
  }
  return 0;
}

function tableOffset(view: DataView, offset: number, tag: number): number | undefined {
  const numTables = view.getUint16(offset + 4);
  for (let i = 0; i < numTables; i++) {
    const record = offset + 12 + i * 16;
    if (record + 16 > view.byteLength) {
      break;
    }
    if (view.getUint32(record) === tag) {
      return view.getUint32(record + 8);
    }
  }
  return undefined;
}

function nameTableOffset(view: DataView, offset: number): number {
  const table = tableOffset(view, offset, NAME_TAG);
  if (table !== undefined) {
    return table;
  }
  throw new UnreadableFontError(
    "This font file has no name table, so we can't tell which font it is.",
  );
}

function decodeName(view: DataView, offset: number, length: number, platformId: number): string {
  if (platformId === PLATFORM_MACINTOSH) {
    // Single-byte, of which only the ASCII range is meaningful to us.
    let out = "";
    for (let i = 0; i < length; i++) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  }
  // UTF-16BE, decoded by hand because a "utf-16be" TextDecoder needs a full-ICU build.
  let out = "";
  for (let i = 0; i + 1 < length; i += 2) {
    out += String.fromCharCode(view.getUint16(offset + i));
  }
  return out;
}

// The family name a font declares for itself, e.g. "Metal Mania".
// Throws UnreadableFontError if the file isn't a font or doesn't name itself.
export function parseFontFamilyName(data: ArrayBuffer): string {
  if (data.byteLength < 12) {
    throw new UnreadableFontError("This file is empty or truncated.");
  }
  const view = new DataView(data);
  const nameTable = nameTableOffset(view, sfntOffset(view));
  if (nameTable + 6 > data.byteLength) {
    throw new UnreadableFontError("This font file's name table is truncated.");
  }
  const count = view.getUint16(nameTable + 2);
  const stringsOffset = nameTable + view.getUint16(nameTable + 4);

  // The same name recurs once per platform and language, so rank the candidates rather
  // than taking the first match.
  let best: { name: string; rank: number } | null = null;
  for (let i = 0; i < count; i++) {
    const record = nameTable + 6 + i * 12;
    if (record + 12 > data.byteLength) {
      break;
    }
    const platformRank = PLATFORM_PREFERENCE.indexOf(view.getUint16(record));
    const familyRank = FAMILY_NAME_IDS.indexOf(view.getUint16(record + 6));
    if (platformRank === -1 || familyRank === -1) {
      continue;
    }
    const rank = familyRank * PLATFORM_PREFERENCE.length + platformRank;
    if (best && best.rank <= rank) {
      continue;
    }
    const length = view.getUint16(record + 8);
    const offset = stringsOffset + view.getUint16(record + 10);
    if (offset + length > data.byteLength) {
      continue;
    }
    const name = decodeName(view, offset, length, view.getUint16(record)).replace(/\0/g, "").trim();
    if (name) {
      best = { name, rank };
    }
  }
  if (!best) {
    throw new UnreadableFontError("This font file doesn't say what font family it belongs to.");
  }
  return best.name;
}

/**
 * The offset of the cmap subtable that maps Unicode code points, preferring one that reaches past the BMP.
 */
function unicodeSubtable(view: DataView, cmap: number): number | undefined {
  let bmpOnly: number | undefined;
  const count = view.getUint16(cmap + 2);
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const platformId = view.getUint16(record);
    const encodingId = view.getUint16(record + 2);
    if (
      platformId !== PLATFORM_UNICODE &&
      !(platformId === PLATFORM_WINDOWS && [1, 10].includes(encodingId))
    ) {
      continue;
    }
    const subtable = cmap + view.getUint32(record + 4);
    const format = view.getUint16(subtable);
    if (format === 12) {
      return subtable;
    }
    if (format === 4) {
      bmpOnly ??= subtable;
    }
  }
  return bmpOnly;
}

/**
 * Calls `found` with every code point a cmap subtable maps to a glyph.
 */
function eachMappedCodePoint(view: DataView, subtable: number, found: (codePoint: number) => void) {
  if (view.getUint16(subtable) === 12) {
    const groups = view.getUint32(subtable + 12);
    for (let i = 0; i < groups; i++) {
      const group = subtable + 16 + i * 12;
      const end = view.getUint32(group + 4);
      for (let c = view.getUint32(group); c <= end; c++) {
        found(c);
      }
    }
    return;
  }
  const segCountX2 = view.getUint16(subtable + 6);
  const ends = subtable + 14;
  const starts = ends + segCountX2 + 2;
  const deltas = starts + segCountX2;
  const rangeOffsets = deltas + segCountX2;
  for (let i = 0; i < segCountX2; i += 2) {
    const start = view.getUint16(starts + i);
    const end = view.getUint16(ends + i);
    const delta = view.getUint16(deltas + i);
    const rangeOffset = view.getUint16(rangeOffsets + i);
    for (let c = start; c <= end; c++) {
      // A range offset is relative to its own position in the file.
      const glyph = rangeOffset
        ? view.getUint16(rangeOffsets + i + rangeOffset + (c - start) * 2)
        : (c + delta) & 0xffff;
      if (glyph !== 0) {
        found(c);
      }
    }
  }
}

/**
 * The characters matching `chars` that a font can draw.
 * A cmap that can't be read counts as drawing none, so the fallback fonts draw them instead.
 */
export function parseCoverage(data: ArrayBuffer, chars: RegExp = FALLBACK_CHAR): Set<number> {
  const covered = new Set<number>();
  try {
    const view = new DataView(data);
    const cmap = tableOffset(view, sfntOffset(view), CMAP_TAG);
    const subtable = cmap === undefined ? undefined : unicodeSubtable(view, cmap);
    if (subtable !== undefined) {
      eachMappedCodePoint(view, subtable, (c) => {
        if (chars.test(String.fromCodePoint(c))) {
          covered.add(c);
        }
      });
    }
  } catch (e) {
    if (!(e instanceof RangeError || e instanceof UnreadableFontError)) {
      throw e;
    }
  }
  return covered;
}

export async function readFontFamilyName(file: File): Promise<string> {
  return parseFontFamilyName(await file.arrayBuffer());
}

/**
 * The family name a font declares, and which of the characters the fallback fonts stand in for it can draw.
 * Throws UnreadableFontError as parseFontFamilyName does.
 */
export async function readFont(file: File): Promise<{ family: string; coverage: Set<number> }> {
  const data = await file.arrayBuffer();
  return { family: parseFontFamilyName(data), coverage: parseCoverage(data) };
}
