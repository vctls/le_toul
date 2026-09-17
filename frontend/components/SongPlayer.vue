<template>
  <div class="song-player">
    <b-button type="is-primary" @click="playPause" :disabled="!src" name="song-player-play-pause">
      {{ isPlaying ? "Pause" : "Play" }}
    </b-button>
    <span class="seek-time">{{ formatTime(currentTime) }}</span>
    <input
      class="seek-slider"
      type="range"
      min="0"
      :max="duration || 0"
      step="0.01"
      :value="currentTime"
      :disabled="!duration"
      @input="onSeek"
      title="Drag to jump to a position in the track"
    />
    <span class="seek-time">{{ formatTime(duration) }}</span>
    <audio
      ref="audio"
      :src="src"
      @play="onAudioEvent"
      @pause="onAudioEvent"
      @ended="onAudioEvent"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
    ></audio>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { claimMediaKeys, registerPlayer } from "@/lib/exclusivePlayback";

export default defineComponent({
  props: {
    file: {
      type: Object as PropType<Blob | null>,
      default: null,
    },
  },
  data() {
    return {
      src: undefined as string | undefined,
      unregisterPlayer: null as (() => void) | null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    };
  },
  mounted() {
    const audio = this.audioElement();
    if (audio) {
      this.unregisterPlayer = registerPlayer(audio);
    }
  },
  watch: {
    file: {
      immediate: true,
      handler(file: Blob | null) {
        this.setSource(file);
      },
    },
  },
  beforeUnmount() {
    this.unregisterPlayer?.();
    this.setSource(null);
  },
  methods: {
    audioElement(): HTMLAudioElement | undefined {
      return this.$refs.audio as HTMLAudioElement | undefined;
    },
    setSource(file: Blob | null) {
      if (this.src) {
        URL.revokeObjectURL(this.src);
      }
      this.src = file ? URL.createObjectURL(file) : undefined;
      this.isPlaying = false;
      this.currentTime = 0;
      this.duration = 0;
    },
    playPause() {
      const audio = this.audioElement();
      if (!audio) return;
      if (audio.paused || audio.ended) {
        audio.play();
      } else {
        audio.pause();
      }
    },
    onAudioEvent() {
      const audio = this.audioElement();
      if (!audio) return;
      this.isPlaying = !(audio.paused || audio.ended);
    },
    onTimeUpdate() {
      this.currentTime = this.audioElement()?.currentTime ?? 0;
    },
    onLoadedMetadata() {
      this.duration = this.audioElement()?.duration ?? 0;
    },
    onSeek(e: Event) {
      const audio = this.audioElement();
      if (!audio) return;
      audio.currentTime = parseFloat((e.target as HTMLInputElement).value);
      claimMediaKeys(audio);
    },
    formatTime(seconds: number): string {
      if (!seconds || !isFinite(seconds)) {
        return "0:00";
      }
      const totalSec = Math.floor(seconds);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      return `${mm}:${ss.toString().padStart(2, "0")}`;
    },
  },
});
</script>

<style scoped>
.song-player {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.seek-slider {
  flex-grow: 1;
  cursor: pointer;
  accent-color: #7957d5;
}

.seek-slider:disabled {
  cursor: default;
}

.seek-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  color: var(--bulma-text, #4a4a4a);
  min-width: 3ch;
  text-align: center;
}
</style>
