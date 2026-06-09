import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from './settings';
import { VerticalAlignment } from '@/lib/timing';
import { BACKING_VOCALS_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL } from './media';
import Color from 'buefy/src/utils/color';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';

describe('Settings Store', () => {
  let localStorageMock: Record<string, string>;

  // Setup mock localStorage
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test('should initialize with default settings', () => {
    const settingsStore = useSettingsStore();

    // Check default values
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.addCountIns).toBe(true);
    expect(settingsStore.videoOptions.addInstrumentalScreens).toBe(true);
    expect(settingsStore.videoOptions.addStaggeredLines).toBe(true);
    expect(settingsStore.videoOptions.useBackgroundVideo).toBe(false);
    expect(settingsStore.videoOptions.verticalAlignment).toBe(VerticalAlignment.Middle);
    expect(settingsStore.videoOptions.vocalSeparationModel).toBe(BACKING_VOCALS_SEPARATOR_MODEL);

    // Check font default values
    expect(settingsStore.videoOptions.font.size).toBe(20);
    expect(settingsStore.videoOptions.font.name).toBe('Arial Narrow');

    // Check color default values
    expect(settingsStore.videoOptions.color.background.toString()).toBe('#000000');
    expect(settingsStore.videoOptions.color.primary.toString()).toBe('#ff00ff');
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe('#00ffff');
  });

  test('should save settings to localStorage when changed', async () => {
    const settingsStore = useSettingsStore();

    // Modify a setting
    settingsStore.videoOptions.addTitleScreen = false;
    console.log(window.localStorage);
    await nextTick(); // Wait for Vue to update the DOM
    // Check if localStorage was updated
    expect(window.localStorage.videoOptions).toBeDefined();

    // Parse the stored JSON to verify values
    const savedOptions = JSON.parse(window.localStorage.videoOptions);
    expect(savedOptions.addTitleScreen).toBe(false);

    // Check that colors are stored as strings
    expect(typeof savedOptions.color.background).toBe('string');
    expect(savedOptions.color.background).toBe('#000000');
  });

  test('should load settings from localStorage', () => {
    // Prepare localStorage with custom settings
    const customSettings = {
      addTitleScreen: false,
      addCountIns: false,
      addInstrumentalScreens: false,
      addStaggeredLines: false,
      useBackgroundVideo: true,
      verticalAlignment: VerticalAlignment.Top,
      vocalSeparationModel: NO_VOCALS_SEPARATOR_MODEL,
      font: {
        size: 30,
        name: "Times New Roman"
      },
      color: {
        background: "#111111",
        primary: "#222222",
        secondary: "#333333"
      }
    };

    window.localStorage.videoOptions = JSON.stringify(customSettings);

    // Initialize the store, which should load settings from localStorage
    const settingsStore = useSettingsStore();

    // Verify settings were loaded
    expect(settingsStore.videoOptions.addTitleScreen).toBe(false);
    expect(settingsStore.videoOptions.addCountIns).toBe(false);
    expect(settingsStore.videoOptions.addInstrumentalScreens).toBe(false);
    expect(settingsStore.videoOptions.addStaggeredLines).toBe(false);
    expect(settingsStore.videoOptions.useBackgroundVideo).toBe(true);
    expect(settingsStore.videoOptions.verticalAlignment).toBe(VerticalAlignment.Top);
    expect(settingsStore.videoOptions.vocalSeparationModel).toBe(NO_VOCALS_SEPARATOR_MODEL);

    // Check font values
    expect(settingsStore.videoOptions.font.size).toBe(30);
    expect(settingsStore.videoOptions.font.name).toBe('Times New Roman');

    // Check color values - they should be Color objects after loading
    expect(settingsStore.videoOptions.color.background).toBeInstanceOf(Color);
    expect(settingsStore.videoOptions.color.background.toString()).toBe('#111111');
    expect(settingsStore.videoOptions.color.primary.toString()).toBe('#222222');
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe('#333333');
  });

  test('should handle invalid localStorage data', () => {
    // Set invalid JSON in localStorage
    const consoleSpy = vi.spyOn(console, 'error');
    window.localStorage.videoOptions = 'not-valid-json';

    // Initialize the store - this should use default values
    const settingsStore = useSettingsStore();

    // Verify default settings were used
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.font.size).toBe(20);
    expect(settingsStore.videoOptions.color.background.toString()).toBe('#000000');

    // Spy on console.error
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('should reset settings to defaults', async () => {
    // Start with custom settings
    const customSettings = {
      addTitleScreen: false,
      addCountIns: false,
      addInstrumentalScreens: false,
      addStaggeredLines: false,
      useBackgroundVideo: true,
      verticalAlignment: VerticalAlignment.Top,
      vocalSeparationModel: NO_VOCALS_SEPARATOR_MODEL,
      font: {
        size: 30,
        name: "Times New Roman"
      },
      color: {
        background: "#111111",
        primary: "#222222",
        secondary: "#333333"
      }
    };

    window.localStorage.videoOptions = JSON.stringify(customSettings);
    const settingsStore = useSettingsStore();

    // Verify custom settings loaded
    expect(settingsStore.videoOptions.addTitleScreen).toBe(false);

    // Reset to defaults
    settingsStore.resetSettings();
    await nextTick(); // Wait for Vue to update the DOM

    // Verify settings were reset
    expect(settingsStore.videoOptions.addTitleScreen).toBe(true);
    expect(settingsStore.videoOptions.addCountIns).toBe(true);
    expect(settingsStore.videoOptions.font.size).toBe(20);
    expect(settingsStore.videoOptions.font.name).toBe('Arial Narrow');
    expect(settingsStore.videoOptions.color.background.toString()).toBe('#000000');
    expect(settingsStore.videoOptions.color.primary.toString()).toBe('#ff00ff');
    expect(settingsStore.videoOptions.color.secondary.toString()).toBe('#00ffff');

    // Check localStorage was updated
    const savedOptions = JSON.parse(window.localStorage.videoOptions);
    expect(savedOptions.addTitleScreen).toBe(true);
  });

  describe('Voice style overrides', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    test('sets and gets a per-voice override', () => {
      const store = useSettingsStore();
      expect(store.getVoiceStyle('Anna')).toBeUndefined();

      store.setVoiceStyleField('Anna', 'fontName', 'Impact');
      store.setVoiceStyleField('Anna', 'bold', false);

      expect(store.getVoiceStyle('Anna')).toEqual({ fontName: 'Impact', bold: false });
    });

    test('persists overrides with colors as hex strings', async () => {
      const store = useSettingsStore();
      store.setVoiceStyleField('Anna', 'primary', Color.parse('#abcdef'));
      await nextTick();

      const saved = JSON.parse(window.localStorage.getItem('voiceStyles') as string);
      expect(saved.Anna.primary).toBe('#abcdef');
    });

    test('loads overrides from localStorage, parsing colors back', () => {
      window.localStorage.setItem('voiceStyles', JSON.stringify({ Ben: { fontSize: 28, secondary: '#123456' } }));

      const store = useSettingsStore();
      const ben = store.getVoiceStyle('Ben');

      expect(ben?.fontSize).toBe(28);
      expect(ben?.secondary).toBeInstanceOf(Color);
      expect(ben?.secondary?.toString()).toBe('#123456');
    });

    test('clearVoiceStyle removes the override', () => {
      const store = useSettingsStore();
      store.setVoiceStyleField('Anna', 'bold', true);
      store.clearVoiceStyle('Anna');
      expect(store.getVoiceStyle('Anna')).toBeUndefined();
    });
  });
});
