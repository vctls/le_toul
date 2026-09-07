// libass matches an ASS style's `Fontname` against the family name stored inside the
// font, not against the file's name, both in the browser preview and in FFmpeg's ass filter.

// Family name IDs from the OpenType `name` table, preferred first: 16 is the typographic
// family, 1 the legacy one, which on multi-style fonts carries a split-out name like
// "Metal Mania Semibold".
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
    // A collection holds several faces; the file is identified by its first.
    return view.getUint32(12);
  }
  if (WOFF_TAGS.includes(tag)) {
    throw new UnreadableFontError(
      "Web font formats (.woff and .woff2) can't be used for lyrics. Please upload a .ttf or .otf file."
    );
  }
  if (!SFNT_VERSIONS.includes(tag)) {
    throw new UnreadableFontError("This doesn't look like a TrueType or OpenType font file.");
  }
  return 0;
}

function nameTableOffset(view: DataView, offset: number): number {
  const numTables = view.getUint16(offset + 4);
  for (let i = 0; i < numTables; i++) {
    const record = offset + 12 + i * 16;
    if (record + 16 > view.byteLength) {
      break;
    }
    if (view.getUint32(record) === NAME_TAG) {
      return view.getUint32(record + 8);
    }
  }
  throw new UnreadableFontError("This font file has no name table, so we can't tell which font it is.");
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

export async function readFontFamilyName(file: File): Promise<string> {
  return parseFontFamilyName(await file.arrayBuffer());
}
