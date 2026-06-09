// stores/timings.ts
import { defineStore } from 'pinia';
import { KEY_CODES, LYRIC_MARKERS } from "@/constants";
import { pullAt } from 'lodash-es';
import { useLyricsStore } from './lyrics';
import { useMediaStore } from './media';
import { useSettingsStore } from './settings';
import { createAssFile, createMultiVoiceAssFile, DEFAULT_KARAOKE_OPTIONS, LyricEvent } from "@/lib/timing";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { VideoSettings } from './settings';
import { VoiceId, DEFAULT_VOICE_ID } from "@/lib/voices";
import { loadJsonFromStorage } from "@/lib/persistence";

const TIMINGS_STORAGE_KEY = 'timings._timings';
const ACTIVE_VOICE_STORAGE_KEY = 'timings._activeVoice';

type Timings = Array<[number, number]>;
type TimingsByVoice = Record<VoiceId, Timings>;

function loadTimingsByVoice(): TimingsByVoice {
  const stored = loadJsonFromStorage<Timings | TimingsByVoice | null>(TIMINGS_STORAGE_KEY, null);
  if (stored == null) {
    return {};
  }
  // Migrate legacy single-voice array into the per-voice map.
  if (Array.isArray(stored)) {
    return stored.length > 0 ? { [DEFAULT_VOICE_ID]: stored } : {};
  }
  return stored;
}

