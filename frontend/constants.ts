// See webpack.common.js for process.env setup
export const API_HOSTNAME = import.meta.env.TUUL_API_HOSTNAME || "";
export const DONATE_URL = import.meta.env.TUUL_DONATE_URL || "";

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
// 16:9, to match the frame we render into (1280x720, see lib/video.ts). libass takes the font scale
// from PlayResY alone and scales X by frame width / PlayResX, so a canvas of a different aspect than
// the frame comes out anamorphically stretched. Height is libass's own default.
export const SUBTITLE_CANVAS = {
  width: 512,
  height: 288,
};

// How much of the font size a line actually covers, capitals to descenders.
// Measured between 1.07 and 1.16 across the bundled fonts.
// Lines sit in 1.5x slots, so centring a block of them goes by this, not the slot height.
export const GLYPH_BLOCK_RATIO = 1.12;

export const TITLE_SCREEN_DURATION = 4.0;
export const INSTRUMENTAL_SCREEN_THRESHOLD = 8.0;

export const DEFAULT_COUNT_IN_MODE = "screen";
export const DEFAULT_COUNT_IN_TEXT = "";
export const DEFAULT_COUNT_IN_THRESHOLD = 5.0;
export const DEFAULT_COUNT_IN_DURATION = 2.0;
