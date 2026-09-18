<template>
  <b-tab-item
    value="adjust"
    icon="flask"
    label="Adjust"
    :disabled="!isEnabled"
    class="timing-adjustment-tab"
    headerClass="timing-adjustment-tab-header"
  >
    <div class="title-row">
      <h2 class="title">Adjust Timings</h2>
      <voice-selector />
    </div>
    <help-section>
      <p>
        Use this tab to adjust lyric timings by dragging the start of the lyric's rectangle. Drag
        the end of the rectangle to adjust the release. Drag the end up to the start of the next
        rectangle to join them. When rectangles are joined, dragging the start of the next rectangle
        will move the end of the previous rectangle.
      </p>
      <p>
        Click a rectangle to select it, then click another one to select every rectangle between the
        two. Dragging any selected rectangle moves the whole selection at once, up to the rectangles
        on either side of it. Click a selected rectangle or press <kbd>Esc</kbd> to clear the
        selection.
      </p>
      <p>
        Press <kbd>spacebar</kbd> to start and stop playback, and <kbd>&larr;</kbd>
        <kbd>&rarr;</kbd> to move the playhead by the preroll set below. Hold <kbd>shift</kbd> for
        steps five times as long. <kbd>Home</kbd> and <kbd>End</kbd> move it to the left and right
        edges of the waveform as it is currently scrolled, and <kbd>ctrl</kbd> with either one moves
        it to the very beginning or end of the song. Press <kbd>Enter</kbd> to play again from the
        last position you set yourself, by clicking the waveform, using the arrow keys, or dragging
        a timing. Scroll up and down on the waveform to zoom in and out on the area under the
        cursor.
      </p>
    </help-section>
    <div class="adjustment-form">
      <div class="adjustment-fields">
        <b-field label="Playback rate" horizontal>
          <b-numberinput
            expanded
            :model-value="playbackRate"
            @update:model-value="
              (v: number | null | undefined) => (playbackRate = Number(v ?? playbackRate))
            "
            :min="0.25"
            :max="2"
            :step="0.25"
            controls-position="compact"
          />
        </b-field>
        <b-field horizontal>
          <template #label>
            Preserve pitch
            <b-tooltip
              multilined
              label="Hold the original key at other speeds. The stretching it needs sounds rough well below 1x."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-switch v-model="preservePitch"></b-switch>
        </b-field>
        <b-field label="Waveform zoom" horizontal>
          <b-numberinput
            expanded
            :model-value="zoom"
            @update:model-value="(v: number | null | undefined) => (zoom = Number(v ?? zoom))"
            :min="10"
            :max="500"
            :step="10"
            controls-position="compact"
          />
        </b-field>
        <b-field label="Shift all timings (ms)" horizontal>
          <b-numberinput
            expanded
            :model-value="shiftMs"
            @update:model-value="(v: number | null | undefined) => (shiftMs = Number(v ?? shiftMs))"
            :step="1"
            controls-position="compact"
          />
          <b-button label="Apply" @click="applyShift" />
        </b-field>
        <b-field label="Playhead preroll (seconds)" horizontal>
          <b-numberinput
            expanded
            :model-value="prerollSeconds"
            @update:model-value="
              (v: number | null | undefined) => (prerollSeconds = Number(v ?? prerollSeconds))
            "
            :min="0"
            :max="30"
            :step="1"
            controls-position="compact"
          />
        </b-field>
        <b-field v-if="vocalTrack" label="Playback track" horizontal>
          <b-select expanded v-model="playbackTrackChoice">
            <option value="full">Full track</option>
            <option value="vocals">Vocals only</option>
          </b-select>
        </b-field>
      </div>
    </div>
    <subtitle-display
      class="subtitle-display"
      v-if="songFile && debouncedSubtitles"
      ref="subtitleDisplay"
      :subtitles="debouncedSubtitles"
      :fonts="{}"
      :backgroundColor="settingsStore.videoOptions.color.background.toString()"
    />
    <timing-adjuster
      v-if="songFile && adjustmentSubtitles"
      ref="timing-adjuster"
      :lyrics="voiceLyrics"
      :timings="timingsStore.rawTimings"
      :audioData="songFile ?? undefined"
      :vocalTrack="vocalTrack ?? undefined"
      :playbackTrack="playbackTrack ?? undefined"
      :prerollSeconds="prerollSeconds"
      :zoom="zoom"
      :playbackRate="playbackRate"
      :preservePitch="preservePitch"
      @timingschange="onTimingsChange"
      @zoom-change="onZoomChange"
      @timeupdate="onPlayheadUpdate"
      @seeking="onSeek"
    />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LyricEvent } from "@/lib/timing";
