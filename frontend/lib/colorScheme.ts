import { loadJsonFromStorage } from "@/lib/persistence";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_STORAGE_KEY = "theme.preference";

const systemQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
const listeners = new Set<() => void>();

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function loadThemePreference(): ThemePreference {
  const stored = loadJsonFromStorage<unknown>(THEME_STORAGE_KEY, "system");
  return isThemePreference(stored) ? stored : "system";
}

// Bulma keys its themes off `data-theme` on the root element.
// Removing it hands the scheme back to the prefers-color-scheme rules.
export function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preference;
  }
  for (const listener of listeners) {
    listener();
  }
}

// The media query never reports a forced switch, so canvas painters have to be told.
export function onSchemeChange(callback: () => void): () => void {
  listeners.add(callback);
  systemQuery?.addEventListener("change", callback);
  return () => {
    listeners.delete(callback);
    systemQuery?.removeEventListener("change", callback);
  };
}
