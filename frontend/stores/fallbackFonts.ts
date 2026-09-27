import { defineStore } from "pinia";
import { computed, shallowRef, watch } from "vue";
import { BUNDLED_FONTS, FALLBACK_FONTS } from "@/lib/fonts";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";

type FontFamily = keyof typeof BUNDLED_FONTS;

// libass fetches a font from a URL range by range as it draws,
// which stalls the first frame with characters it hasn't fetched yet.
// From a blob: URL it reads the whole file up front,
// so the fallback fonts are downloaded as soon as the text needs them.
export const useFallbackFontsStore = defineStore("fallbackFonts", () => {
  const lyricsStore = useLyricsStore();
  const mediaStore = useMediaStore();
  const settingsStore = useSettingsStore();

  // These URLs are never revoked,
  // since every preview worker and every render reads them for the rest of the session.
  const downloaded = shallowRef<Partial<Record<FontFamily, string>>>({});
  const requested = new Set<FontFamily>();

  const neededFamilies = computed(() => {
    const text = [
      lyricsStore.lyricText,
      mediaStore.songTitle,
      mediaStore.songArtist,
      settingsStore.videoOptions.countInText,
    ].join("\n");
    return FALLBACK_FONTS.filter(({ chars }) => new RegExp(chars, "u").test(text)).map(
      ({ family }) => family as FontFamily,
    );
  });

  /**
   * Download a bundled font into memory, once per session.
   * A failed download is retried the next time the text changes.
   */
  async function download(family: FontFamily): Promise<void> {
    if (requested.has(family)) {
      return;
    }
    requested.add(family);
    try {
      const response = await fetch(BUNDLED_FONTS[family]);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      downloaded.value = { ...downloaded.value, [family]: url };
    } catch (e) {
      console.error(`Could not download the ${family} font`, e);
      requested.delete(family);
    }
  }

  watch(neededFamilies, (families) => families.forEach(download), { immediate: true });

  // Every bundled font by family name, with the downloaded ones pointing at their in-memory copy.
  const fontUrls = computed<Record<string, string>>(() => ({
    ...BUNDLED_FONTS,
    ...downloaded.value,
  }));

  return { fontUrls };
});
