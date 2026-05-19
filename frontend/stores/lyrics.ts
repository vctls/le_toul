import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { parseLyrics } from '@/lib/timing';
import { persistJsonRef } from '@/lib/persistence';

export const useLyricsStore = defineStore('lyrics', () => {
  const lyricText = ref('');
  persistJsonRef('lyrics.lyricText', lyricText);

  // Parse marked up lyrics into segments using shared logic
  const lyricSegments = computed(() => {
    return parseLyrics(lyricText.value, true);
  });

  function setLyrics(text: string) {
    lyricText.value = text;
  }

  function clear() {
    lyricText.value = '';
  }

  return {
    lyricText,
    lyricSegments,
    setLyrics,
    clear,
  };
});
