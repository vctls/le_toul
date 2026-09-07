import { defineStore } from 'pinia';
import { reactive, watch, ref, computed } from 'vue';
import { VerticalAlignment } from '@/lib/timing';
import { NO_VOCALS_SEPARATOR_MODEL, BACKING_VOCALS_SEPARATOR_MODEL } from './media';
import Color from 'buefy/src/utils/color';
import { SeparationModel } from '@/types';
import { VoiceStyleOverride, serializeVoiceStyle, deserializeVoiceStyle } from '@/lib/voiceStyle';
import { VoiceId } from '@/lib/voices';
import { persistBlobRef } from '@/lib/persistence';
import { readFontFamilyName } from '@/lib/fontFile';

const VOICE_STYLES_STORAGE_KEY = 'voiceStyles';

function loadVoiceStyles(): Record<VoiceId, VoiceStyleOverride> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_STYLES_STORAGE_KEY) || '{}');
    const result: Record<VoiceId, VoiceStyleOverride> = {};
    for (const [voice, stored] of Object.entries(raw)) {
      result[voice] = deserializeVoiceStyle(stored as Record<string, unknown>);
    }
    return result;
  } catch (e) {
    console.error('Error loading voice styles:', e);
    return {};
  }
}


// Define interface for settings with simple hex string colors
export type VideoSettings = {
  vocalSeparationModel: SeparationModel;
  addTitleScreen: boolean;
  addCountIns: boolean;
  addInstrumentalScreens: boolean;
  addStaggeredLines: boolean;
  useBackgroundVideo: boolean;
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
}

// Define StoredSettings by overriding the color fields in VideoSettings
type StoredSettings = Omit<VideoSettings, 'color'> & {
  color: {
    background: string;
    primary: string;
    secondary: string;
  };
};

// Default settings with simple hex strings
const DEFAULT_SETTINGS: VideoSettings = {
  addTitleScreen: true,
  addCountIns: true,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useBackgroundVideo: false,
  verticalAlignment: VerticalAlignment.Middle,
  vocalSeparationModel: BACKING_VOCALS_SEPARATOR_MODEL,
  font: {
    size: 20,
    name: "Arial Narrow",
  },
  color: {
    background: Color.parse("#000000"), // black
    primary: Color.parse("#FF00FF"),    // magenta
    secondary: Color.parse("#00FFFF"),  // cyan
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

export const useSettingsStore = defineStore('settings', () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>(defaultSettings());

  // Per-voice style overrides, keyed by voice id. Empty/absent => the voice uses the base.
  const voiceStyles = ref<Record<VoiceId, VoiceStyleOverride>>(loadVoiceStyles());

  // Kept out of `videoOptions`, which is JSON-serialized to localStorage wholesale; the
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

  // Automatically save settings when they change
  watch(videoOptions, () => {
    saveSettings();
  }, { deep: true });

  watch(voiceStyles, () => {
    const out: Record<string, unknown> = {};
    for (const [voice, style] of Object.entries(voiceStyles.value)) {
      out[voice] = serializeVoiceStyle(style);
    }
    localStorage.setItem(VOICE_STYLES_STORAGE_KEY, JSON.stringify(out));
  }, { deep: true });

  // The family name is re-derived on load rather than stored, so a file that has gone
  // unreadable is dropped instead of naming a font libass can't find.
  persistBlobRef('settings.customFont', customFont).then(async () => {
    const file = customFont.value;
    if (!file || customFontFamily.value) {
      return;
    }
    try {
      customFontFamily.value = await readFontFamilyName(file);
      customFontUrl.value = URL.createObjectURL(file);
    } catch (e) {
      console.error('Could not read the saved custom font; ignoring it', e);
      customFont.value = null;
    }
  });

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

  // What everything that renders lyrics should use: `videoOptions` is raw UI state, where
  // the font picker keeps its own value even while an uploaded font overrides it.
  const renderOptions = computed<VideoSettings>(() =>
    customFontFamily.value
      ? { ...videoOptions, font: { ...videoOptions.font, name: customFontFamily.value } }
      : videoOptions
  );

  function getVoiceStyle(voice: VoiceId): VoiceStyleOverride | undefined {
    return voiceStyles.value[voice];
  }

  function setVoiceStyleField<K extends keyof VoiceStyleOverride>(voice: VoiceId, field: K, value: VoiceStyleOverride[K]) {
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
  }

  // Move a style override onto another voice id. Used when a lyric tag edit renames a
  // voice, so the style follows the voice instead of being orphaned. No-op when the
  // source has no override or the target already has one.
  function renameVoiceStyle(from: VoiceId, to: VoiceId) {
    const style = voiceStyles.value[from];
    if (!style || voiceStyles.value[to]) {
      return;
    }
    const { [from]: _removed, ...rest } = voiceStyles.value;
    voiceStyles.value = { ...rest, [to]: style };
  }

  // Merge a partial set of options over the current ones, e.g. from a loaded
  // settings.yaml. The nested font and color groups merge field by field, so a file that
  // only mentions one color leaves the others untouched.
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
        ...options, color: {
          background: Color.parse(options.color.background),
          primary: Color.parse(options.color.primary),
          secondary: Color.parse(options.color.secondary)
        }
      } as VideoSettings;

      // Handle legacy vocalSeparationModel setting
      if (
        newVideoOptions.vocalSeparationModel as string === "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
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
        ...videoOptions, color: {
          background: videoOptions.color.background.toString(),
          primary: videoOptions.color.primary.toString(),
          secondary: videoOptions.color.secondary.toString()
        }
      } as StoredSettings;

      localStorage.videoOptions = JSON.stringify(storageOptions);
    } catch (e) {
      console.error("Error saving settings:", e);
    }
  }

  function resetSettings(): void {
    Object.assign(videoOptions, defaultSettings());
    voiceStyles.value = {};
    void setCustomFont(null);
  }

  return {
    videoOptions,
    renderOptions,
    voiceStyles,
    customFont,
    customFontFamily,
    customFontUrl,
    setCustomFont,
    getVoiceStyle,
    setVoiceStyleField,
    clearVoiceStyle,
    renameVoiceStyle,
    applyVideoOptions,
    setVoiceStyles,
    loadSettings,
    saveSettings,
    resetSettings
  };
});
