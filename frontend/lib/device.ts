export function isMobile() {
  // True if we're on a phone or tablet
  return window.screen.width <= 820;
}

// A phone held sideways, where the Timing tab gives the whole screen to the waveform.
export const PHONE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";
