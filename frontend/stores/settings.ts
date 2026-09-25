import { defineStore } from "pinia";
import { reactive, watch, ref, computed, shallowRef } from "vue";
import { CountInMode, OutputFormat, VerticalAlignment } from "@/lib/timing";
import { NO_VOCALS_SEPARATOR_MODEL, BACKING_VOCALS_SEPARATOR_MODEL, useMediaStore } from "./media";
import Color from "buefy/src/utils/color";
import { SeparationModel } from "@/types";
import { VoiceStyleOverride, serializeVoiceStyle, deserializeVoiceStyle } from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";
import { persistBlobRef } from "@/lib/persistence";
import { TimingKeys, DEFAULT_TIMING_KEYS, isKeyName } from "@/lib/timingKeys";
import { readFontFamilyName } from "@/lib/fontFile";
import { serializeSettingsYaml } from "@/lib/settingsFile";
import {
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_COUNT_IN_TEXT,
  DEFAULT_COUNT_IN_THRESHOLD,
  DEFAULT_COUNT_IN_DURATION,
  DEFAULT_DYNAMIC_COUNT_INS,
} from "@/constants";

const VOICE_STYLES_STORAGE_KEY = "voiceStyles";
const TIMING_KEYS_STORAGE_KEY = "timingKeys";

function loadVoiceStyles(): Record<VoiceId, VoiceStyleOverride> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_STYLES_STORAGE_KEY) || "{}");
    const result: Record<VoiceId, VoiceStyleOverride> = {};
    for (const [voice, stored] of Object.entries(raw)) {
      result[voice] = deserializeVoiceStyle(stored as Record<string, unknown>);
    }
    return result;
  } catch (e) {
    console.error("Error loading voice styles:", e);
    return {};
  }
}

// A key that has since stopped being a name we recognise falls back to the default,
// so a stale entry can never leave the timing tab with an unpressable binding.
function loadTimingKeys(): TimingKeys {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMING_KEYS_STORAGE_KEY) || "{}");
    return {
      start: isKeyName(raw.start) ? raw.start : DEFAULT_TIMING_KEYS.start,
      end: isKeyName(raw.end) ? raw.end : DEFAULT_TIMING_KEYS.end,
      redo: isKeyName(raw.redo) ? raw.redo : DEFAULT_TIMING_KEYS.redo,
    };
  } catch (e) {
    console.error("Error loading timing keys:", e);
    return { ...DEFAULT_TIMING_KEYS };
  }
}

// Define interface for settings with simple hex string colors
export type VideoSettings = {
  vocalSeparationModel: SeparationModel;
  addTitleScreen: boolean;
  countInMode: CountInMode;
  countInText: string;
  dynamicCountIns: boolean;
  countInThreshold: number;
  countInDuration: number;
  addInstrumentalScreens: boolean;
  addStaggeredLines: boolean;
  useBackgroundVideo: boolean;
  outputFormat: OutputFormat;
  verticalAlignment: VerticalAlignment;
  font: {
    size: number;
    name: string;
    bold?: boolean;
    italic?: boolean;
  };
  color: {
    background: Color;
    primary: Color;
    secondary: Color;
  };
};

// Define StoredSettings by overriding the color fields in VideoSettings
type StoredSettings = Omit<VideoSettings, "color"> & {
  color: {
    background: string;
    primary: string;
    secondary: string;
  };
};

// Default settings with simple hex strings
const DEFAULT_SETTINGS: VideoSettings = {
  addTitleScreen: true,
  countInMode: DEFAULT_COUNT_IN_MODE,
  countInText: DEFAULT_COUNT_IN_TEXT,
  dynamicCountIns: DEFAULT_DYNAMIC_COUNT_INS,
  countInThreshold: DEFAULT_COUNT_IN_THRESHOLD,
  countInDuration: DEFAULT_COUNT_IN_DURATION,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useBackgroundVideo: false,
  outputFormat: "mp4",
  verticalAlignment: VerticalAlignment.Middle,
  vocalSeparationModel: BACKING_VOCALS_SEPARATOR_MODEL,
  font: {
    size: 20,
    name: "Arial Narrow",
  },
  color: {
    background: Color.parse("#000000"), // black
    primary: Color.parse("#FF00FF"), // magenta
    secondary: Color.parse("#00FFFF"), // cyan
  },
};

