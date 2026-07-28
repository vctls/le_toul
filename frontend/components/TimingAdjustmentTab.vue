<template>
  <b-tab-item icon="flask" label="Adjust" :disabled="!isEnabled" class="timing-adjustment-tab"
    headerClass="timing-adjustment-tab-header">
    <div class="title-row">
      <h2 class="title">Adjust Timings</h2>
      <voice-selector />
    </div>
    <div class="content">
      <p>
        Use this tab to adjust lyric timings by dragging the start of the
        lyric's rectangle. Drag the end of the rectangle to adjust the release.
        Drag the end up to the start of the next rectangle to join them.
        When rectangles are joined, dragging the start of the next rectangle
        will move the end of the previous rectangle.
      </p>
      <p>
        Press <kbd>spacebar</kbd> to start and stop playback, and
        <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to move the playhead by the preroll set below.
        Hold <kbd>shift</kbd> for steps five times as long.
        Press <kbd>Enter</kbd> to play again from the last position you set yourself,
        by clicking the waveform, using the arrow keys, or dragging a timing.
        Scroll up and down on the waveform to zoom in and out on the area under the cursor.
      </p>
    </div>
    <div class="adjustment-form">
      <b-field label="Waveform zoom" horizontal style="margin-bottom: 0.5em;">
        <b-numberinput v-model="zoom" :min="10" :max="500" :step="10" controls-position="compact" style="width: 10em;" />
      </b-field>
      <b-field label="Playback rate" horizontal style="margin-bottom: 0.5em;">
        <b-numberinput v-model="playbackRate" :min="0.25" :max="2" :step="0.25" controls-position="compact" style="width: 10em;" />
      </b-field>
      <b-field label="Shift all timings (ms)" horizontal style="margin-bottom: 0.5em;">
        <b-numberinput v-model="shiftMs" :step="1" controls-position="compact" style="width: 10em;" />
        <b-button label="Apply" @click="applyShift" style="margin-left: 0.5em;" />
      </b-field>
      <b-field label="Playhead preroll (seconds)" horizontal style="margin-bottom: 0.5em;">
        <b-numberinput v-model="prerollSeconds" :min="0" :max="30" :step="1" controls-position="compact" style="width: 8em;" />
      </b-field>
      <b-field v-if="vocalTrack" label="Playback track" horizontal style="margin-bottom: 0.5em;">
        <b-select v-model="playbackTrackChoice" style="width: 10em;">
          <option value="full">Full track</option>
          <option value="vocals">Vocals only</option>
        </b-select>
      </b-field>
    </div>
    <subtitle-display class="subtitle-display" v-if="songFile && debouncedSubtitles" ref="subtitleDisplay" :subtitles="debouncedSubtitles"
      :fonts="{}" :backgroundColor="settingsStore.videoOptions.color.background.toString()" />
    <timing-adjuster v-if="songFile && adjustmentSubtitles" ref="timing-adjuster" :lyrics="voiceLyrics"
      :timings="timingsStore.rawTimings" :audioData="songFile" :vocalTrack="vocalTrack" :playbackTrack="playbackTrack"
      :prerollSeconds="prerollSeconds" :zoom="zoom" :playbackRate="playbackRate" @timingschange="onTimingsChange" @zoom-change="onZoomChange"
      @timeupdate="onPlayheadUpdate" @seeking="onSeek" />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LyricEvent } from "@/lib/timing";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useMediaStore } from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import { BButton, BField, BNumberinput, BSelect } from "buefy";
import { VoiceId } from "@/lib/voices";
import { clampTimingOverlaps } from "@/lib/timingValidation";

// The arrow keys step by the playhead preroll, so stepping and the preview jump
// after a drag agree on what one step is worth. Shift takes five of them.
const COARSE_STEP_MULTIPLIER = 5;

interface AdjustVoiceState {
  playhead: number;
  manualPlayhead: number;
  prerollSeconds: number;
  shiftMs: number;
  zoom: number;
  playbackRate: number;
  playbackTrackChoice: "full" | "vocals";
}

