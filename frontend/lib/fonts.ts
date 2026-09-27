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
};

// The only bundled font with Chinese, Japanese and Korean glyphs.
// It draws the characters those languages share in their Japanese forms.
export const CJK_FONT = "Noto Sans CJK JP";
