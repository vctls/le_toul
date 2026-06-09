import { createPinia, setActivePinia } from 'pinia';
import { useLyricsStore } from './lyrics';
import { DEFAULT_VOICE_ID } from '@/lib/voices';
import { beforeEach, describe, expect, test } from 'vitest';

describe('Lyrics Store', () => {
  beforeEach(() => {
    localStorage.clear();
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
  });

  test('should initialize with empty lyrics', () => {
    const lyricsStore = useLyricsStore();
    expect(lyricsStore.lyricText).toBe('');
    expect(lyricsStore.lyricSegments).toEqual([]);
  });

  test('should update lyricText with setLyrics action', () => {
    const lyricsStore = useLyricsStore();
    const testLyrics = 'Hello world';

    lyricsStore.setLyrics(testLyrics);

    expect(lyricsStore.lyricText).toBe(testLyrics);
  });

  test('should parse simple lyrics into segments', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello\nWorld');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello\n' },
      { text: 'World' }
    ]);
  });

  test('should handle underscore separators', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello_World');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello_' },
      { text: 'World' }
    ]);
  });

  test('should handle slash separators within words', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hel/lo');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hel/' },
      { text: 'lo' }
    ]);
  });

  test('should handle combined separators', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hell/o_World\nNew_Line');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hell/' },
      { text: 'o_' },
      { text: 'World\n' },
      { text: 'New_' },
      { text: 'Line' }
    ]);
  });

  test('should handle empty lyrics', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('');

    expect(lyricsStore.lyricSegments).toEqual([]);
  });

  test('should handle consecutive newlines', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Line 1\n\nLine 2');

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Line 1\n\n' },
      { text: 'Line 2' }
    ]);
  });

  test('should handle leading newlines without crashing', () => {
    const lyricsStore = useLyricsStore();

    // This should not crash due to empty segments array access
    expect(() => {
      lyricsStore.setLyrics('\n\nHello world');
    }).not.toThrow();

    expect(lyricsStore.lyricSegments).toEqual([
      { text: 'Hello world' }
    ]);
  });

  test('exposes a single default voice for untagged lyrics', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello\nWorld');

    expect(lyricsStore.voices).toEqual([DEFAULT_VOICE_ID]);
    // The default voice's text is the verbatim input, and its segments match the
    // whole-text segments, so the existing single-voice pipeline is unchanged.
    expect(lyricsStore.lyricTextForVoice(DEFAULT_VOICE_ID)).toBe('Hello\nWorld');
    expect(lyricsStore.segmentsForVoice(DEFAULT_VOICE_ID)).toEqual(lyricsStore.lyricSegments);
  });

  test('splits tagged lyrics into per-voice segments', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('[Anna] Hello\n[Ben] World');

    expect(lyricsStore.voices).toEqual(['Anna', 'Ben']);
    expect(lyricsStore.segmentsForVoice('Anna')).toEqual([{ text: 'Hello' }]);
    expect(lyricsStore.segmentsForVoice('Ben')).toEqual([{ text: 'World' }]);
  });

  test('returns empty text for an unknown voice', () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('[Anna] Hello');

    expect(lyricsStore.lyricTextForVoice('Nobody')).toBe('');
    expect(lyricsStore.segmentsForVoice('Nobody')).toEqual([]);
  });
});