function defaultAdjustState(): AdjustVoiceState {
  return { playhead: 0.0, manualPlayhead: 0.0, prerollSeconds: 1, shiftMs: 0, zoom: 50, playbackRate: 1, playbackTrackChoice: "full" };
}

export default defineComponent({
  components: { BButton, BField, BNumberinput, BSelect, TimingAdjuster, SubtitleDisplay, VoiceSelector },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const settingsStore = useSettingsStore();
    const { subtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      timingsStore,
      lyricsStore,
      settingsStore,
      subtitles,
    };
  },
  data() {
    return {
      // Controls playhead in video and adjuster (in seconds)
      playhead: 0.0,
      // Last playhead position the user set on purpose (waveform click, player
      // seek, or the preroll jump after a timing drag), as opposed to one
      // reached by playback running on. Enter replays from here.
      manualPlayhead: 0.0,
      prerollSeconds: 1,
      shiftMs: 0,
      zoom: 50,
      playbackRate: 1,
      // Which track to play back; the waveform always stays on the vocals.
      playbackTrackChoice: "full" as "full" | "vocals",
      // Per-voice control state. The flat fields above are the *active* voice's values;
      // on a voice switch they are saved here and the incoming voice's values are loaded.
      voiceState: {} as Record<VoiceId, AdjustVoiceState>,
      // Debounced copy of `adjustmentSubtitles` fed to the SubtitleDisplay.
      // Regenerating the ASS file and re-rendering it (SubtitlesOctopus.setTrack,
      // a WASM re-parse) is expensive, so we defer it until dragging settles.
      debouncedSubtitles: "",
      _subtitleDebounceTimer: null as ReturnType<typeof setTimeout> | null,
    };
  },
  computed: {
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    voiceLyrics(): string {
      return this.lyricsStore.lyricTextForVoice(this.activeVoice);
    },
    songFile(): Blob | null {
      return this.mediaStore.songFile;
    },
    vocalTrack(): Blob | null {
      // setBackingTrack() uses an empty Blob as a "no vocals" placeholder, so
      // an empty blob means there is no usable vocal track.
      const vocals = this.mediaStore.separatedTrack?.vocals;
      return vocals && vocals.size > 0 ? vocals : null;
    },
    playbackTrack(): Blob | null {
      if (this.playbackTrackChoice === "vocals" && this.vocalTrack) {
        return this.vocalTrack;
      }
      return this.songFile;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    adjustmentSubtitles(): string {
      return this.subtitles({ addTitleScreen: false, addCountIns: false });
    },
  },
  mounted() {
    // Capture phase: the audio element's built-in controls handle these same
    // keys when they have focus, so we have to get in ahead of them and cancel
    // the native behavior. A bubble-phase listener runs too late and both act.
    window.addEventListener('keydown', this.onKeyDown, true);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    if (this._subtitleDebounceTimer) {
      clearTimeout(this._subtitleDebounceTimer);
    }
  },
  watch: {
    activeVoice(newVoice: VoiceId, oldVoice?: VoiceId) {
      // Save the outgoing voice's control state and load the incoming voice's.
      if (oldVoice) {
        this.voiceState = { ...this.voiceState, [oldVoice]: this.snapshotState() };
      }
      this.loadState(newVoice);
    },
    playhead(newPlayhead: number) {
      if (this.$refs.subtitleDisplay) {
        this.$refs.subtitleDisplay.setPlayhead(newPlayhead);
      }
    },
    adjustmentSubtitles: {
      handler(newSubs: string) {
        // First population (and clearing) should be immediate so the preview
        // appears without delay; rapid edits while dragging are debounced.
        if (!this.debouncedSubtitles || !newSubs) {
          if (this._subtitleDebounceTimer) {
            clearTimeout(this._subtitleDebounceTimer);
            this._subtitleDebounceTimer = null;
          }
          this.debouncedSubtitles = newSubs;
          return;
        }
        if (this._subtitleDebounceTimer) {
          clearTimeout(this._subtitleDebounceTimer);
        }
        this._subtitleDebounceTimer = setTimeout(() => {
          this.debouncedSubtitles = newSubs;
          this._subtitleDebounceTimer = null;
        }, 250);
      },
      immediate: true,
    },
  },
  methods: {
    snapshotState(): AdjustVoiceState {
      return {
        playhead: this.playhead,
        manualPlayhead: this.manualPlayhead,
        prerollSeconds: this.prerollSeconds,
        shiftMs: this.shiftMs,
        zoom: this.zoom,
        playbackRate: this.playbackRate,
        playbackTrackChoice: this.playbackTrackChoice,
      };
    },
    loadState(voice: VoiceId) {
      const state = this.voiceState[voice] ?? defaultAdjustState();
      this.playhead = state.playhead;
      this.manualPlayhead = state.manualPlayhead;
      this.prerollSeconds = state.prerollSeconds;
      this.shiftMs = state.shiftMs;
      this.zoom = state.zoom;
      this.playbackRate = state.playbackRate;
      this.playbackTrackChoice = state.playbackTrackChoice;
    },
    onZoomChange(delta: number) {
      this.zoom = Math.min(500, Math.max(10, this.zoom + delta));
    },
    onKeyDown(event: KeyboardEvent) {
      const isEnter = event.code === 'Enter' || event.code === 'NumpadEnter';
      const isArrow = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
      if (event.code !== 'Space' && !isEnter && !isArrow) return;
      const target = event.target as HTMLElement | null;
      // Form controls need these keys for themselves.
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      // Enter is also how a focused button or link is activated, so leave those
      // to the browser rather than hijacking the key.
      if (isEnter && target?.closest?.('button, a')) return;
      if (this.$el.offsetParent === null) return;
      event.preventDefault();
      if (isEnter) {
        this.$refs['timing-adjuster']?.restartAt(this.manualPlayhead);
      } else if (isArrow) {
        const direction = event.code === 'ArrowLeft' ? -1 : 1;
        const step = event.shiftKey
          ? this.prerollSeconds * COARSE_STEP_MULTIPLIER
          : this.prerollSeconds;
        this.$refs['timing-adjuster']?.seekBy(direction * step);
      } else {
        this.$refs['timing-adjuster']?.togglePlayPause();
      }
    },
    applyShift() {
      const deltaSeconds = this.shiftMs / 1000;
      const shifted = this.timingsStore.rawTimings.map(
        ([time, marker]) => [Math.max(0, time + deltaSeconds), marker]
      );
      this.timingsStore.resetTimings(clampTimingOverlaps(shifted));
    },
    onTimingsChange(newTimings: Array<LyricEvent>) {
      // Guard against a committed overlap (an end past the next segment's start).
      this.timingsStore.resetTimings(clampTimingOverlaps(newTimings));
    },
    onPlayheadUpdate(newPlayhead: number) {
      if (newPlayhead !== this.playhead) {
        this.playhead = newPlayhead;
      }
    },
    // Every seek is a deliberate move of the playhead (playback progress comes
    // through as a timeupdate instead), so it becomes the Enter replay point.
    onSeek(newPlayhead: number) {
      this.manualPlayhead = newPlayhead;
      this.onPlayheadUpdate(newPlayhead);
    },
  },
});
</script>

<style scoped>
.timing-adjustment-tab {
  display: flex;
  flex-direction: column;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.timing-adjustment-tab :deep(.field-label) {
  white-space: nowrap;
  text-align: left;
  flex-shrink: 0;
}

/* Single column on small screens; two columns from the tablet breakpoint
   (medium) up. The fields stay a flat list in the markup and flow into
   whatever number of columns the viewport allows. */
.adjustment-form {
  display: grid;
  grid-template-columns: 1fr;
  column-gap: 1.5rem;
}

@media screen and (min-width: 769px) {
  .adjustment-form {
    grid-template-columns: 1fr 1fr;
  }
}

.subtitle-display {
  align-self: center;
}
</style>
