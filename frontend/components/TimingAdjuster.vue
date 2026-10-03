<template>
  <div class="timing-adjuster">
    <smooth-audio-player
      ref="audioPlayer"
      controls
      :src="audioSource ?? undefined"
      @timeupdate="onAudioTimeUpdate"
      @seeking="onAudioSeeking"
      @play="$emit('play')"
      @pause="onAudioPause"
      @error="onAudioError"
    />
    <div class="waveform-stage">
      <!-- Display only. It loads its own copy of the audio, so playing it would double up
         with the player above; the playhead is driven by setTime instead. -->
      <wavesurfer
        ref="wavesurfer"
        :audioData="vocalTrack || audioData"
        :regions="displayMode ? [] : regions"
        :bands="bands"
        :bandsEnabled="bandsEnabled"
        :selectable="!tapMode"
        :centered="tapMode"
        :mediaControls="false"
        :zoom="zoom"
        :initialScroll="initialScroll"
        @region-updated="onRegionUpdated"
        @regions-updated="onRegionsUpdated"
        @bands-updated="$emit('bands-updated', $event)"
        @band-reset="(...args: unknown[]) => $emit('band-reset', ...args)"
        @seeking="onWavesurferSeeking"
        @region-clicked="onRegionClicked"
        @selection-change="onSelectionChange"
        @scrub="seekBy"
        @zoom-change="$emit('zoom-change', $event)"
        @zoom-by="$emit('zoom-by', $event)"
        @scroll-change="$emit('scroll-change', $event)"
      />
      <tap-queue v-if="tapMode" :items="queue" @pick="$emit('segment-picked', $event)" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, PropType } from "vue";
import { RegionParams, Region } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import Wavesurfer from "@/components/Wavesurfer.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";
import TapQueue, { QueueItem } from "./TapQueue.vue";

import { findLastIndex } from "lodash-es";
import { displayText, resolveStarts } from "@/lib/timing";
import { TimedSegment } from "@/lib/timedSegments";
import { DisplayBand } from "@/lib/displayBands";

// The Tap queue runs across the middle of the waveform.
// An even number of channels leaves the middle between two of them.
const TAP_CHANNELS = 4;
const ADJUST_CHANNELS = 5;

// A jump of the audio clock larger than this is a seek, which the smoothed time follows at once.
const SEEK_JUMP = 0.25;

// How long the shown time takes to settle on the audio's. The audio reports its time every few
// frames, each report up to a frame late, and following every one made the waveform judder.
const CLOCK_SETTLE_SECONDS = 0.3;

// A seek this far before a range's start still counts as inside it, since the audio may land a
// little off the time it was sent to.
const RANGE_SEEK_SLACK = 0.05;

// An open-ended last segment is drawn up to the song's end,
// so the lost segments after it stack this long after its start instead.
const UNPLACED_AFTER_OPEN_END = 1;
// The lost segments before the first timed one stack this far before its start,
// so that they come first in the plugin's order.
const UNPLACED_BEFORE_FIRST = 0.001;

/**
 * Where to draw the lost segments that interpolation can't place,
 * since no timed segment lies on one side of them:
 * just before the first timed segment's start, or just after the last one's end.
 */
function unplacedStarts(segments: TimedSegment[], resolved: TimedSegment[]): Map<number, number> {
  const starts = new Map<number, number>();
  const first = resolved.findIndex((segment) => segment.start !== undefined);
  if (first === -1) return starts;
  const last = findLastIndex(resolved, (segment) => segment.start !== undefined);
  const { start: lastStart, end: lastEnd } = segments[last];
  const before = Math.max(0, (resolved[first].start as number) - UNPLACED_BEFORE_FIRST);
  const after = lastEnd ?? (lastStart as number) + UNPLACED_AFTER_OPEN_END;
  segments.forEach((segment, index) => {
    if (segment.review !== "lost") return;
    if (index < first) starts.set(index, before);
    if (index > last) starts.set(index, after);
  });
  return starts;
}

