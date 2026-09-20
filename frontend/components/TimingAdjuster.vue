<template>
  <div>
    <smooth-audio-player
      ref="audioPlayer"
      controls
      :src="audioSource ?? undefined"
      @timeupdate="onAudioTimeUpdate"
      @seeking="onAudioSeeking"
      @pause="onAudioPause"
      @error="onAudioError"
    />
    <!-- Display only. It loads its own copy of the audio, so playing it would double up
         with the player above; the playhead is driven by setTime instead. -->
    <wavesurfer
      ref="wavesurfer"
      :audioData="vocalTrack || audioData"
      :regions="regions"
      :mediaControls="false"
      :minPxPerSec="zoom"
      :initialScroll="initialScroll"
      @region-updated="onRegionUpdated"
      @regions-updated="onRegionsUpdated"
      @seeking="onWavesurferSeeking"
      @zoom-change="$emit('zoom-change', $event)"
      @scroll-change="$emit('scroll-change', $event)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { RegionParams, Region } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import Wavesurfer from "@/components/Wavesurfer.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";

import { displayText, resolveStarts } from "@/lib/timing";
import { TimedSegment } from "@/lib/timedSegments";

function createLyricRegion(
  id: number,
  params: Partial<RegionParams> & { start: number },
): RegionParams {
  return {
    id: `segment_${id}`,
    // The region plugin uses "channels" to display regions on different lines
    channelIdx: id % 5,
    resize: true,
    ...params,
  };
}

export default defineComponent({
  emits: ["segmentschange", "timeupdate", "seeking", "zoom-change", "scroll-change"],
  components: {
    Wavesurfer,
    SmoothAudioPlayer,
  },
  props: {
    segments: Array<TimedSegment>,
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
    zoom: { type: Number, default: 50 },
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
  },
  watch: {
    segments: {
      handler: function (newSegments: Array<TimedSegment>) {
        this.regions = this.createRegions(newSegments);
      },
      deep: true,
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
     */
    createRegions(segments: Array<TimedSegment>): Array<RegionParams> {
      if (!segments) {
        return [];
      }
      const resolved = resolveStarts(segments);
      const regions: RegionParams[] = [];
      resolved.forEach((segment, index) => {
        if (segment.start === undefined) {
          return;
        }
        regions.push(
          createLyricRegion(index, {
            start: segment.start,
            end: segment.end,
            content: displayText(segment.text),
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
    onRegionsUpdated(regions: Array<Region>) {
      if (regions.length === 0) return;
      const updated = (this.segments ?? []).map((segment) => ({ ...segment }));
      for (const region of regions) {
        const index = parseInt(region.id.split("_")[1]);
        const segment = updated[index];
        if (!segment) continue;
        segment.start = region.start;
        segment.end = region.isOpenEnded ? undefined : region.end;
      }
      this.$emit("segmentschange", updated);
      this.$nextTick(() => {
        this.previewNewTiming(regions[0]);
      });
    },
    previewNewTiming(region: Region) {
      const newPlayhead = Math.max(0, region.start - this.prerollSeconds);
      this.setAudioPlayhead(newPlayhead);
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
    onAudioTimeUpdate(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      this.setAdjusterPlayhead(time);
      this.$emit("timeupdate", time);
    },
    onAudioSeeking(event: Event) {
      const time = (event.target as HTMLAudioElement).currentTime;
      this.setAdjusterPlayhead(time);
      this.$emit("seeking", time);
    },
    onWavesurferSeeking(time: number) {
      console.log("Wavesurfer seeking", time);
      this.setAudioPlayhead(time);
    },
    onWavesurferSeeked(time: number) {
      this.setAudioPlayhead(time);
    },
    onAudioPause() {
      this.wavesurferRef()?.pause();
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
    for (const url of this.trackUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.trackUrls.clear();
  },
});
</script>

<style scoped>
audio {
  width: 100%;
  margin-bottom: 1em;
}
</style>
