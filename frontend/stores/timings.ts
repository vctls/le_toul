// stores/timings.ts
import { defineStore } from "pinia";
import { watch } from "vue";
import { LYRIC_MARKERS } from "@/constants";
import { findLastIndex } from "lodash-es";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";
import {
  createAssFile,
  createMultiVoiceAssFile,
  resolveStarts,
  DEFAULT_KARAOKE_OPTIONS,
} from "@/lib/timing";
import {
  TimedSegment,
  TimingsFile,
  TIMINGS_FILE_VERSION,
  fromEvents,
  toEvents,
  reconcile,
} from "@/lib/timedSegments";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { VideoSettings } from "./settings";
import { VoiceId, DEFAULT_VOICE_ID, parseAnnotatedLyrics } from "@/lib/voices";
import { loadJsonFromStorage } from "@/lib/persistence";
import { writeTimingsText } from "@/lib/timingsText";

const SEGMENTS_STORAGE_KEY = "timings._segments";
// This key is read-only now.
// It holds the pre-TimedSegment shape, which is migrated on load and
// left in place so a failed migration can't destroy a user's timings.
const LEGACY_TIMINGS_STORAGE_KEY = "timings._timings";
const ACTIVE_VOICE_STORAGE_KEY = "timings._activeVoice";

type Timings = Array<[number, number]>;

// Video settings as a subtitle caller may override them:
// any subset, down to a single font or color field.
type VideoSettingsOverride = Partial<Omit<VideoSettings, "font" | "color">> & {
  font?: Partial<VideoSettings["font"]>;
  color?: Partial<VideoSettings["color"]>;
};
type TimingsByVoice = Record<VoiceId, Timings>;
type SegmentsByVoice = Record<VoiceId, TimedSegment[]>;

/**
 * The lyrics as persisted, split per voice.
 * Read straight from localStorage rather than through the lyrics store,
 * which may not have hydrated yet when this store initializes.
 */
function storedLyricTextByVoice(): Record<VoiceId, string> {
  const text = loadJsonFromStorage<string>("lyrics.lyricText", "");
  return parseAnnotatedLyrics(text).lyricTextByVoice;
}

function migrateEvents(byVoice: TimingsByVoice): SegmentsByVoice {
  const lyricTextByVoice = storedLyricTextByVoice();
  const migrated: SegmentsByVoice = {};
  for (const [voice, events] of Object.entries(byVoice)) {
    migrated[voice] = fromEvents(lyricTextByVoice[voice] ?? "", events);
  }
  return migrated;
}

function loadSegmentsByVoice(): SegmentsByVoice {
  const stored = loadJsonFromStorage<SegmentsByVoice | null>(SEGMENTS_STORAGE_KEY, null);
  if (stored != null) {
    return stored;
  }

  const legacy = loadJsonFromStorage<Timings | TimingsByVoice | null>(
    LEGACY_TIMINGS_STORAGE_KEY,
    null,
  );
  if (legacy == null) {
    return {};
  }
  // The oldest shape is a single voice's flat event array.
  if (Array.isArray(legacy)) {
    return legacy.length > 0 ? migrateEvents({ [DEFAULT_VOICE_ID]: legacy }) : {};
  }
  return migrateEvents(legacy);
}

function isTimed(segments: TimedSegment[] | undefined): boolean {
  return segments?.some((segment) => segment.start !== undefined) ?? false;
}

function copySegmentsByVoice(byVoice: SegmentsByVoice): SegmentsByVoice {
  return Object.fromEntries(
    Object.entries(byVoice).map(([voice, segments]) => [
      voice,
      segments.map((segment) => ({ ...segment })),
    ]),
  );
}