function createLyricRegion(
  id: number,
  params: Partial<RegionParams> & { start: number },
): RegionParams {
  return {
    id: `segment_${id}`,
    // The region plugin uses "channels" to display regions on different lines
    channelIdx: id % ADJUST_CHANNELS,
    channelCount: ADJUST_CHANNELS,
    ...params,
  };
}

export default defineComponent({
  emits: [
    "segmentschange",
    "bands-updated",
    "band-reset",
    "timeupdate",
    "seeking",
    "play",
    "pause",
    "segment-picked",
    "selection-change",
    "zoom-change",
    "zoom-by",
    "scroll-change",
  ],
  components: {
    Wavesurfer,
    SmoothAudioPlayer,
    TapQueue,
  },
  props: {
    segments: Array<TimedSegment>,
    // Display mode draws each line's display period in place of the timing regions.
    displayMode: { type: Boolean, default: false },
    // Tap mode draws the regions without handles, and a click on one doesn't select it.
    tapMode: { type: Boolean, default: false },
    // In Tap mode, the segment being tapped, whose region grows up to the playhead.
    growing: { type: Number, required: false },
    // In Tap mode, the next segment to tap, whose region is marked when it has one.
    head: { type: Number, required: false },
    // In Tap mode, the segments tapped in the pass under way. The others after the head are ghosts,
    // drawn faded, since the next taps replace them.
    tapped: { type: Array as PropType<number[]>, default: () => [] },
    // In Tap mode, the segments still to tap, drawn in a row from the playhead.
    queue: { type: Array as PropType<QueueItem[]>, default: () => [] },
    bands: { type: Array as PropType<DisplayBand[]>, default: () => [] },
    bandsEnabled: { type: Boolean, default: true },
    audioData: Blob,
    // URL to the vocal track audio file
    vocalTrack: { type: Blob, required: false },
    // Blob driving audio playback (the waveform stays on vocalTrack/audioData).
    // Lets the user switch what they hear without changing the waveform.
    playbackTrack: { type: Blob, required: false },
    prerollSeconds: { type: Number, default: 5 },
    // This is where playback resumes on load. It is read once, when the media is ready for it.
    initialPlayhead: { type: Number, default: 0 },
    // This is where the waveform was scrolled to, in seconds.
    initialScroll: { type: Number, default: 0 },
    zoom: { type: Number, default: 100 },
    playbackRate: { type: Number, default: 1 },
    preservePitch: { type: Boolean, default: false },
  },
  data() {
    return {
      regions: [] as RegionParams[],
      audioSource: null as string | null,
      // Object URLs keyed by source blob. URLs live until unmount so an in-use URL is never revoked (revoking
      // one mid-playback aborts the media fetch and wedges the <audio> element, notably in Firefox).
      // Nothing here is rendered, hence markRaw.
      trackUrls: markRaw(new Map<Blob, string>()),
      _playheadRestored: false,
      clockFrame: 0,
      // The audio clock only moves in steps, so the view runs its own clock between them and pulls
      // it gently toward each one.
      // Nothing here is rendered, hence markRaw.
      clock: markRaw({ base: -1, at: 0, shown: -1, lastFrame: 0 }),
      // The span being played by playRange, which pauses at its end and goes back to the preroll
      // before its start.
      playingRange: null as { start: number; end: number } | null,
    };
  },
  mounted() {
    this.regions = this.createRegions(this.segments ?? []);
    const playbackBlob = this.playbackTrack || this.audioData;
    if (playbackBlob) {
      this.audioSource = this.trackUrl(playbackBlob);
    }
    this.applyPlaybackSettings();
    this.restorePlayhead();
    if (this.tapMode) this.startClock();
  },
  watch: {
    segments: {
      handler: function (newSegments: Array<TimedSegment>) {
        this.regions = this.createRegions(newSegments);
      },
      deep: true,
    },
    head() {
      if (this.tapMode) this.regions = this.createRegions(this.segments ?? []);
    },
    tapped() {
      if (this.tapMode) this.regions = this.createRegions(this.segments ?? []);
    },
    tapMode(tapMode: boolean) {
      this.playingRange = null;
      this.regions = this.createRegions(this.segments ?? []);
      if (tapMode) {
        this.startClock();
      } else {
        this.stopClock();
      }
    },
    playbackRate() {
      this.applyPlaybackSettings();
    },
    preservePitch() {
      this.applyPlaybackSettings();
    },
    playbackTrack(newTrack: Blob) {
      this.swapPlaybackSource(newTrack || this.audioData);
    },
  },
  methods: {
    audioPlayerRef() {
      return this.$refs.audioPlayer as
        | (InstanceType<typeof SmoothAudioPlayer> & {
            currentTime: number;
            playbackRate: number;
            preservesPitch: boolean;
          })
        | undefined;
    },
    /**
     * Assigning currentTime before the media has metadata is silently dropped, so this waits for it.
     * This runs only once. Later track swaps have their own resume logic.
     */
    restorePlayhead() {
      if (this._playheadRestored || !this.initialPlayhead) return;
      this._playheadRestored = true;
      const time = this.initialPlayhead;
      this.$nextTick(() => {
        const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
        if (!audio) return;
        // Seeking emits `seeking`, which updates the waveform and the caller.
        const seek = () => {
          audio.currentTime = time;
        };
        // readyState 1 is HAVE_METADATA, the point at which a seek sticks.
        if (audio.readyState >= 1) {
          seek();
        } else {
          audio.addEventListener("loadedmetadata", seek, { once: true });
        }
      });
    },
    applyPlaybackSettings() {
      const player = this.audioPlayerRef();
      if (!player) return;
      player.preservesPitch = this.preservePitch;
      player.playbackRate = this.playbackRate;
    },
    wavesurferRef() {
      return this.$refs.wavesurfer as InstanceType<typeof Wavesurfer> | undefined;
    },
    /**
     * There is one region per segment, indexed the same way, so a region id names its segment directly.
     * An untimed segment gets a shaded region at its interpolated position. Dragging it sets a real start.
     * A lost segment that has no interpolated position is drawn at the nearest timed edge.
     */
    createRegions(segments: Array<TimedSegment>): Array<RegionParams> {
      if (!segments) {
        return [];
      }
      const resolved = resolveStarts(segments);
      const unplaced = unplacedStarts(segments, resolved);
      const regions: RegionParams[] = [];
      resolved.forEach((segment, index) => {
        const start = segment.start ?? unplaced.get(index);
        if (start === undefined) {
          return;
        }
        regions.push(
          createLyricRegion(index, {
            start,
            // A lost segment placed at the nearest timed edge may start after its own end.
            end: segment.end !== undefined && segment.end > start ? segment.end : undefined,
            review: segments[index].review,
            content: displayText(segment.text),
            resize: !this.tapMode,
            highlighted: this.tapMode && index === this.head,
            faded:
              this.tapMode &&
              this.head !== undefined &&
              index > this.head &&
              !this.tapped.includes(index),
            ...(this.tapMode && {
              channelIdx: index % TAP_CHANNELS,
              channelCount: TAP_CHANNELS,
            }),
            color:
              segments[index].start === undefined
                ? "var(--region-fill-hole)"
                : "var(--region-fill)",
          }),
        );
      });
      return regions;
    },
    trackUrl(blob: Blob): string {
      let url = this.trackUrls.get(blob);
      if (!url) {
        url = URL.createObjectURL(blob);
        this.trackUrls.set(blob, url);
      }
      return url;
    },
    swapPlaybackSource(newBlob: Blob) {
      if (!newBlob) return;
      const url = this.trackUrl(newBlob);
      if (url === this.audioSource) return;
      const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
      // Changing the <audio> src resets currentTime to 0 and pauses playback,
      // so capture the playhead/play state and restore them once the new
      // source has loaded enough metadata to be seekable.
      const resumeTime = audio ? audio.currentTime : 0;
      const wasPlaying = audio ? !audio.paused : false;
      this.audioSource = url;
      if (!audio) return;
      const restore = () => {
        audio.currentTime = resumeTime;
        if (wasPlaying) {
          audio.play().catch((error) => {
            console.error("Could not resume playback:", error);
          });
        }
      };
      audio.addEventListener("loadedmetadata", restore, { once: true });
    },
    onRegionUpdated(region: Region) {
      this.onRegionsUpdated([region]);
    },
    /**
     * A handle or a selection was released, so the regions play through with their new timing.
     * They come in time order.
     */
    onRegionsUpdated(regions: Array<Region>) {
      if (regions.length === 0) return;
      const start = regions[0].start;
      const end = regions[regions.length - 1].end;
      const updated = (this.segments ?? []).map((segment) => ({ ...segment }));
      for (const region of regions) {
        const index = parseInt(region.id.split("_")[1]);
        const segment = updated[index];
        if (!segment) continue;
        segment.start = region.start;
        segment.end = region.isOpenEnded ? undefined : region.end;
      }
      this.$emit("segmentschange", updated);
      this.$nextTick(() => this.playRange(start, end));
    },
    onTimeUpdate(time: number) {
      this.$emit("timeupdate", time);
    },
    onSeeking(time: number) {
      this.$emit("seeking", time);
    },
    setAdjusterPlayhead(playhead: number) {
      this.wavesurferRef()?.setTime(playhead);
    },
    setAudioPlayhead(playhead: number) {
      const player = this.audioPlayerRef();
      if (player) player.currentTime = playhead;
    },
    // Jump to whichever end of the track `edge` names.
    seekToTrackEdge(edge: "start" | "end") {
      if (edge === "start") return this.setAudioPlayhead(0);
      const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
      if (!audio || !Number.isFinite(audio.duration)) return;
      this.setAudioPlayhead(audio.duration);
    },
    // Jump to whichever end of the scrolled-into-view waveform `edge` names.
    seekToViewEdge(edge: "start" | "end") {
      const range = this.wavesurferRef()?.visibleTimeRange();
      if (!range) return;
      this.setAudioPlayhead(edge === "start" ? range.start : range.end);
    },
    clearSelection() {
      this.wavesurferRef()?.clearSelection();
    },
    anchorZoomOnPlayhead() {
      this.wavesurferRef()?.anchorZoomOnPlayhead();
    },
    /**
     * Select a segment's region alone and scroll it into view, as a click on it would select it.
     */
    selectSegment(index: number) {
      const id = `segment_${index}`;
      const region = this.regions.find((params) => params.id === id);
      if (region) this.wavesurferRef()?.selectRegion(id, region.start);
    },
    onSelectionChange(ids: string[]) {
      this.$emit(
        "selection-change",
        ids.map((id) => parseInt(id.split("_")[1])),
      );
    },
    audioElement(): HTMLAudioElement | undefined {
      return this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
    },
    currentTime(): number {
      return this.audioElement()?.currentTime ?? 0;
    },
    isPaused(): boolean {
      return this.audioElement()?.paused ?? true;
    },
    pause() {
      this.audioElement()?.pause();
    },
    togglePlayPause() {
      const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
      if (!audio) return;
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    },
    // Move the playhead by `seconds`, staying inside the track.
    seekBy(seconds: number) {
      const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
      if (!audio) return;
      let time = audio.currentTime + seconds;
      if (Number.isFinite(audio.duration)) {
        time = Math.min(audio.duration, time);
      }
      this.setAudioPlayhead(Math.max(0, time));
    },
    // Jump to `time` and play from there, whether or not playback is running.
    restartAt(time: number) {
      const audio = this.audioPlayerRef()?.audioPlayer as HTMLAudioElement | undefined;
      if (!audio) return;
      this.setAudioPlayhead(time);
      if (audio.paused) {
        audio.play().catch((error) => {
          console.error("Could not start playback:", error);
        });
      }
    },
    /**
     * Play from `start`, whether or not playback is running. At `end`, pause and move the playhead
     * to the preroll before `start`.
     */
    playRange(start: number, end: number) {
      // The seek to `start` would already be past `end` and drop the range,
      // so playback would never stop.
      if (end <= start) return;
      this.playingRange = { start, end };
      this.restartAt(start);
    },
    onAudioTimeUpdate(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      const range = this.playingRange;
      if (range && time >= range.end) {
        this.playingRange = null;
        this.pause();
        this.setAudioPlayhead(Math.max(0, range.start - this.prerollSeconds));
        // The seek updates the waveform itself. Sending it this time too would leave it stuck
        // here, since wavesurfer drops a time set while its audio is still seeking.
        return;
      }
      // In Tap mode the clock moves the playhead on every frame, from a smoothed time.
      if (!this.tapMode) this.setAdjusterPlayhead(time);
      this.$emit("timeupdate", time);
    },
    startClock() {
      if (this.clockFrame) return;
      this.clock.shown = -1;
      const tick = (now: number) => {
        this.clockFrame = requestAnimationFrame(tick);
        this.onClockFrame(now);
      };
      this.clockFrame = requestAnimationFrame(tick);
    },
    stopClock() {
      cancelAnimationFrame(this.clockFrame);
      this.clockFrame = 0;
    },
    /**
     * Keep the playhead in the middle of the view, and grow the region being tapped up to it.
     */
    onClockFrame(now: number) {
      const audio = this.audioElement();
      const wavesurfer = this.wavesurferRef();
      if (!audio || !wavesurfer) return;
      const { clock } = this;
      const reported = audio.currentTime;
      const elapsed = clock.lastFrame ? (now - clock.lastFrame) / 1000 : 0;
      let time = reported;
      if (!audio.paused) {
        if (reported !== clock.base) {
          clock.base = reported;
          // The report changed at some point since the last frame, so halfway is the best guess.
          clock.at = clock.lastFrame ? (now + clock.lastFrame) / 2 : now;
        }
        const estimate = reported + ((now - clock.at) / 1000) * audio.playbackRate;
        const predicted = clock.shown + elapsed * audio.playbackRate;
        if (clock.shown < 0 || Math.abs(estimate - predicted) > SEEK_JUMP) {
          time = estimate;
        } else {
          const pull = 1 - Math.exp(-elapsed / CLOCK_SETTLE_SECONDS);
          // Only a seek may take the view back.
          time = Math.max(clock.shown, predicted + (estimate - predicted) * pull);
        }
      }
      clock.lastFrame = now;
      if (time === clock.shown) return;
      clock.shown = time;
      wavesurfer.setTime(time);
      wavesurfer.centerOn(time);
      if (this.growing !== undefined && !audio.paused) {
        wavesurfer.growRegion(`segment_${this.growing}`, time);
      }
    },
    onAudioSeeking(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      // The clock never steps back by less than a seek's worth, so it is told of every seek.
      this.clock.shown = -1;
      const range = this.playingRange;
      if (range && (time < range.start - RANGE_SEEK_SLACK || time >= range.end)) {
        this.playingRange = null;
      }
      this.setAdjusterPlayhead(time);
      this.$emit("seeking", time);
    },
    onRegionClicked(region: Region, event: MouseEvent) {
      // A click on a region picks it in Tap mode and toggles its selection otherwise.
      // Either way, it must not also seek to where it landed.
      event.stopPropagation();
      if (this.tapMode) {
        this.$emit("segment-picked", parseInt(region.id.split("_")[1]));
      } else {
        this.playRange(region.start, region.end);
      }
    },
    onWavesurferSeeking(time: number) {
      console.log("Wavesurfer seeking", time);
      this.setAudioPlayhead(time);
    },
    onWavesurferSeeked(time: number) {
      this.setAudioPlayhead(time);
    },
    onAudioPause() {
      this.playingRange = null;
      this.wavesurferRef()?.pause();
      this.$emit("pause");
    },
    onAudioError(event: Event) {
      const audio = event.target as HTMLAudioElement;
      console.error("Audio loading error:", {
        error: audio.error,
        currentSrc: audio.currentSrc,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
    },
  },
  beforeUnmount() {
    this.stopClock();
    for (const url of this.trackUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.trackUrls.clear();
  },
});
</script>

<style scoped>
.timing-adjuster {
  display: flex;
  flex-direction: column;
}

/* The waveform takes whatever height the stage is given, so it can't size the stage itself. */
.waveform-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 300px;
}

.waveform-stage > .wavesurfer-container {
  position: absolute;
  inset: 0;
}

audio {
  width: 100%;
  margin-bottom: 1em;
}
</style>
