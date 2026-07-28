import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { useTimingsStore } from './timings';
import { useLyricsStore } from './lyrics';
import { useMediaStore } from './media';
import { useSettingsStore } from './settings';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { KEY_CODES, LYRIC_MARKERS } from '@/constants';
import { createAssFile } from '@/lib/timing';
import { DEFAULT_VOICE_ID } from '@/lib/voices';

// Mock the createAssFile function
vi.mock('@/lib/timing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timing')>()),
  createAssFile: vi.fn().mockReturnValue('mock subtitles content'),
  DEFAULT_KARAOKE_OPTIONS: {}
}));

describe('Timings Store', () => {
  beforeEach(() => {
    localStorage.clear();
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test('should initialize with empty timings', () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.length).toBe(0);
    expect(timingsStore.rawTimings).toEqual([]);
  });

  test('should add timing events', () => {
    const timingsStore = useTimingsStore();
    timingsStore.add(0, 32, 1.0); // 32 is SPACEBAR code

    expect(timingsStore.length).toBe(1);
    expect(timingsStore.rawTimings).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
  });

  test('conflicts should be resolved', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(1, KEY_CODES.ENTER, 3.0);
    timings.add(2, KEY_CODES.SPACEBAR, 2.5);

    expect(timings.rawTimings[1]).toStrictEqual([2.5, LYRIC_MARKERS.SEGMENT_START]);
  });

  test('length should reflect the number of timings', () => {
    const timings = useTimingsStore();

    expect(timings.length).toBe(0);

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.length).toBe(1);

    timings.add(1, KEY_CODES.ENTER, 3.0);
    expect(timings.length).toBe(2);
  });

  test('last should return the most recent timing', () => {
    const timings = useTimingsStore();

    // Initial state should return null
    expect(timings.last).toStrictEqual(null);

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.last).toStrictEqual([1.0, LYRIC_MARKERS.SEGMENT_START]);

    timings.add(0, KEY_CODES.ENTER, 3.0);
    expect(timings.last).toStrictEqual([3.0, LYRIC_MARKERS.SEGMENT_END]);
  });

  test('resetTimings should replace all timings', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    expect(timings.length).toBe(1);

    const newTimings = [[2.0, LYRIC_MARKERS.SEGMENT_START], [5.0, LYRIC_MARKERS.SEGMENT_END]];
    timings.resetTimings(newTimings);

    expect(timings.length).toBe(2);
    expect(timings.rawTimings).toStrictEqual(newTimings);
  });

  test('timingForSegmentNum should find the correct segment start time', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(0, KEY_CODES.ENTER, 2.0);
    timings.add(1, KEY_CODES.SPACEBAR, 3.0);
    timings.add(1, KEY_CODES.ENTER, 4.0);

    expect(timings.timingForSegmentNum(0)).toBe(1.0);
    expect(timings.timingForSegmentNum(1)).toBe(3.0);
    // Segment that doesn't exist should return 0
    expect(timings.timingForSegmentNum(2)).toBe(0);
  });

  test('setCurrentSegment should truncate timings to the specified segment', () => {
    const timings = useTimingsStore();

    timings.add(0, KEY_CODES.SPACEBAR, 1.0);
    timings.add(0, KEY_CODES.ENTER, 2.0);
    timings.add(1, KEY_CODES.SPACEBAR, 3.0);
    timings.add(1, KEY_CODES.ENTER, 4.0);
    timings.add(2, KEY_CODES.SPACEBAR, 5.0);

    expect(timings.length).toBe(5);

    // Set back to segment 1
    timings.setCurrentSegment(1);

    // Should have removed the last timing (segment 2 start)
    expect(timings.length).toBe(2);
    expect(timings.last).toStrictEqual([2.0, LYRIC_MARKERS.SEGMENT_END]);

    // Set back to segment 0
    timings.setCurrentSegment(0);

    // Should have removed segment 1 timings
    expect(timings.length).toBe(0);
    expect(timings.last).toStrictEqual(null);
  });

  test('subtitles should return empty string if timings is empty', () => {
    const timingsStore = useTimingsStore();
    expect(timingsStore.subtitles()).toBe('');
  });

  test('migrates a legacy single-voice array into the default voice', () => {
    const legacy = [[1.0, LYRIC_MARKERS.SEGMENT_START], [2.0, LYRIC_MARKERS.SEGMENT_END]];
    localStorage.setItem('timings._timings', JSON.stringify(legacy));

    const timingsStore = useTimingsStore();

    // With no lyrics the active voice falls back to the default, where the legacy array landed.
    expect(timingsStore.rawTimings).toStrictEqual(legacy);
    expect(timingsStore.length).toBe(2);
  });

  test('active voice follows the lyrics voices and can be switched', () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics('[Anna] hello\n[Ben] world');

    // Defaults to the first voice
    expect(timingsStore.activeVoice).toBe('Anna');

    timingsStore.setActiveVoice('Ben');
    expect(timingsStore.activeVoice).toBe('Ben');

    // An invalid/stale active voice falls back to the first voice
    timingsStore.setActiveVoice('Nobody');
    expect(timingsStore.activeVoice).toBe('Anna');
  });

  test('timings are isolated per voice', () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics('[Anna] hello\n[Ben] world');

    timingsStore.setActiveVoice('Anna');
    timingsStore.add(0, KEY_CODES.SPACEBAR, 1.0);

    timingsStore.setActiveVoice('Ben');
    expect(timingsStore.rawTimings).toEqual([]); // Ben untouched
    timingsStore.add(0, KEY_CODES.SPACEBAR, 5.0);

    // Each voice kept its own timings
    timingsStore.setActiveVoice('Anna');
    expect(timingsStore.rawTimings).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
    timingsStore.setActiveVoice('Ben');
    expect(timingsStore.rawTimings).toEqual([[5.0, LYRIC_MARKERS.SEGMENT_START]]);
  });

  test('setAllTimings replaces all voices and allTimings returns the map', () => {
    const timingsStore = useTimingsStore();
    timingsStore.setAllTimings({
      Anna: [[1.0, LYRIC_MARKERS.SEGMENT_START]],
      Ben: [[2.0, LYRIC_MARKERS.SEGMENT_START]],
    });

    expect(timingsStore.allTimings).toEqual({
      Anna: [[1.0, LYRIC_MARKERS.SEGMENT_START]],
      Ben: [[2.0, LYRIC_MARKERS.SEGMENT_START]],
    });
  });

  test('clear removes timings for all voices', () => {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();

    lyricsStore.setLyrics('[Anna] hello\n[Ben] world');
    timingsStore.setActiveVoice('Anna');
    timingsStore.add(0, KEY_CODES.SPACEBAR, 1.0);
    timingsStore.setActiveVoice('Ben');
    timingsStore.add(0, KEY_CODES.SPACEBAR, 5.0);

    timingsStore.clear();

    timingsStore.setActiveVoice('Anna');
    expect(timingsStore.rawTimings).toEqual([]);
    timingsStore.setActiveVoice('Ben');
    expect(timingsStore.rawTimings).toEqual([]);
  });

  describe('voice reconciliation', () => {
    // Timings tapped out before any voice tag existed live under the default voice. Adding
    // a tag renames that voice, and the timings must follow it.
    const timeSingleVoice = (lyrics = 'hello\nworld') => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();

      lyricsStore.setLyrics(lyrics);
      timingsStore.resetTimings([
        [1.0, LYRIC_MARKERS.SEGMENT_START],
        [2.0, LYRIC_MARKERS.SEGMENT_END],
      ]);
      expect(timingsStore.activeVoice).toBe(DEFAULT_VOICE_ID);

      return { timingsStore, lyricsStore };
    };

    test('tagging untagged lyrics carries the timings over to the tagged voice', async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics('[Anna] hello\nworld');
      await nextTick();

      expect(lyricsStore.voices).toEqual(['Anna']);
      expect(timingsStore.activeVoice).toBe('Anna');
      expect(timingsStore.rawTimings).toStrictEqual(timings);
      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });

    test('the timings keep following the tag as it is typed out', async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      for (const tag of ['[A]', '[An]', '[Ann]', '[Anna]']) {
        lyricsStore.setLyrics(`${tag} hello\nworld`);
        await nextTick();
      }

      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });

    test('a second voice added afterwards is timed from scratch', async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics('[Anna] hello\nworld');
      await nextTick();
      lyricsStore.setLyrics('[Anna] hello\nworld\n[Ben] backing');
      await nextTick();

      expect(lyricsStore.voices).toEqual(['Anna', 'Ben']);
      // Anna kept the original timings; Ben starts empty.
      expect(timingsStore.timingsForVoice('Anna')).toStrictEqual(timings);
      expect(timingsStore.timingsForVoice('Ben')).toEqual([]);
      expect(timingsStore.voicesWithTimings).toEqual(['Anna']);
    });

    test('the voice style follows the rename', async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const settingsStore = useSettingsStore();
      settingsStore.setVoiceStyleField(DEFAULT_VOICE_ID, 'verticalAlignment', 'bottom');
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics('[Anna] hello\nworld');
      await nextTick();

      expect(settingsStore.getVoiceStyle('Anna')).toEqual({ verticalAlignment: 'bottom' });
      expect(settingsStore.getVoiceStyle(DEFAULT_VOICE_ID)).toBeUndefined();
    });

    test('an ambiguous change leaves the timings parked and recoverable', async () => {
      const { timingsStore, lyricsStore } = timeSingleVoice();
      const timings = timingsStore.rawTimings;
      timingsStore.setupVoiceReconciliation();

      // Two new voices at once: there is no telling which one owns the old timings.
      lyricsStore.setLyrics('[Anna] hello\n[Ben] world');
      await nextTick();

      expect(timingsStore.rawTimings).toEqual([]);
      expect(timingsStore.allTimings[DEFAULT_VOICE_ID]).toStrictEqual(timings);

      // Undoing the edit brings them back.
      lyricsStore.setLyrics('hello\nworld');
      await nextTick();
      expect(timingsStore.rawTimings).toStrictEqual(timings);
    });

    test('does not move timings onto a voice that already has its own', async () => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();
      timingsStore.setupVoiceReconciliation();

      lyricsStore.setLyrics('[Anna] hello\n[Ben] world');
      await nextTick();
      timingsStore.setActiveVoice('Anna');
      timingsStore.add(0, KEY_CODES.SPACEBAR, 1.0);
      timingsStore.setActiveVoice('Ben');
      timingsStore.add(0, KEY_CODES.SPACEBAR, 5.0);

      // Dropping Ben's tag merges his line into Anna, who is already timed.
      lyricsStore.setLyrics('[Anna] hello\nworld');
      await nextTick();

      expect(timingsStore.timingsForVoice('Anna')).toEqual([[1.0, LYRIC_MARKERS.SEGMENT_START]]);
      expect(timingsStore.allTimings.Ben).toEqual([[5.0, LYRIC_MARKERS.SEGMENT_START]]);
    });

    test('setAllTimings adopts an imported default-voice map into the sole tagged voice', () => {
      const timingsStore = useTimingsStore();
      const lyricsStore = useLyricsStore();

      lyricsStore.setLyrics('[Anna] hello\nworld');
      const timings = [[1.0, LYRIC_MARKERS.SEGMENT_START]];
      timingsStore.setAllTimings({ [DEFAULT_VOICE_ID]: timings });

      expect(timingsStore.allTimings).toEqual({ Anna: timings });
    });
  });

  test('subtitles should call createAssFile with correct parameters when timings exist', () => {
    // Setup the stores
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();

    // Mock the store data
    lyricsStore.setLyrics('Test lyrics');
    timingsStore.resetTimings([[1.0, LYRIC_MARKERS.SEGMENT_START], [2.0, LYRIC_MARKERS.SEGMENT_END]]);
    // @ts-ignore - Mocking private properties
    mediaStore.songDuration = 10;
    mediaStore.songTitle = 'Test Song';
    mediaStore.songArtist = 'Test Artist';
    settingsStore.videoOptions = { test: 'options' };

    // Check the result
    expect(timingsStore.subtitles()).toBe('mock subtitles content');

    // Verify that createAssFile was called with the correct parameters
    expect(createAssFile).toHaveBeenCalledWith(
      'Test lyrics',
      timingsStore.rawTimings,
      10,
      'Test Song',
      'Test Artist',
      { test: 'options' }
    );
  });
});
