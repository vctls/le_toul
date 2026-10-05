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