// A shallow spread would hand out DEFAULT_SETTINGS' own font and color objects, so
// writing a font name or color would rewrite the defaults.
function defaultSettings(): VideoSettings {
  return {
    ...DEFAULT_SETTINGS,
    font: { ...DEFAULT_SETTINGS.font },
    color: { ...DEFAULT_SETTINGS.color },
  };
}

export const useSettingsStore = defineStore("settings", () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>(defaultSettings());

  // Per-voice style overrides, keyed by voice id. Empty/absent => the voice uses the base.
  const voiceStyles = ref<Record<VoiceId, VoiceStyleOverride>>(loadVoiceStyles());

  // Kept out of `videoOptions`, which is what the exported settings.yaml describes: these
  // are about how the tapping tab is driven, not about the video.
  const timingKeys = ref<TimingKeys>(loadTimingKeys());

  // Kept out of `videoOptions`, which is JSON-serialized to localStorage wholesale. The
  // file goes to IndexedDB instead.
  const customFont = ref<File | null>(null);
  // The name the font declares for itself, which is what an ASS style row must carry.
  // Null means the picked font stands.
  const customFontFamily = ref<string | null>(null);
  // libass takes URLs, not blobs. Not revoked while the font is in use: the preview's
  // worker and FFmpeg read it lazily, and revoking mid-read fails the read.
  const customFontUrl = ref<string | null>(null);

  // Load saved settings when the store is initialized
  loadSettings();

  // A fixed count-in longer than the gap that triggers it would start
  // before the previous line ends, so the threshold caps the duration.
  // Enforced here because loaded and stored settings bypass the Submit tab's own bounds,
  // and kept in dynamic mode so switching back lands on a usable value.
  watch(
    () => [videoOptions.countInThreshold, videoOptions.countInDuration],
    ([threshold, duration]) => {
      if (duration > threshold) {
        videoOptions.countInDuration = threshold;
      }
    },
    { immediate: true },
  );

  // Automatically save settings when they change
  watch(
    videoOptions,
    () => {
      saveSettings();
    },
    { deep: true },
  );

  watch(
    voiceStyles,
    () => {
      const out: Record<string, unknown> = {};
      for (const [voice, style] of Object.entries(voiceStyles.value)) {
        out[voice] = serializeVoiceStyle(style);
      }
      localStorage.setItem(VOICE_STYLES_STORAGE_KEY, JSON.stringify(out));
    },
    { deep: true },
  );

  watch(
    timingKeys,
    () => {
      localStorage.setItem(TIMING_KEYS_STORAGE_KEY, JSON.stringify(timingKeys.value));
    },
    { deep: true },
  );

  // The family name is re-derived on load rather than stored, so a file that has gone
  // unreadable is dropped instead of naming a font libass can't find.
  persistBlobRef("settings.customFont", customFont).then(async () => {
    const file = customFont.value;
    if (!file || customFontFamily.value) {
      return;
    }
    try {
      customFontFamily.value = await readFontFamilyName(file);
      customFontUrl.value = URL.createObjectURL(file);
    } catch (e) {
      console.error("Could not read the saved custom font; ignoring it", e);
      customFont.value = null;
    }
  });

  // Per-voice uploaded fonts, kept out of `voiceStyles`, which settings.yaml describes and which holds no files.
  // Only the files are stored. The family names and URLs are re-derived, as for the base font.
  const voiceFontFiles = shallowRef<Record<VoiceId, File> | null>(null);
  const voiceFonts = shallowRef<Record<VoiceId, { family: string; url: string }>>({});

  persistBlobRef("settings.voiceFonts", voiceFontFiles).then(async () => {
    const loaded: Record<VoiceId, { family: string; url: string }> = {};
    const readable: Record<VoiceId, File> = {};
    for (const [voice, file] of Object.entries(voiceFontFiles.value ?? {})) {
      try {
        loaded[voice] = { family: await readFontFamilyName(file), url: URL.createObjectURL(file) };
        readable[voice] = file;
      } catch (e) {
        console.error(`Could not read the saved font for ${voice}; ignoring it`, e);
      }
    }
    voiceFonts.value = { ...loaded, ...voiceFonts.value };
    if (Object.keys(readable).length !== Object.keys(voiceFontFiles.value ?? {}).length) {
      voiceFontFiles.value = readable;
    }
  });

  function getVoiceFont(voice: VoiceId): { file: File; family: string; url: string } | undefined {
    const file = voiceFontFiles.value?.[voice];
    const font = voiceFonts.value[voice];
    return file && font ? { file, ...font } : undefined;
  }

  /**
   * Clears the voice's font when given null. Parses the family name before storing anything,
   * so on UnreadableFontError the font already in use still stands.
   */
  async function setVoiceFont(voice: VoiceId, file: File | null): Promise<void> {
    const { [voice]: _file, ...files } = voiceFontFiles.value ?? {};
    const { [voice]: _font, ...fonts } = voiceFonts.value;
    if (file) {
      const family = await readFontFamilyName(file);
      files[voice] = file;
      fonts[voice] = { family, url: URL.createObjectURL(file) };
    }
    voiceFontFiles.value = Object.keys(files).length > 0 ? files : null;
    voiceFonts.value = fonts;
  }

  /**
   * The voice's override as the renderer should use it, with an uploaded font standing in for the picked one.
   */
  function renderVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    const font = voiceFonts.value[voice];
    const style = voiceStyles.value[voice];
    return font ? { ...style, fontName: font.family } : style;
  }

  // Clears the font when given null. Parses the family name before storing anything, so
  // on UnreadableFontError the previously active font still stands.
  async function setCustomFont(file: File | null): Promise<void> {
    if (!file) {
      customFont.value = null;
      customFontFamily.value = null;
      customFontUrl.value = null;
      return;
    }
    const family = await readFontFamilyName(file);
    customFont.value = file;
    customFontFamily.value = family;
    customFontUrl.value = URL.createObjectURL(file);
  }

  // Built from the picked font, not the uploaded one:
  // a settings file naming a font it can't carry would no longer load back.
  const settingsYaml = computed(() => {
    const media = useMediaStore();
    return serializeSettingsYaml({
      song: {
        title: media.songTitle,
        artist: media.songArtist,
        duration: media.songDuration,
        youtubeUrl: media.youtubeUrl,
      },
      separationModel: media.separationModel,
      videoOptions,
      voiceStyles: voiceStyles.value,
    });
  });

  // What everything that renders lyrics should use: `videoOptions` is raw UI state, where
  // the font picker keeps its own value even while an uploaded font overrides it.
  const renderOptions = computed<VideoSettings>(() =>
    customFontFamily.value
      ? { ...videoOptions, font: { ...videoOptions.font, name: customFontFamily.value } }
      : videoOptions,
  );

  // Binding a key another role already holds swaps the two, so no two roles point at the same key,
  // which would make one of them unreachable.
  function setTimingKey(role: keyof TimingKeys, name: string): void {
    const next: TimingKeys = { ...timingKeys.value };
    const clash = (Object.keys(next) as (keyof TimingKeys)[]).find(
      (other) => other !== role && next[other] === name,
    );
    if (clash) {
      next[clash] = next[role];
    }
    next[role] = name;
    timingKeys.value = next;
  }

  function getVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    return voiceStyles.value[voice];
  }

  function setVoiceStyleField<K extends keyof VoiceStyleOverride>(
    voice: VoiceId,
    field: K,
    value: VoiceStyleOverride[K],
  ) {
    const current = { ...(voiceStyles.value[voice] ?? {}) };
    if (value === undefined) {
      delete current[field];
    } else {
      current[field] = value;
    }
    voiceStyles.value = { ...voiceStyles.value, [voice]: current };
  }

  function clearVoiceStyle(voice: VoiceId) {
    const { [voice]: _removed, ...rest } = voiceStyles.value;
    voiceStyles.value = rest;
    void setVoiceFont(voice, null);
  }

  // Move a style override onto another voice id. Used when a lyric tag edit renames a voice,
  // so the style follows the voice instead of being orphaned. No-op when the source has no override
  // or the target already has one.
  function renameVoiceStyle(from: VoiceId, to: VoiceId) {
    const style = voiceStyles.value[from];
    if (style && !voiceStyles.value[to]) {
      const { [from]: _removed, ...rest } = voiceStyles.value;
      voiceStyles.value = { ...rest, [to]: style };
    }
    const file = voiceFontFiles.value?.[from];
    const font = voiceFonts.value[from];
    if (file && font && !voiceFontFiles.value?.[to]) {
      const { [from]: _file, ...files } = voiceFontFiles.value ?? {};
      const { [from]: _font, ...fonts } = voiceFonts.value;
      voiceFontFiles.value = { ...files, [to]: file };
      voiceFonts.value = { ...fonts, [to]: font };
    }
  }

  /**
   * Every uploaded font, the base one and each voice's, as Start over discards them.
   */
  async function clearCustomFonts(): Promise<void> {
    await setCustomFont(null);
    voiceFontFiles.value = null;
    voiceFonts.value = {};
  }

  // Merge a partial set of options over the current ones, e.g. from a loaded settings.yaml.
  // The nested font and color groups merge field by field, so a file that only mentions one color
  // leaves the others untouched.
  function applyVideoOptions(options: Partial<VideoSettings>): void {
    const { font, color, ...rest } = options;
    Object.assign(videoOptions, rest);
    if (font) {
      Object.assign(videoOptions.font, font);
    }
    if (color) {
      Object.assign(videoOptions.color, color);
    }
  }

  // Replace every per-voice override. A settings file describes the complete set, so
  // voices it doesn't mention go back to the base style.
  function setVoiceStyles(styles: Record<VoiceId, VoiceStyleOverride>): void {
    voiceStyles.value = { ...styles };
  }

  function loadSettings(): void {
    const optionsStr = localStorage.videoOptions;
    if (!optionsStr) {
      return;
    }

    try {
      const options = JSON.parse(optionsStr) as StoredSettings;
      // Convert string colors back to Color objects
      const newVideoOptions = {
        ...options,
        color: {
          background: Color.parse(options.color.background),
          primary: Color.parse(options.color.primary),
          secondary: Color.parse(options.color.secondary),
        },
      } as VideoSettings;

      // Settings saved before count-ins gained a "line" mode carry a boolean instead.
      const legacyCountIns = (options as { addCountIns?: boolean }).addCountIns;
      if (legacyCountIns !== undefined) {
        newVideoOptions.countInMode = legacyCountIns ? "screen" : "none";
        delete (newVideoOptions as { addCountIns?: boolean }).addCountIns;
      }

      // Handle legacy vocalSeparationModel setting
      if (
        (newVideoOptions.vocalSeparationModel as string) ===
        "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
      ) {
        newVideoOptions.vocalSeparationModel = NO_VOCALS_SEPARATOR_MODEL;
      }

      // Update the reactive state with loaded options
      Object.assign(videoOptions, newVideoOptions);
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  }

  function saveSettings(): void {
    try {
      const storageOptions = {
        ...videoOptions,
        color: {
          background: videoOptions.color.background.toString(),
          primary: videoOptions.color.primary.toString(),
          secondary: videoOptions.color.secondary.toString(),
        },
      } as StoredSettings;

      localStorage.videoOptions = JSON.stringify(storageOptions);
    } catch (e) {
      console.error("Error saving settings:", e);
    }
  }

  function resetSettings(): void {
    Object.assign(videoOptions, defaultSettings());
    voiceStyles.value = {};
    timingKeys.value = { ...DEFAULT_TIMING_KEYS };
    void clearCustomFonts();
  }

  return {
    videoOptions,
    renderOptions,
    settingsYaml,
    voiceStyles,
    timingKeys,
    customFont,
    customFontFamily,
    customFontUrl,
    setCustomFont,
    getVoiceFont,
    setVoiceFont,
    renderVoiceStyle,
    clearCustomFonts,
    setTimingKey,
    getVoiceStyle,
    setVoiceStyleField,
    clearVoiceStyle,
    renameVoiceStyle,
    applyVideoOptions,
    setVoiceStyles,
    loadSettings,
    saveSettings,
    resetSettings,
  };
});
