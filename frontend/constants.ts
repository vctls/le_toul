// See webpack.common.js for process.env setup
export const API_HOSTNAME = import.meta.env.TUUL_API_HOSTNAME || "";
export const DONATE_URL = import.meta.env.TUUL_DONATE_URL || "";

/**
 * The largest song the server accepts for separation, in bytes, or Infinity if the page does not say.
 * The server renders it into the page, so it is read from there rather than baked into the bundle.
 */
export function maxUploadBytes(): number {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="tuul-max-upload-bytes"]');
  return Number(meta?.content) || Infinity;
}

/**
 * The app's name, from the APP_NAME setting the server renders into the page.
 */
export function appName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="tuul-app-name"]');
  return meta?.content || "Le Toul";
}

export const LYRIC_MARKERS = {
  SEGMENT_START: 1,
  SEGMENT_END: 2,
};

// The ASS script canvas, i.e. the PlayResX/PlayResY we declare in the subtitle header.
// libass scales this canvas to whatever size the output frame is, so every subtitle coordinate we
// compute (line Y positions, voice lanes) is in these units and NOT in output pixels. This must stay
// in sync with the header written by renderAssDocument: laying out against a different height than
// we declare puts the text off-centre and can push the lowest lane off the bottom of the frame.
//
// 16:9, to match every frame size in RESOLUTIONS (lib/timing.ts). libass takes the font scale
// from PlayResY alone and scales X by frame width / PlayResX, so a canvas of a different aspect than
// the frame comes out anamorphically stretched. Height is libass's own default.
export const SUBTITLE_CANVAS = {
  width: 512,
  height: 288,
};

// How much of the font size a line actually covers, capitals to descenders.
// Measured between 1.07 and 1.16 across the bundled fonts.
// Lines sit in taller slots, so centring a block of them goes by this, not the slot height.
export const GLYPH_BLOCK_RATIO = 1.12;

// Both are multiples of the font size.
export const DEFAULT_LINE_SPACING = 1.5;
export const DEFAULT_TOP_MARGIN = 1.5;

// In pixels on the subtitle canvas.
export const DEFAULT_OUTLINE_WIDTH = 1;

export const TITLE_SCREEN_DURATION = 4.0;
export const DEFAULT_INSTRUMENTAL_THRESHOLD = 8.0;

export const DEFAULT_COUNT_IN_MODE = "screen";
export const DEFAULT_COUNT_IN_TEXT = "";
export const DEFAULT_DYNAMIC_COUNT_INS = true;
export const DEFAULT_COUNT_IN_THRESHOLD = 3.0;
export const DEFAULT_COUNT_IN_DURATION = 2.0;

// A voice let through is worse than a sound left out, so the margins around sung lines are wide.
export const DEFAULT_GAP_PRE_ROLL = 0.5;
export const DEFAULT_GAP_POST_ROLL = 1.5;
export const DEFAULT_GAP_MIN_LENGTH = 1.0;
export const DEFAULT_GAP_FADE = 0.1;
// A tap tends to come before the syllable is heard, so a line's mute may start this long after it.
export const GAP_MAX_LEAD = 0.2;

// A button that turns into Cancel under the pointer that just clicked it ignores clicks this long,
// so a double click doesn't call off what it started.
export const CANCEL_ARMING_DELAY_MS = 600;
