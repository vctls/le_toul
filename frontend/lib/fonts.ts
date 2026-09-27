import bundledSymbolRanges from "./bundledSymbols.json";

// The fonts the app ships, by family name. libass gets only these, with no system fallback.
export const BUNDLED_FONTS = {
  "Andale Mono": "/static/fonts/AndaleMono.ttf",
  Arial: "/static/fonts/Arial.ttf",
  "Arial Narrow": "/static/fonts/ArialNarrow.ttf",
  "Comic Sans MS": "/static/fonts/ComicSans.ttf",
  "Courier New": "/static/fonts/CourierNew.ttf",
  Georgia: "/static/fonts/Georgia.ttf",
  Impact: "/static/fonts/Impact.ttf",
  "Metal Mania": "/static/fonts/MetalMania.ttf",
  "Times New Roman": "/static/fonts/TimesNewRoman.ttf",
  "Trebuchet MS": "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/fonts/LiberationSans.ttf",
  "Noto Sans CJK JP": "/static/fonts/NotoSansCJKjp-Regular.otf",
  "DejaVu Sans": "/static/fonts/DejaVuSans.ttf",
};

// The only bundled font with Chinese, Japanese and Korean glyphs.
// It draws the characters those languages share in their Japanese forms.
export const CJK_FONT = "Noto Sans CJK JP";

// U+3000–U+33FF holds CJK punctuation, kana and CJK symbols. U+FF00–U+FFEF holds full-width forms.
export const CJK_CHAR = String.raw`[\p{sc=Han}\p{sc=Hangul}\p{sc=Bopomofo}\u3000-\u33ff\uff00-\uffef]`;

export const SYMBOL_FONT = "DejaVu Sans";

// Arrows, technical symbols, box and block characters, geometric shapes, miscellaneous symbols
// and dingbats, which karaoke projects type as count-ins and instrumental bars.
export const SYMBOL_CHAR = String.raw`[\u2190-\u21ff\u2300-\u23ff\u2500-\u27bf\u27f0-\u27ff\u2b00-\u2bff]`;

// The bundled fonts that draw what a style's font can't, and the characters each one stands in for.
export const FALLBACK_FONTS = [
  { family: CJK_FONT, chars: CJK_CHAR },
  { family: SYMBOL_FONT, chars: SYMBOL_CHAR },
];

// The symbols each bundled font draws, as [first, last] code point ranges.
// It is generated from the font files by fonts.spec.ts. Run `npx vitest run -u` after changing a font.
// Only the CJK font draws CJK characters, so none are listed.
export const BUNDLED_SYMBOLS: Readonly<Record<string, ReadonlySet<number>>> = Object.fromEntries(
  Object.entries(bundledSymbolRanges as Record<string, number[][]>).map(([family, ranges]) => [
    family,
    new Set(
      ranges.flatMap(([first, last]) =>
        Array.from({ length: last - first + 1 }, (_, i) => first + i),
      ),
    ),
  ]),
);
