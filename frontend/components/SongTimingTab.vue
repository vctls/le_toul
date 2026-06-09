<template>
  <b-tab-item label="Song Timing" icon="stopwatch" class="wrapper song-timing-tab" headerClass="song-timing-tab-header"
    :disabled="!songFile || lyricSegments.length == 0">
    <div class="title-row">
      <h2 class="title">
        Song Timing
        <b-button v-if="isMobile" icon="help" icon-right="circle-question" :type="isShowingHelp ? 'is-primary' : ''"
          @click="isShowingHelp = !isShowingHelp" />
      </h2>
      <voice-selector />
    </div>
    <b-collapse v-model="isShowingHelp" class="content">
      <p>
        Press <kbd>spacebar</kbd> when the singer starts the highlighted
        segment.
      </p>
      <p>
        Press <kbd>Enter</kbd> when the singer finishes the
        <em>previous</em> highlighted segment.
      </p>
      <p>
        Adjust the playback speed to slow down fast parts or skip through long
        instrumentals.
      </p>
    </b-collapse>
    <b-message v-model="warningMessageVisible" type="is-warning" has-icon icon="warning">Almost done! Press
      <kbd>Enter</kbd> when the last line ends.</b-message>
    <b-message v-model="successMessageVisible" type="is-success" has-icon icon="check">Done! You've got everything you
      need to create your video. Go to the
      Submit tab.</b-message>
    <audio ref="audio" :src="audioSource" @ended="onAudioEvent" @pause="onAudioEvent" @play="onAudioEvent"
      @timeupdate="onTimeUpdate" @loadedmetadata="onLoadedMetadata"></audio>
    <div class="level">
      <div class="level-item">
        <div class="buttons">
          <b-button type="is-primary" @click="playPause" name="song-timing-play-pause">
            {{ isPlaying ? "Pause" : "Play" }}
          </b-button>
          <b-button type="is-primary" @click="redoScreen" :active="isPlaying">
            &laquo; Redo This Screen
          </b-button>
          <div class="field">
            <b-button @click="showButtonKeyboard = !showButtonKeyboard" icon-right="keyboard"
              :type="showButtonKeyboard ? 'is-primary' : ''"
              title="Show or hide buttons for entering timings, if you don't have a keyboard"></b-button>
          </div>
        </div>
      </div>
      <div class="level-item">
        <b-field class="playback-speed" label="Speed: " horizontal>
          <b-field class="has-addons">
            <template v-for="val in [0.3, 0.5, 0.7, 0.9, 1.0, 1.5]" :key="val">
              <b-radio-button :size="isMobile ? 'is-small' : ''" v-model="playbackRate" :native-value="val"
                class="is-flex-shrink-0">
                {{ val }}
              </b-radio-button>
            </template>
          </b-field>
        </b-field>
      </div>
    </div>

    <div class="seek-bar">
      <span class="seek-time">{{ formatTime(currentTime) }}</span>
      <input class="seek-slider" type="range" min="0" :max="duration || 0" step="0.01" :value="currentTime"
        :disabled="!duration" @input="onSeek" title="Drag to jump to a position in the track" />
      <span class="seek-time">{{ formatTime(duration) }}</span>
    </div>

    <lyric-display :lyric-segments="segments" :current-segment="currentSegment" @keydown="onKeyDown">
    </lyric-display>
    <timing-buttons v-if="showButtonKeyboard" @keydown="onKeyDown" />
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { KEY_CODES, LYRIC_MARKERS } from "@/constants";
import { isMobile } from "@/lib/device";
import LyricDisplay from "@/components/LyricDisplay.vue";
import TimingButtons from "@/components/TimingButtons.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useMediaStore } from "@/stores/media";
import { VoiceId } from "@/lib/voices";

interface VoiceTimingState {
  currentSegment: number;
  playbackRate: number;
  playhead: number;
}

function defaultVoiceState(): VoiceTimingState {
  return { currentSegment: 0, playbackRate: 1.0, playhead: 0 };
}