export const useTimingsStore = defineStore('timings', {
  // Timings are stored per voice, never as a single shared stream. Voices are fully
  // independent (see frontend/lib/voices.ts for why): they can overlap in time, so there
  // is no one ordered timeline to share. The single-array API below (rawTimings, add,
  // resetTimings, ...) operates on the *active* voice, which keeps every existing
  // single-voice consumer working unchanged — for a one-voice project the active voice is
  // simply the only voice.
  state: () => ({
    _timingsByVoice: loadTimingsByVoice(),
    _activeVoice: loadJsonFromStorage<VoiceId | null>(ACTIVE_VOICE_STORAGE_KEY, null),
  }),

  getters: {
    // The voice currently being timed. All the single-array getters/actions below operate
    // on this voice, so existing single-voice consumers are unchanged (the active voice is
    // the only voice). Falls back to the first lyrics voice, then the default.
    activeVoice(state): VoiceId {
      const voices = useLyricsStore().voices;
      if (state._activeVoice && voices.includes(state._activeVoice)) {
        return state._activeVoice;
      }
      return voices[0] ?? DEFAULT_VOICE_ID;
    },

    rawTimings(state): Timings {
      return state._timingsByVoice[this.activeVoice] ?? [];
    },

    // The full per-voice timing map (used to export/import all voices at once).
    allTimings(state): TimingsByVoice {
      return state._timingsByVoice;
    },

    length(): number {
      return this.rawTimings.length;
    },

    last() {
      const timings = this.rawTimings;
      return timings.length > 0 ? timings[timings.length - 1] : null;
    },

    toArray() {
      return () => this.rawTimings;
    },

    toJson() {
      return () => JSON.stringify(this.rawTimings);
    },

    areTimingsUsable(): boolean {
      // Check if the active voice has any timings
      if (this.length === 0) {
        return false;
      }

      // Get the active voice's lyric segments
      const lyricSegments = useLyricsStore().segmentsForVoice(this.activeVoice);

      if (!lyricSegments || lyricSegments.length === 0) {
        return false;
      }

      // Count how many segment starts we have
      const startMarkers = this.rawTimings.filter(t => t[1] === LYRIC_MARKERS.SEGMENT_START);

      // Check if we have timing markers for all segments
      if (startMarkers.length < lyricSegments.length) {
        return false;
      }
      return true;
    },

    areTimingsFinished(): boolean {
      // Timings are fully finished when we've marked the end of the last segment
      return this.areTimingsUsable && this.rawTimings[this.length - 1][1] === LYRIC_MARKERS.SEGMENT_END;
    },

    subtitles() {
      return (options: Partial<VideoSettings> = {}): string => {
        // Return empty string if there are no timings at all
        if (this.length === 0) {
          return "";
        }

        const lyricsStore = useLyricsStore();
        const mediaStore = useMediaStore();
        const settingsStore = useSettingsStore();

        try {
          const baseOptions = settingsStore.videoOptions || DEFAULT_KARAOKE_OPTIONS;
          // Apply the active voice's style override (no-op when it has none).
          const voiceOptions = applyVoiceStyle(baseOptions, settingsStore.getVoiceStyle(this.activeVoice));

          const adjustedOptions = {
            ...voiceOptions,
            ...options
          };

          return createAssFile(
            lyricsStore.lyricTextForVoice(this.activeVoice),
            this.rawTimings,
            mediaStore.songDuration,
            mediaStore.songTitle,
            mediaStore.songArtist,
            adjustedOptions
          );
        } catch (e) {
          console.error("Failed to create subtitles", e);
          return "";
        }
      };
    },

    // Voices (from the lyrics) that actually have timings, in document order.
    voicesWithTimings(state): VoiceId[] {
      return useLyricsStore().voices.filter((v) => (state._timingsByVoice[v]?.length ?? 0) > 0);
    },

    timingsForVoice(state) {
      return (voice: VoiceId): Timings => state._timingsByVoice[voice] ?? [];
    },

    // Composited subtitles for ALL voices (used by the Submit preview and final video),
    // as opposed to `subtitles`, which renders only the active voice (used by Adjust).
    allVoicesSubtitles() {
      return (options: Partial<VideoSettings> = {}): string => {
        const lyricsStore = useLyricsStore();
        const settingsStore = useSettingsStore();
        const mediaStore = useMediaStore();
        const baseOptions = settingsStore.videoOptions || DEFAULT_KARAOKE_OPTIONS;

        const tracks = this.voicesWithTimings.map((voice) => ({
          voice,
          lyrics: lyricsStore.lyricTextForVoice(voice),
          timings: this.timingsForVoice(voice),
          options: { ...applyVoiceStyle(baseOptions, settingsStore.getVoiceStyle(voice)), ...options },
        }));
        if (tracks.length === 0) {
          return "";
        }

        try {
          return createMultiVoiceAssFile(
            tracks,
            mediaStore.songDuration,
            mediaStore.songTitle,
            mediaStore.songArtist
          );
        } catch (e) {
          console.error("Failed to create multi-voice subtitles", e);
          return "";
        }
      };
    }
  },

  actions: {
    setActiveVoice(voice: VoiceId) {
      this._activeVoice = voice;
    },

    // Ensure the active voice has a timings array, then return it. Reassigning the map (vs
    // mutating in place) keeps a newly-added voice key reactive.
    ensureActiveTimings(): Timings {
      const voice = this.activeVoice;
      if (!this._timingsByVoice[voice]) {
        this._timingsByVoice = { ...this._timingsByVoice, [voice]: [] };
      }
      return this._timingsByVoice[voice];
    },

    add(currentSegmentNum, keyCode, timestamp) {
      if (currentSegmentNum < 0) {
        return;
      }

      const marker =
        keyCode == KEY_CODES.SPACEBAR
          ? LYRIC_MARKERS.SEGMENT_START
          : LYRIC_MARKERS.SEGMENT_END;

      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        this.handleConflictWithPreviousSegment(timestamp);
      }

      this.ensureActiveTimings().push([timestamp, marker]);
    },

    handleConflictWithPreviousSegment(segmentStartTimestamp) {
      // If the user has entered a segment start time that is before the end of
      // the previous segment, adjust the end of the previous segment
      const timings = this._timingsByVoice[this.activeVoice];
      const previousTiming = timings?.at(-1);
      if (!previousTiming || segmentStartTimestamp > previousTiming[0]) {
        return;
      }

      if (previousTiming[1] == LYRIC_MARKERS.SEGMENT_END) {
        pullAt(timings, [timings.length - 1]);
      }
    },

    timingForSegmentNum(segmentNum) {
      const starts = this.rawTimings.filter(
        (t) => t[1] == LYRIC_MARKERS.SEGMENT_START
      );

      if (segmentNum >= starts.length) {
        return 0;
      }

      return starts[segmentNum][0];
    },

    setCurrentSegment(segmentNum) {
      // Set the segment we're currently listening for to segmentNum
      const timings = this.rawTimings;
      let i = 0,
        currentSegment = 0;

      while (i < timings.length) {
        if (timings[i][1] == LYRIC_MARKERS.SEGMENT_START) {
          currentSegment += 1;
        }

        if (currentSegment > segmentNum) {
          break;
        }

        i++;
      }

      this.resetTimings(timings.slice(0, i));
    },

    resetTimings(newTimings: Timings = []) {
      this._timingsByVoice = { ...this._timingsByVoice, [this.activeVoice]: [...newTimings] };
    },

    // Replace all voices' timings at once (used when importing a multi-voice timings file).
    setAllTimings(byVoice: TimingsByVoice) {
      this._timingsByVoice = { ...byVoice };
    },

    clear() {
      this._timingsByVoice = {};
    },

    setupPersistence() {
      this.$subscribe((_mutation, state) => {
        try {
          localStorage.setItem(TIMINGS_STORAGE_KEY, JSON.stringify(state._timingsByVoice));
          localStorage.setItem(ACTIVE_VOICE_STORAGE_KEY, JSON.stringify(state._activeVoice));
        } catch (e) {
          console.error(`Failed to save ${TIMINGS_STORAGE_KEY} to localStorage`, e);
        }
      });
    }
  }
});