import HelpSection from "@/components/HelpSection.vue";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useMediaStore } from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import { BButton, BField, BNumberinput, BSelect, BSwitch } from "buefy";
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
  return {
    playhead: 0.0,
    manualPlayhead: 0.0,
    prerollSeconds: 1,
    shiftMs: 0,
    zoom: 50,
    playbackRate: 1,
    playbackTrackChoice: "full",
  };
}

export default defineComponent({
  components: {
    BButton,
    BField,
    BNumberinput,
    BSelect,
    BSwitch,
    HelpSection,
    TimingAdjuster,
    SubtitleDisplay,
    VoiceSelector,
  },
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
      // Last playhead position the user set on purpose (waveform click, player seek,
      // or the preroll jump after a timing drag), as opposed to one reached by playback running on.
      // Enter replays from here.
      manualPlayhead: 0.0,
      prerollSeconds: 1,
      shiftMs: 0,
      zoom: 50,
      playbackRate: 1,
      // Default off: the browser's stretcher warbles at slow rates,
      // and a dropped key costs nothing while tapping timings.
      preservePitch: false,
      // Which track to play back; the waveform always stays on the vocals.
      playbackTrackChoice: "full" as "full" | "vocals",
      // Per-voice control state.
      // The flat fields above are the *active* voice's values.
      // On a voice switch they are saved here and the incoming voice's values are loaded.
      voiceState: {} as Record<VoiceId, AdjustVoiceState>,
      // Debounced copy of `adjustmentSubtitles` fed to the SubtitleDisplay.
      // Regenerating the ASS file and re-rendering it (SubtitlesOctopus.setTrack, a WASM re-parse) is expensive,
      // so we defer it until dragging settles.
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
      // setBackingTrack() uses an empty Blob as a "no vocals" placeholder,
      // so an empty blob means there is no usable vocal track.
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
      return this.subtitles({ addTitleScreen: false, countInMode: "none" });
    },
  },
  mounted() {
    // Capture phase: the audio element's built-in controls handle these same keys when they have focus,
    // so we have to get in ahead of them and cancel the native behavior.
    // A bubble-phase listener runs too late and both act.
    window.addEventListener("keydown", this.onKeyDown, true);
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown, true);
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
      this.subtitleDisplayRef()?.setPlayhead(newPlayhead);
    },
    adjustmentSubtitles: {
      handler(newSubs: string) {
        // First population (and clearing) should be immediate so the preview appears without delay.
        // Rapid edits while dragging are debounced.
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
    // $refs is not reactive, so these must be read on each call rather than cached.
    subtitleDisplayRef() {
      return this.$refs.subtitleDisplay as InstanceType<typeof SubtitleDisplay> | undefined;
    },
    timingAdjusterRef() {
      return this.$refs["timing-adjuster"] as InstanceType<typeof TimingAdjuster> | undefined;
    },
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
      const isEnter = event.code === "Enter" || event.code === "NumpadEnter";
      const isArrow = event.code === "ArrowLeft" || event.code === "ArrowRight";
      const isEscape = event.code === "Escape";
      const isViewEdge = event.code === "Home" || event.code === "End";
      if (event.code !== "Space" && !isEnter && !isArrow && !isEscape && !isViewEdge) return;
      const target = event.target as HTMLElement | null;
      // Form controls need these keys for themselves.
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // Enter is also how a focused button or link is activated,
      // so leave those to the browser rather than hijacking the key.
      if (isEnter && target?.closest?.("button, a")) return;
      if (this.$el.offsetParent === null) return;
      event.preventDefault();
      if (isEscape) {
        this.timingAdjusterRef()?.clearSelection();
      } else if (isViewEdge) {
        const edge = event.code === "Home" ? "start" : "end";
        const adjuster = this.timingAdjusterRef();
        if (event.ctrlKey) {
          adjuster?.seekToTrackEdge(edge);
        } else {
          adjuster?.seekToViewEdge(edge);
        }
      } else if (isEnter) {
        this.timingAdjusterRef()?.restartAt(this.manualPlayhead);
      } else if (isArrow) {
        const direction = event.code === "ArrowLeft" ? -1 : 1;
        const step = event.shiftKey
          ? this.prerollSeconds * COARSE_STEP_MULTIPLIER
          : this.prerollSeconds;
        this.timingAdjusterRef()?.seekBy(direction * step);
      } else {
        this.timingAdjusterRef()?.togglePlayPause();
      }
    },
    applyShift() {
      const deltaSeconds = this.shiftMs / 1000;
      const shifted = this.timingsStore.rawTimings.map(([time, marker]): LyricEvent => [
        Math.max(0, time + deltaSeconds),
        marker,
      ]);
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
  margin-bottom: var(--bulma-block-spacing);
}

/* Bulma only spaces a title that is :not(:last-child), and the voice selector beside it
   is v-if'd away for single-voice songs. The row owns the spacing instead. */
.title-row .title {
  margin-bottom: 0;
}

/* Two columns for as long as they fit, in labels-beside-control form while there is room for that and stacked below.
Bulma keys the same switch off the viewport, which overshoots here: the tab strip takes a fixed slice of it.
The query has to be answered by an ancestor, hence the wrapper around the grid. */
.adjustment-form {
  container-type: inline-size;
}

.adjustment-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: 1.5rem;
  row-gap: 0.5rem;
  justify-items: center;
}

