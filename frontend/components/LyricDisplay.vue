<template>
  <div class="lyric-display-wrapper">
    <div class="lyric-display box">
      <span class="completed-lyrics">{{ completedLyrics }}</span
      ><span ref="currentLyrics" class="current-lyrics">{{
        currentLyrics
      }}</span
      ><span class="upcoming-lyrics">{{ upcomingLyrics }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";

export default defineComponent({
  props: {
    lyricSegments: { type: Array as PropType<{ text: string }[]>, default: () => [] },
    currentSegment: { type: Number, default: 0 },
  },
  watch: {
    currentSegment: "onCurrentLyricsChange",
  },
  computed: {
    completedLyrics() {
      return this.lyricSegments
        .slice(0, this.currentSegment)
        .map(this.wrapLyricSegment)
        .join("");
    },
    currentLyrics() {
      if (this.currentSegment in this.lyricSegments) {
        return this.wrapLyricSegment(this.lyricSegments[this.currentSegment]);
      }
      return "";
    },
    upcomingLyrics() {
      return this.lyricSegments
        .slice(this.currentSegment + 1)
        .map(this.wrapLyricSegment)
        .join("");
    },
    hasKeyboard(): boolean {
      return false;
    },
  },
  methods: {
    wrapLyricSegment(segment: { text: string }) {
      return segment.text;
    },
    onCurrentLyricsChange() {
      (this.$refs.currentLyrics as HTMLElement | undefined)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
  },
});
</script>

<style scoped>
.lyric-display-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
}

.lyric-display {
  white-space: pre;
  flex-shrink: 1;
  flex-grow: 1;
  overflow: scroll;
}

.completed-lyrics {
  color: gray;
}

.current-lyrics {
  color: magenta;
}

span.upcoming-lyrics {
  color: blue;
}
</style>