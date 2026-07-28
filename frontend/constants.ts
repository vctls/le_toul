// See webpack.common.js for process.env setup
export const API_HOSTNAME = import.meta.env.TUUL_API_HOSTNAME || "";
export const DONATE_URL = import.meta.env.TUUL_DONATE_URL || "";

export const KEY_CODES = {
  SPACEBAR: 32, // code: "Space"
  ENTER: 13, // code: "Enter"
};

export const LYRIC_MARKERS = {
  SEGMENT_START: 1,
  SEGMENT_END: 2,
};

// The ASS script canvas, i.e. the PlayResX/PlayResY we declare in the subtitle header.
// libass scales this canvas to whatever size the output frame is, so every subtitle
// coordinate we compute (line Y positions, voice lanes) is in these units and NOT in output
// pixels. This must stay in sync with the header written by renderAssDocument: laying out
// against a different height than we declare puts the text off-centre and can push the
// lowest lane off the bottom of the frame. 384x288 is libass's default canvas.
export const SUBTITLE_CANVAS = {
  width: 384,
  height: 288
};

export const TITLE_SCREEN_DURATION = 4.0
export const INSTRUMENTAL_SCREEN_THRESHOLD = 8.0