export const useTimingsStore = defineStore("timings", {
  // Timings are stored per voice, never as a single shared stream.
  // Voices are fully independent (see frontend/lib/voices.ts for why):
  // they can overlap in time, so there is no one ordered timeline to share.
  // The single-array API below (rawTimings, add, resetTimings, ...) operates on the *active* voice,
  // which keeps every existing single-voice consumer working unchanged.
  // For a one-voice project the active voice is simply the only voice.
  state: () => {
    const segments = loadSegmentsByVoice();
    return {
      _segmentsByVoice: segments,
      // The last known state before a lyric change.
      // This is the only data `reconcileSegments` works from.
      // Reconciliation is lossy, so feeding it its own output once per keystroke destroys timings
      // that the finished edit would have kept.
      _baselineByVoice: copySegmentsByVoice(segments),
      _activeVoice: loadJsonFromStorage<VoiceId | null>(ACTIVE_VOICE_STORAGE_KEY, null),
    };
  },

  getters: {
    // The voice currently being timed.
    // All the single-array getters/actions below operate on this voice,
    // so existing single-voice consumers are unchanged (the active voice is the only voice).
    // Falls back to the first lyrics voice, then the default.
    activeVoice(state): VoiceId {
      const voices = useLyricsStore().voices;
      if (state._activeVoice && voices.includes(state._activeVoice)) {
        return state._activeVoice;
      }
      return voices[0] ?? DEFAULT_VOICE_ID;
    },

    /**
     * The positional event form the rest of the app still uses.
     * Untimed segments have no event, so this is lossy on purpose and is never read back into storage.
     */
    rawTimings(state): Timings {
      return toEvents(state._segmentsByVoice[this.activeVoice] ?? []);
    },

    activeSegments(state): TimedSegment[] {
      return state._segmentsByVoice[this.activeVoice] ?? [];
    },

    // The full per-voice timing map (used to export/import all voices at once).
    allTimings(state): TimingsByVoice {
      return Object.fromEntries(
        Object.entries(state._segmentsByVoice).map(([voice, segments]) => [
          voice,
          toEvents(segments),
        ]),
      );
    },

    length(): number {
      return this.rawTimings.length;
    },

    last(): [number, number] | null {
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
      if (this.length === 0) {
        return false;
      }

      const lyricSegments = useLyricsStore().segmentsForVoice(this.activeVoice);
      if (!lyricSegments || lyricSegments.length === 0) {
        return false;
      }

      // Every segment has to resolve a start,
      // but a hole between two timed segments resolves by interpolation,
      // so splitting a word you already timed doesn't put the song back to "unfinished" when it renders perfectly well.
      return resolveStarts(this.activeSegments).every((segment) => segment.start !== undefined);
    },

    areTimingsFinished(): boolean {
      // Timings are fully finished when we've marked the end of the last segment
      return (
        this.areTimingsUsable && this.rawTimings[this.length - 1][1] === LYRIC_MARKERS.SEGMENT_END
      );
    },

    subtitles() {
      return (options: VideoSettingsOverride = {}): string => {
        // Return empty string if there are no timings at all
        if (this.length === 0) {
          return "";
        }

        const mediaStore = useMediaStore();
        const settingsStore = useSettingsStore();

        try {
          const baseOptions = settingsStore.renderOptions || DEFAULT_KARAOKE_OPTIONS;
          // Apply the active voice's style override (no-op when it has none).
          const voiceOptions = applyVoiceStyle(
            baseOptions,
            settingsStore.renderVoiceStyle(this.activeVoice),
          );

          // font and color merge field by field, so a caller can override one of them
          // (the Adjust preview's own palette) without restating the rest.
          const adjustedOptions = {
            ...voiceOptions,
            ...options,
            font: { ...voiceOptions.font, ...options.font },
            color: { ...voiceOptions.color, ...options.color },
          };

          return createAssFile(
            this.activeSegments,
            mediaStore.songDuration ?? 0,
            mediaStore.songTitle ?? "",
            mediaStore.songArtist ?? "",
            adjustedOptions,
          );
        } catch (e) {
          console.error("Failed to create subtitles", e);
          return "";
        }
      };
    },

    /**
     * Voices that actually have timings, in document order.
     * A voice can hold segments with nothing tapped yet,
     * so this asks whether anything is timed, not whether the array is populated.
     */
    voicesWithTimings(state): VoiceId[] {
      return useLyricsStore().voices.filter((v) => isTimed(state._segmentsByVoice[v]));
    },

    /**
     * Whether any timing is stored at all.
     * Unlike `voicesWithTimings` this counts voices the lyrics no longer name,
     * which loading a timings file also replaces.
     */
    hasAnyTimings(state): boolean {
      return Object.values(state._segmentsByVoice).some(isTimed);
    },

    timingsForVoice(state) {
      return (voice: VoiceId): Timings => toEvents(state._segmentsByVoice[voice] ?? []);
    },

    timedSegmentsForVoice(state) {
      return (voice: VoiceId): TimedSegment[] => state._segmentsByVoice[voice] ?? [];
    },

    /**
     * What the KBP export reads, until it works from `timingsText`'s model.
     * Unlike `allTimings` this keeps untimed segments.
     */
    timingsFile(state): TimingsFile {
      return { version: TIMINGS_FILE_VERSION, voices: state._segmentsByVoice };
    },

    /**
     * The `timings.txt` the Submit tab and the project download write.
     */
    timingsText(state): string {
      return writeTimingsText(state._segmentsByVoice, useLyricsStore().voices);
    },

    // Composited subtitles for ALL voices (used by the Submit preview and final video), as opposed to `subtitles`,
    // which renders only the active voice (used by Adjust).
    allVoicesSubtitles() {
      return (options: Partial<VideoSettings> = {}): string => {
        const settingsStore = useSettingsStore();
        const mediaStore = useMediaStore();
        const baseOptions = settingsStore.renderOptions || DEFAULT_KARAOKE_OPTIONS;

        const tracks = this.voicesWithTimings.map((voice) => ({
          voice,
          segments: this.timedSegmentsForVoice(voice),
          options: {
            ...applyVoiceStyle(baseOptions, settingsStore.renderVoiceStyle(voice)),
            ...options,
          },
        }));
        if (tracks.length === 0) {
          return "";
        }

        try {
          return createMultiVoiceAssFile(
            tracks,
            mediaStore.songDuration ?? 0,
            mediaStore.songTitle ?? "",
            mediaStore.songArtist ?? "",
          );
        } catch (e) {
          console.error("Failed to create multi-voice subtitles", e);
          return "";
        }
      };
    },
  },

  actions: {
    /**
     * Mark the current segments as the state that lyric edits reconcile from.
     * Every action that writes segments for a reason other than a lyric edit has to end with this,
     * or the edit that follows will be carried across from a stale baseline.
     */
    commitBaseline() {
      this._baselineByVoice = copySegmentsByVoice(this._segmentsByVoice);
    },

    setActiveVoice(voice: VoiceId) {
      this._activeVoice = voice;
    },

    /**
     * Reassigning the map (vs mutating in place) keeps a newly-added voice key reactive.
     */
    ensureActiveSegments(): TimedSegment[] {
      const voice = this.activeVoice;
      if (!this._segmentsByVoice[voice]) {
        const seeded = useLyricsStore()
          .segmentsForVoice(voice)
          .map(({ text }) => ({ text }));
        this._segmentsByVoice = { ...this._segmentsByVoice, [voice]: seeded };
      }
      return this._segmentsByVoice[voice];
    },

    add(currentSegmentNum: number, marker: number, timestamp: number) {
      if (currentSegmentNum < 0) {
        return;
      }

      const segments = this.ensureActiveSegments();
      // Timings can be entered before any lyrics are, so grow to reach the index rather than dropping the input.
      // Reconciliation fills the text in later.
      while (segments.length <= currentSegmentNum) {
        segments.push({ text: "" });
      }

      if (marker == LYRIC_MARKERS.SEGMENT_START) {
        this.handleConflictWithPreviousSegment(timestamp);
        segments[currentSegmentNum].start = timestamp;
        this.commitBaseline();
        return;
      }

      // An end belongs to the segment that is actually sounding,
      // which is the last one started at or before this index, not necessarily the one at the index itself.
      const started = findLastIndex(
        segments,
        (segment) => segment.start !== undefined,
        currentSegmentNum,
      );
      if (started >= 0) {
        segments[started].end = timestamp;
      }
      this.commitBaseline();
    },

    handleConflictWithPreviousSegment(segmentStartTimestamp: number) {
      // A new start at or before the previous segment's end would make the two overlap,
      // so the end is dropped and the previous segment simply runs into this one.
      const segments = this._segmentsByVoice[this.activeVoice];
      if (!segments) {
        return;
      }

      const lastEnd = findLastIndex(segments, (segment) => segment.end !== undefined);
      if (lastEnd < 0) {
        return;
      }
      // Something started after that end, so it isn't what this start collides with.
      if (segments.slice(lastEnd + 1).some((segment) => segment.start !== undefined)) {
        return;
      }
      if (segmentStartTimestamp > (segments[lastEnd].end as number)) {
        return;
      }
      segments[lastEnd].end = undefined;
    },

    timingForSegmentNum(segmentNum: number) {
      return this.activeSegments[segmentNum]?.start ?? 0;
    },

    setCurrentSegment(segmentNum: number) {
      // Drop the timings from segmentNum on, so timing resumes there.
      const segments = this.ensureActiveSegments();
      for (const segment of segments.slice(segmentNum)) {
        segment.start = undefined;
        segment.end = undefined;
      }
      this.commitBaseline();
    },

    resetSegments(segments: TimedSegment[]) {
      this._segmentsByVoice = {
        ...this._segmentsByVoice,
        [this.activeVoice]: segments.map((segment) => ({ ...segment })),
      };
      this.commitBaseline();
    },

    resetTimings(newTimings: Timings = []) {
      const lyricText = useLyricsStore().lyricTextForVoice(this.activeVoice);
      this._segmentsByVoice = {
        ...this._segmentsByVoice,
        [this.activeVoice]: fromEvents(lyricText, newTimings),
      };
      this.commitBaseline();
    },

    /**
     * Replace all voices at once from a versioned timings file, holes included.
     */
    setAllSegments(byVoice: SegmentsByVoice) {
      this._segmentsByVoice = copySegmentsByVoice(byVoice);
      this.commitBaseline();
      this.reconcileVoices();
    },

    /**
     * Replace all voices' timings at once (used when importing a multi-voice timings file).
     */
    setAllTimings(byVoice: TimingsByVoice) {
      const lyricsStore = useLyricsStore();
      this._segmentsByVoice = Object.fromEntries(
        Object.entries(byVoice).map(([voice, events]) => [
          voice,
          fromEvents(lyricsStore.lyricTextForVoice(voice), events),
        ]),
      );
      this.commitBaseline();
      // An imported file may key its timings under a voice name the current lyrics no
      // longer use (typically the default voice of a pre-tag session).
      this.reconcileVoices();
    },

    /**
     * Carry timings across a voice rename.
     *
     * Voices are named by the lyric tags, so tagging previously untagged lyrics, or editing an existing tag,
     * renames a voice, and timings keyed under the old name would look lost.
     * When exactly one timed voice has vanished from the lyrics and exactly one voice in the lyrics has no timings,
     * that is unambiguously a rename, so the timings (and the style override, if the new name has none) move over.
     * This is what makes "switch to multi-voice by adding a tag at the top" keep the timings that were tapped out
     * before any tag existed.
     *
     * Anything more ambiguous (several renames at once, or a voice merged into another that is already
     * timed) is left alone. Orphaned entries are never deleted, so re-typing the old tag brings them back.
     */
    reconcileVoices() {
      const voices = useLyricsStore().voices;
      const timed = (voice: VoiceId) => isTimed(this._segmentsByVoice[voice]);

      const orphans = Object.keys(this._segmentsByVoice).filter(
        (voice) => timed(voice) && !voices.includes(voice),
      );
      const untimed = voices.filter((voice) => !timed(voice));
      if (orphans.length !== 1 || untimed.length !== 1) {
        return;
      }

      const [from] = orphans;
      const [to] = untimed;
      const { [from]: moved, ...rest } = this._segmentsByVoice;
      this._segmentsByVoice = { ...rest, [to]: moved };
      // The rename is the only thing that moves, so the baseline follows the key rather than being recommitted.
      // Recommitting here would fold in the edit that triggered the rename.
      if (this._baselineByVoice[from]) {
        const { [from]: movedBaseline, ...restBaseline } = this._baselineByVoice;
        this._baselineByVoice = { ...restBaseline, [to]: movedBaseline };
      }
      if (this._activeVoice === from) {
        this._activeVoice = to;
      }
      useSettingsStore().renameVoiceStyle(from, to);
    },

    clear() {
      this._segmentsByVoice = {};
      this._baselineByVoice = {};
    },

    /**
     * Follow voice renames as the user edits the lyric tags.
     * Registered once at app start (options stores can't call watch() from a setup scope).
     * Runs immediately so timings restored from a previous, tag-less session are picked up on load too.
     */
    setupVoiceReconciliation() {
      const lyricsStore = useLyricsStore();
      watch(
        () => lyricsStore.voices.join("\n"),
        () => this.reconcileVoices(),
        { immediate: true },
      );
    },

    /**
     * Carry every voice's timings across an edit to the lyrics.
     * The source is always `_baselineByVoice` and never this action's own previous output,
     * so a word typed one letter at a time costs nothing the finished word would not have cost.
     * Runs after reconcileVoices, which handles the coarser case of a voice being renamed by its tag.
     */
    reconcileSegments() {
      const lyricsStore = useLyricsStore();
      const updated: SegmentsByVoice = {};
      for (const [voice, segments] of Object.entries(this._segmentsByVoice)) {
        const lyricSegments = lyricsStore.segmentsForVoice(voice);
        // A voice with no baseline yet falls back to its current segments,
        // which is the older chaining behavior, rather than a crash.
        const baseline = this._baselineByVoice[voice] ?? segments;
        // A voice the lyrics no longer mention is parked, not reconciled against nothing:
        // retyping its tag has to bring the timings back (see reconcileVoices).
        updated[voice] = lyricsStore.voices.includes(voice)
          ? reconcile(baseline, lyricSegments)
          : segments;
      }
      this._segmentsByVoice = updated;
    },

    /**
     * This is registered once at app start, like the watcher above.
     */
    setupSegmentReconciliation() {
      const lyricsStore = useLyricsStore();
      watch(
        () => lyricsStore.lyricText,
        () => this.reconcileSegments(),
      );
    },

    setupPersistence() {
      this.$subscribe((_mutation, state) => {
        try {
          localStorage.setItem(SEGMENTS_STORAGE_KEY, JSON.stringify(state._segmentsByVoice));
          localStorage.setItem(ACTIVE_VOICE_STORAGE_KEY, JSON.stringify(state._activeVoice));
        } catch (e) {
          console.error(`Failed to save ${SEGMENTS_STORAGE_KEY} to localStorage`, e);
        }
      });
    },
  },
});
