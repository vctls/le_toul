import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { parseLyrics } from '@/lib/timing';
import { parseAnnotatedLyrics, VoiceId } from '@/lib/voices';
import { persistJsonRef } from '@/lib/persistence';

export const useLyricsStore = defineStore('lyrics', () => {
  const lyricText = ref('');
  persistJsonRef('lyrics.lyricText', lyricText);

  // Parse marked up lyrics into segments using shared logic
  const lyricSegments = computed(() => {
    return parseLyrics(lyricText.value, true);
  });

  // Multi-voice view of the lyrics. Voices are identified by sticky `[tag]` annotations;
  // each voice gets its own lyric string. With no tags, this is a single default voice
  // whose text is the verbatim input (so single-voice behavior is unchanged).
  const annotated = computed(() => parseAnnotatedLyrics(lyricText.value));

  const voices = computed<VoiceId[]>(() => annotated.value.voices);

  function lyricTextForVoice(voice: VoiceId): string {
    return annotated.value.lyricTextByVoice[voice] ?? '';
  }

  function segmentsForVoice(voice: VoiceId) {
    return parseLyrics(lyricTextForVoice(voice), true);
  }

  function setLyrics(text: string) {
    lyricText.value = text;
  }

  function clear() {
    lyricText.value = '';
  }

  return {
    lyricText,
    lyricSegments,
    voices,
    lyricTextForVoice,
    segmentsForVoice,
    setLyrics,
    clear,
  };
});
