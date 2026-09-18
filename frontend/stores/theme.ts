import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { persistJsonRef } from "@/lib/persistence";
import {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemePreference,
  applyThemePreference,
  isThemePreference,
} from "@/lib/colorScheme";

export const useThemeStore = defineStore("theme", () => {
  const preference = ref<ThemePreference>("system");
  persistJsonRef(THEME_STORAGE_KEY, preference);
  if (!isThemePreference(preference.value)) {
    preference.value = "system";
  }

  watch(preference, applyThemePreference, { immediate: true });

  function cycle(): void {
    const next = (THEME_PREFERENCES.indexOf(preference.value) + 1) % THEME_PREFERENCES.length;
    preference.value = THEME_PREFERENCES[next];
  }

  return { preference, cycle };
});
