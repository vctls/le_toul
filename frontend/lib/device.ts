import { Ref, onScopeDispose, ref } from "vue";

export function isMobile() {
  // True if we're on a phone or tablet
  return window.screen.width <= 820;
}

// A phone held sideways, where the Timing tab gives the whole screen to the waveform.
export const PHONE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

// Where the tabs and the less used navbar buttons move to a drawer.
export const DRAWER_QUERY = `(max-width: 820px), ${PHONE_LANDSCAPE_QUERY}`;

/**
 * Whether the media query matches, kept up to date as the window resizes or turns.
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const list = window.matchMedia?.(query) ?? null;
  const matches = ref(list?.matches ?? false);
  const update = (event: MediaQueryListEvent) => (matches.value = event.matches);
  list?.addEventListener("change", update);
  onScopeDispose(() => list?.removeEventListener("change", update));
  return matches;
}

/**
 * Whether the browser allows full screen, whether the page is in it, kept up to date however it
 * was entered or left, and a toggle for it.
 */
export function useFullScreen(): {
  canFullScreen: boolean;
  isFullScreen: Ref<boolean>;
  toggleFullScreen: () => void;
} {
  const isFullScreen = ref(document.fullscreenElement != null);
  const update = () => (isFullScreen.value = document.fullscreenElement != null);
  document.addEventListener("fullscreenchange", update);
  onScopeDispose(() => document.removeEventListener("fullscreenchange", update));
  const toggleFullScreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };
  // Safari on iPhone only allows full screen on a video, so it reports false.
  return { canFullScreen: document.fullscreenEnabled ?? false, isFullScreen, toggleFullScreen };
}