.adjustment-fields > :deep(.field) {
  margin-bottom: 0;
}

.adjustment-fields :deep(.field.is-horizontal) {
  display: block;
}

.adjustment-fields :deep(.field-label) {
  white-space: nowrap;
  text-align: left;
  margin: 0 0 0.25rem;
}

/* Bulma only makes this a row, and only spaces and de-margins its children, from its tablet breakpoint up.
This tab switches on the container, not the viewport. */
.adjustment-fields :deep(.field-body) {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.adjustment-fields :deep(.field-body .field) {
  margin: 0;
}

/* Bulma's own opt-out for this is .field-body > .field.is-narrow, but BFieldBody
generates these wrappers itself and forwards no class, so it has to be CSS. */
.adjustment-fields :deep(.field-body > .field) {
  flex-grow: 0;
  min-width: 0;
}

/* Two columns of label-above-control need 13rem each, the width of the longest label. */
@container (min-width: 28rem) {
  .adjustment-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Labels move beside their control once each column can hold both, plus room for
the Apply button beside the widest row: 13rem of label and 10em of control. */
@container (min-width: 62rem) {
  /* Both columns get the same label and control tracks, so every field is the same width.
  The floor clears the longest label; max-content grows a longer one rather than clipping it,
  at the cost of that column no longer matching. The empty outer tracks of each pair split the leftover space,
  centering the label and control in their column. */
  .adjustment-fields {
    grid-template-columns: repeat(
      2,
      minmax(0, 1fr) minmax(13rem, max-content) minmax(0, auto) minmax(0, 1fr)
    );
    column-gap: 0.75rem;
    justify-items: stretch;
  }

  /* Subgrid, so every label in a column is as wide as that column's widest
  and all its controls start at the same offset. */
  .adjustment-fields > :deep(.field.is-horizontal) {
    display: grid;
    grid-column: span 4;
    grid-template-columns: subgrid;
    /* Rows stretch to the tallest control on the line; centering keeps each label on its own control. */
    align-items: center;
  }

  .adjustment-fields :deep(.field-label) {
    grid-column: 2;
    margin: 0;
  }
}

.adjustment-fields :deep(.b-numberinput),
.adjustment-fields :deep(.select) {
  width: 10em;
}

/* Bulma's input padding alone is wider than the value at the narrowest column. */
.adjustment-fields :deep(.b-numberinput input) {
  padding-inline: 0.25em;
}

.subtitle-display {
  align-self: center;
  width: 320px;
}
</style>
