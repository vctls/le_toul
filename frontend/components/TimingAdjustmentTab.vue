<template>
  <b-tab-item icon="flask" label="Adjust (BETA)" :disabled="!isEnabled" class="timing-adjustment-tab"
    headerClass="timing-adjustment-tab-header">
    <h2 class="title">Adjust Timings</h2>
    <div class="content">
      <p>
        Use this tab to adjust lyric timings by dragging the start of the
        lyric's rectangle. If you marked the end of a lyric with the Enter key,
        you can also adjust the end of it.
      </p>
    </div>
    <b-field label="Shift all timings (ms)" horizontal style="margin-bottom: 0.5em; align-self: flex-start;">
      <b-numberinput v-model="shiftMs" :step="1" controls-position="compact" style="width: 10em;" />
      <b-button label="Apply" @click="applyShift" style="margin-left: 0.5em;" />
    </b-field>
    <b-field label="Playhead preroll (seconds)" horizontal style="margin-bottom: 0.5em; align-self: flex-start;">
      <b-numberinput v-model="prerollSeconds" :min="0" :max="30" :step="1" controls-position="compact" style="width: 8em;" />
    </b-field>
    <subtitle-display class="subtitle-display" v-if="songFile && adjustmentSubtitles" ref="subtitleDisplay" :subtitles="adjustmentSubtitles"
      :fonts="{}" :backgroundColor="settingsStore.videoOptions.color.background.toString()" />
    <timing-adjuster v-if="songFile && adjustmentSubtitles" ref="timing-adjuster" :lyrics="lyricText"
      :timings="timingsStore.rawTimings" :audioData="songFile" :vocalTrack="vocalTrack"
      :prerollSeconds="prerollSeconds" @timingschange="onTimingsChange"
      @timeupdate="onPlayheadUpdate" @seeking="onPlayheadUpdate" />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LyricEvent } from "@/lib/timing";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import { useMediaStore } from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import { BButton, BField, BNumberinput } from "buefy";

export default defineComponent({
  components: { BButton, BField, BNumberinput, TimingAdjuster, SubtitleDisplay },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const settingsStore = useSettingsStore();
    const { lyricText } = storeToRefs(lyricsStore);
    const { subtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      timingsStore,
      settingsStore,
      lyricText,
      subtitles,
    };
  },
  data() {
    return {
      // Controls playhead in video and adjuster (in seconds)
      playhead: 0.0,
      prerollSeconds: 5,
      shiftMs: 0,
    };
  },
  computed: {
    songFile(): Blob | null {
      return this.mediaStore.songFile;
    },
    vocalTrack(): Blob | null {
      return this.mediaStore.separatedTrack?.vocals || null;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    adjustmentSubtitles(): string {
      return this.subtitles({ addTitleScreen: false, addCountIns: false });
    },
  },
  mounted() {
    window.addEventListener('keydown', this.onKeyDown);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown);
  },
  watch: {
    playhead(newPlayhead: number) {
      if (this.$refs.subtitleDisplay) {
        this.$refs.subtitleDisplay.setPlayhead(newPlayhead);
      }
    },
  },
  methods: {
    onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      if (this.$el.offsetParent === null) return;
      event.preventDefault();
      this.$refs['timing-adjuster']?.togglePlayPause();
    },
    applyShift() {
      const deltaSeconds = this.shiftMs / 1000;
      const shifted = this.timingsStore.rawTimings.map(
        ([time, marker]) => [Math.max(0, time + deltaSeconds), marker]
      );
      this.timingsStore.resetTimings(shifted);
    },
    onTimingsChange(newTimings: Array<LyricEvent>) {
      this.timingsStore.resetTimings(newTimings);
    },
    onPlayheadUpdate(newPlayhead: number) {
      if (newPlayhead !== this.playhead) {
        this.playhead = newPlayhead;
      }
    },
  },
});
</script>

<style scoped>
.timing-adjustment-tab {
  display: flex;
  flex-direction: column;
}

.subtitle-display {
  align-self: center;
}
</style>
