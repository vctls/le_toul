<template>
  <div class="video-container">
    <video
      class="background-video"
      v-if="videoBlob"
      ref="video"
      :src="videoDataUrl"
    />
    <canvas
      class="subtitle-canvas"
      ref="subtitleCanvas"
      :style="{
        backgroundColor: videoBlob ? 'transparent' : backgroundColor,
      }"
    >
    </canvas>
  </div>
</template>

<script lang="ts">
/* A component that displays an .ass file */

import { throttle, mapKeys } from "lodash-es";
import { defineComponent } from "vue";
import SubtitlesOctopus from "libass-wasm";

// Minimal valid ASS file, used when there are no subtitles yet (e.g. the
// preview is shown before timings exist). SubtitlesOctopus can't handle an
// empty string.
const EMPTY_ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

export default defineComponent({
  props: {
    subtitles: {
      type: String,
      required: true,
    },
    fonts: {
      type: Object,
    },
    backgroundColor: {
      type: String,
      default: "#000000",
    },
    videoBlob: {
      type: Blob,
      required: false,
    },
    // Needed to display video properly
    audioDelay: {
      type: Number,
      default: 0.0,
    },
  },
  data() {
    return {
      subtitleManager: null,
      currentTime: null,
    };
  },
  computed: {
    videoDataUrl() {
      if (this.videoBlob) {
        return URL.createObjectURL(this.videoBlob);
      }
      return null;
    },
    effectiveSubtitles(): string {
      return this.subtitles || EMPTY_ASS;
    },
  },
  created() {
    // Chrome video stutters when currentTime is set frequently, so we throttle it to 15fps
    this.setVideoPlayhead = throttle(this.setVideoPlayhead, 1000 / 15);
    // The display stays mounted when its tab is hidden, but the subtitles
    // keep changing (every timing tap regenerates them). While hidden we
    // only remember the latest version and hand it to the renderer when the
    // display becomes visible again. Deliberately not reactive.
    this.isDisplayed = true;
    this.pendingSubtitles = null;
  },
  mounted() {
    const canvas = this.$refs.subtitleCanvas;
    // SubtitleOctopus expects font names to be lowercase
    const fontMap = mapKeys(this.fonts, (_, key) => key.toLowerCase());
    // Create a subtitle renderer and tie it to our player and canvas
    var options = {
      debug: false,
      canvas: canvas,
      subContent: this.effectiveSubtitles,
      lazyFileLoading: true,
      availableFonts: fontMap,
      // workerUrl: require("!!file-loader?name=[name].[ext]!libass-wasm/dist/subtitles-octopus-worker.js"),
      // workerUrl: workerUrl,
      workerUrl: "/static/subtitles-octopus-worker.js", // Link to WebAssembly-based file "libassjs-worker.js"
      legacyWorkerUrl: "/static/subtitles-octopus-worker-legacy.js", // Link to non-WebAssembly worker
    };
    this.subtitleManager = new SubtitlesOctopus(options);
    this.currentTime = 0.0;
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.isDisplayed = entries[entries.length - 1].isIntersecting;
      if (this.isDisplayed && this.pendingSubtitles !== null) {
        this.subtitleManager.setTrack(this.pendingSubtitles);
        this.pendingSubtitles = null;
      }
    });
    this.visibilityObserver.observe(this.$el);
  },
  beforeUnmount() {
    this.visibilityObserver?.disconnect();
  },
  watch: {
    effectiveSubtitles(newSubs: string) {
      if (!this.isDisplayed) {
        this.pendingSubtitles = newSubs;
        return;
      }
      this.subtitleManager.setTrack(newSubs);
    },
    currentTime(newTime: number) {
      this.subtitleManager.setCurrentTime(newTime);
    },
  },
  methods: {
    setPlayhead(playhead: number) {
      this.currentTime = playhead;
      this.setVideoPlayhead(Math.max(0, playhead - this.audioDelay));
    },
    setVideoPlayhead(playhead: number) {
      if (this.$refs.video) {
        this.$refs.video.currentTime = playhead;
      }
    },
    pause() {
      this.subtitleManager.setIsPaused(true, this.currentTime);
    },
    play() {
      this.subtitleManager.setIsPaused(false, this.currentTime);
    },
  },
});
</script>

<style scoped>
.video-container {
  position: relative;
  height: 240px;
  width: 320px;
}

.background-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.subtitle-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>