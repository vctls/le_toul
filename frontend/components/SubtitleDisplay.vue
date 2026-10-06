<template>
  <div class="video-container">
    <img v-if="backgroundKind === 'image'" class="background" :src="backgroundUrl" alt="" />
    <video
      v-else-if="backgroundKind === 'video'"
      class="background"
      ref="video"
      :src="backgroundUrl"
      muted
      loop
      playsinline
    />
    <canvas
      class="subtitle-canvas"
      ref="subtitleCanvas"
      :style="{
        backgroundColor: background ? 'transparent' : backgroundColor,
      }"
    >
    </canvas>
  </div>
</template>

<script lang="ts">
/* A component that displays an .ass file */

import { throttle, mapKeys, isEqual } from "lodash-es";
import { defineComponent, markRaw } from "vue";
import SubtitlesOctopus from "libass-wasm";
import { syncBackgroundVideo } from "@/lib/backgroundVideo";
import { BackgroundKind, backgroundKind } from "@/lib/background";

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
    // An image or a video.
    background: {
      type: Blob,
      required: false,
    },
    // Needed to display video properly
    audioDelay: {
      type: Number,
      default: 0.0,
    },
    videoOffset: {
      type: Number,
      default: 0.0,
    },
  },
  data() {
    return {
      subtitleManager: null as SubtitlesOctopus | null,
      currentTime: null as number | null,
      isPlaying: false,
      // The display stays mounted when its tab is hidden, but the subtitles keep changing (every
      // timing tap regenerates them). While hidden we only remember the latest version and hand it to
      // the renderer when the display becomes visible again. Nothing here is rendered, hence markRaw.
      view: markRaw({
        isDisplayed: true,
        pendingSubtitles: null as string | null,
        visibilityObserver: null as IntersectionObserver | null,
        resizeObserver: null as ResizeObserver | null,
      }),
    };
  },
  computed: {
    backgroundKind(): BackgroundKind | null {
      return this.background ? backgroundKind(this.background) : null;
    },
    backgroundUrl() {
      if (this.background) {
        return URL.createObjectURL(this.background);
      }
      return undefined;
    },
    effectiveSubtitles(): string {
      return this.subtitles || EMPTY_ASS;
    },
    // The families named by inline \fn tags, as one comparable string.
    inlineFontFamilies(): string {
      const families = [...this.effectiveSubtitles.matchAll(/\\fn([^\\}]+)/g)].map((m) => m[1]);
      return [...new Set(families)].sort().join("\n");
    },
  },
  created() {
    // Scrubbing seeks the video, and Chrome stutters when it seeks more often than this.
    this.syncVideo = throttle(this.syncVideo, 1000 / 15);
  },
  mounted() {
    // The worker renders at the canvas's bitmap size, fixed when it starts,
    // so size the canvas before creating the renderer.
    this.syncCanvasSize();
    this.createRenderer();
    this.currentTime = 0.0;
    this.view.resizeObserver = new ResizeObserver(() => this.syncCanvasSize());
    this.view.resizeObserver.observe(this.$el);
    this.view.visibilityObserver = new IntersectionObserver((entries) => {
      this.view.isDisplayed = entries[entries.length - 1].isIntersecting;
      if (this.view.isDisplayed && this.view.pendingSubtitles !== null) {
        this.subtitleManager?.setTrack(this.view.pendingSubtitles);
        this.view.pendingSubtitles = null;
      }
    });
    this.view.visibilityObserver.observe(this.$el);
  },
  beforeUnmount() {
    this.view.visibilityObserver?.disconnect();
    this.view.resizeObserver?.disconnect();
    this.destroyRenderer();
  },
  watch: {
    effectiveSubtitles(newSubs: string) {
      if (!this.view.isDisplayed) {
        this.view.pendingSubtitles = newSubs;
        return;
      }
      this.subtitleManager?.setTrack(newSubs);
    },
    currentTime(newTime: number) {
      this.subtitleManager?.setCurrentTime(newTime);
    },
    // A paused video would otherwise keep showing the frame from before the change.
    videoOffset() {
      this.syncVideo(this.currentTime ?? 0);
    },
    fonts(newFonts, oldFonts) {
      // libass loads fonts when the worker starts, with no way to add one later, so a
      // new font only takes effect on a fresh renderer.
      if (isEqual(newFonts, oldFonts)) {
        return;
      }
      this.destroyRenderer();
      this.createRenderer();
    },
    // The worker loads an \fn font only from the track it starts with, not from a later setTrack.
    inlineFontFamilies() {
      this.destroyRenderer();
      this.createRenderer();
    },
  },
  methods: {
    syncCanvasSize() {
      const canvas = this.$refs.subtitleCanvas as HTMLCanvasElement | undefined;
      if (!canvas) {
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      // Zero while the tab is hidden. The observer fires again when it is shown.
      if (!width || !height) {
        return;
      }
      if (canvas.width === width && canvas.height === height) {
        return;
      }
      if (this.subtitleManager) {
        this.subtitleManager.resize(width, height);
      } else {
        canvas.width = width;
        canvas.height = height;
      }
    },
    createRenderer() {
      const canvas = this.$refs.subtitleCanvas as HTMLCanvasElement;
      // SubtitleOctopus expects font names to be lowercase
      const fontMap = mapKeys(this.fonts, (_, key) => key.toLowerCase());
      // Create a subtitle renderer and tie it to our player and canvas
      const options = {
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
      // A replacement renderer starts at zero, so put it back where playback is.
      if (this.currentTime) {
        this.subtitleManager.setCurrentTime(this.currentTime);
      }
    },
    destroyRenderer() {
      this.subtitleManager?.dispose?.();
      this.subtitleManager = null;
      // dispose() leaves its last frame on the canvas until the replacement draws.
      const canvas = this.$refs.subtitleCanvas as HTMLCanvasElement | undefined;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    },
    setPlayhead(playhead: number) {
      this.currentTime = playhead;
      this.syncVideo(playhead);
    },
    syncVideo(playhead: number) {
      const video = this.$refs.video as HTMLVideoElement | undefined;
      if (video) {
        syncBackgroundVideo(video, playhead, {
          audioDelay: this.audioDelay,
          videoOffset: this.videoOffset,
          isPlaying: this.isPlaying,
        });
      }
    },
    pause() {
      this.subtitleManager?.setIsPaused(true, this.currentTime);
      this.isPlaying = false;
      this.syncVideo(this.currentTime ?? 0);
    },
    play() {
      this.subtitleManager?.setIsPaused(false, this.currentTime);
      this.isPlaying = true;
      this.syncVideo(this.currentTime ?? 0);
    },
  },
});
</script>

<style scoped>
/* The shape of the output video, 16:9 at every resolution. */
.video-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
}

.background {
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