export default defineComponent({
  components: { LyricDisplay, TimingButtons, VoiceSelector },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const mediaStore = useMediaStore();
    const { lyricSegments } = storeToRefs(lyricsStore);
    return { timingsStore, lyricsStore, lyricSegments, mediaStore };
  },
  data() {
    return {
      // Per-voice control state, keyed by voice id. Switching voices swaps the whole
      // context (current segment, playback speed, playhead).
      voiceState: {} as Record<VoiceId, VoiceTimingState>,
      isPlaying: false,
      isShowingHelp: !isMobile(),
      showButtonKeyboard: isMobile(),
      currentTime: 0,
      duration: 0,
    };
  },
  computed: {
    isMobile,
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    // The active voice's lyric segments drive the timing UI.
    segments() {
      return this.lyricsStore.segmentsForVoice(this.activeVoice);
    },
    activeState(): VoiceTimingState {
      return this.voiceState[this.activeVoice] ?? defaultVoiceState();
    },
    currentSegment: {
      get(): number {
        return this.activeState.currentSegment;
      },
      set(value: number) {
        this.ensureVoiceState(this.activeVoice).currentSegment = value;
      },
    },
    playbackRate: {
      get(): number {
        return this.activeState.playbackRate;
      },
      set(value: number) {
        this.ensureVoiceState(this.activeVoice).playbackRate = value;
      },
    },
    songFile() {
      return this.mediaStore.songFile;
    },
    audioSource() {
      return this.songFile ? URL.createObjectURL(this.songFile) : null;
    },
    warningMessageVisible: {
      get() {
        return this.timingsStore.areTimingsUsable && !this.timingsStore.areTimingsFinished;
      },
      set(value) {
      }
    },
    successMessageVisible: {
      get() {
        return this.timingsStore.areTimingsFinished;
      },
      set(value) {
      }
    },
    currentScreen() {
      let currentScreen = 0;
      for (let i = 0; i < this.segments.length; i++) {
        const segment = this.segments[i];
        if (i == this.currentSegment) {
          break;
        }
        if (this.isSegmentEndOfScreen(segment, i)) {
          currentScreen += 1;
        }
      }
      return currentScreen;
    },
  },
  watch: {
    isPlaying(newVal) {
      if (newVal) {
        window.addEventListener("keydown", this.onKeyDown);
        this.$refs.audio.play();
      } else {
        window.removeEventListener("keydown", this.onKeyDown);
        this.$refs.audio.pause();
      }
    },
    playbackRate(newRate) {
      if (this.$refs.audio) {
        this.$refs.audio.playbackRate = parseFloat(newRate);
      }
    },
    activeVoice: {
      immediate: true,
      handler(newVoice: VoiceId, oldVoice?: VoiceId) {
        // Save the outgoing voice's playhead, then restore the incoming voice's context.
        if (oldVoice && this.voiceState[oldVoice] && this.$refs.audio) {
          this.voiceState[oldVoice].playhead = this.$refs.audio.currentTime;
        }
        this.isPlaying = false;
        this.ensureVoiceState(newVoice);
        this.$nextTick(() => {
          if (this.$refs.audio) {
            this.$refs.audio.currentTime = this.voiceState[newVoice].playhead;
            this.$refs.audio.playbackRate = parseFloat(String(this.voiceState[newVoice].playbackRate));
          }
        });
      },
    },
  },
  methods: {
    ensureVoiceState(voice: VoiceId): VoiceTimingState {
      if (!this.voiceState[voice]) {
        this.voiceState = { ...this.voiceState, [voice]: defaultVoiceState() };
      }
      return this.voiceState[voice];
    },
    onKeyDown(e: KeyboardEvent) {
      const keyCode = e.keyCode;
      if (Object.values(KEY_CODES).includes(keyCode) && this.isPlaying) {
        const currentSongTime = this.$refs.audio.currentTime;
        if (!this.hasCompletedTimings || keyCode == KEY_CODES.ENTER) {
          this.addTimingEvent(keyCode, currentSongTime);
        }
        e.preventDefault();
        return false;
      }
    },
    addTimingEvent(keyCode, currentSongTime) {
      if (keyCode == KEY_CODES.ENTER) {
        this.timingsStore.add(this.currentSegment - 1, keyCode, currentSongTime);
      } else if (keyCode == KEY_CODES.SPACEBAR) {
        this.advanceToNextSegment(keyCode, currentSongTime);
      }
    },
    advanceToNextSegment(keyCode, currentSongTime) {
      if (this.currentSegment >= this.segments.length) {
        return;
      }
      this.timingsStore.add(this.currentSegment, keyCode, currentSongTime);
      this.currentSegment += 1;
    },
    playPause() {
      this.isPlaying = !this.isPlaying;
    },
    onTimeUpdate() {
      this.currentTime = this.$refs.audio.currentTime;
    },
    onLoadedMetadata() {
      this.duration = this.$refs.audio.duration;
    },
    onSeek(e: Event) {
      this.$refs.audio.currentTime = parseFloat((e.target as HTMLInputElement).value);
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
    onAudioEvent(e: Event) {
      const audioEl = this.$refs.audio;
      this.isPlaying = !(audioEl.paused || audioEl.ended);
      if (e.type == "ended" && !this.hasMarkedEndOfLastLine) {
        this.addTimingEvent(KEY_CODES.ENTER, this.$refs.audio.currentTime);
      }
    },
    redoScreen() {
      var firstSegmentInScreen = this.firstSegmentOfScreen(this.currentScreen);
      if (firstSegmentInScreen == this.currentSegment) {
        // User meant to go back a screen
        firstSegmentInScreen = this.firstSegmentOfScreen(
          Math.max(this.currentScreen - 1, 0)
        );
      }
      this.$refs.audio.currentTime = this.secondsBeforeSegment(
        firstSegmentInScreen,
        5
      );
      this.timingsStore.setCurrentSegment(firstSegmentInScreen);
      this.currentSegment = firstSegmentInScreen;
    },
    firstSegmentOfScreen(screenNum) {
      let currentScreen = 0,
        segmentNum = 0;

      for (segmentNum = 0; currentScreen < screenNum; segmentNum++) {
        if (segmentNum >= this.segments.length) {
          throw Error(`firstSegmentOfScreen: no such screen ${screenNum}`);
        }
        const segment = this.segments[segmentNum];
        if (this.isSegmentEndOfScreen(segment, segmentNum)) {
          currentScreen += 1;
        }
      }
      return segmentNum;
    },
    secondsBeforeSegment(segmentNum, seconds) {
      const segmentStart = this.timingsStore.timingForSegmentNum(segmentNum);
      return Math.max(segmentStart - seconds, 0);
    },
    isSegmentEndOfScreen(segment, segmentIndex) {
      return (
        segment.text.endsWith("\n\n") ||
        segmentIndex == this.segments.length - 1
      );
    },
  },
});
</script>

<style scoped>
.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.playback-speed {
  display: flex;
  flex-grow: 1;
  padding-right: 2em;
}

.playback-speed :deep(.field-body) {
  display: flex;
  flex-direction: row;
}

.playback-speed :deep(.control) {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.is-flex-shrink-0 {
  flex-shrink: 0;
  margin-right: 0.25rem;
}

.seek-bar {
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
  color: var(--text, #4a4a4a);
  min-width: 3ch;
  text-align: center;
}
</style>
