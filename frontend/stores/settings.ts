import { defineStore } from 'pinia';
import { reactive, watch, ref } from 'vue';
import { VerticalAlignment } from '@/lib/timing';
import { NO_VOCALS_SEPARATOR_MODEL, BACKING_VOCALS_SEPARATOR_MODEL } from './media';
import Color from 'buefy/src/utils/color';
import { SeparationModel } from '@/types';
import { VoiceStyleOverride, serializeVoiceStyle, deserializeVoiceStyle } from '@/lib/voiceStyle';
import { VoiceId } from '@/lib/voices';

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

export const useSettingsStore = defineStore('settings', () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>({ ...DEFAULT_SETTINGS });

  // Per-voice style overrides, keyed by voice id. Empty/absent => the voice uses the base.
  const voiceStyles = ref<Record<VoiceId, VoiceStyleOverride>>(loadVoiceStyles());

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
    Object.assign(videoOptions, DEFAULT_SETTINGS);
    voiceStyles.value = {};
  }

  return {
    videoOptions,
    voiceStyles,
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
