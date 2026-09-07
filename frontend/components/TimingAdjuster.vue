<template>
  <div>
    <smooth-audio-player ref="audioPlayer" controls :src="audioSource ?? undefined" @timeupdate="onAudioTimeUpdate"
      @seeking="onAudioSeeking" @pause="onAudioPause" @error="onAudioError" />
    <!-- Display only. It loads its own copy of the audio, so playing it would double up
         with the player above; the playhead is driven by setTime instead. -->
    <wavesurfer ref="wavesurfer" :audioData="vocalTrack || audioData" :regions="regions" :mediaControls="false"
      :minPxPerSec="zoom" @region-updated="onRegionUpdated" @seeking="onWavesurferSeeking" @zoom-change="$emit('zoom-change', $event)" />
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { LyricSegmentIterator } from "@/lib/timing";
import {
  RegionParams,
  Region,
} from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import Wavesurfer from "@/components/Wavesurfer.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";

import { LyricEvent, adjustSegmentTiming } from "@/lib/timing";
import { LYRIC_MARKERS } from "@/constants";

function createLyricRegion(id: number, params: Partial<RegionParams> & { start: number }): RegionParams {
  return {
    id: `segment_${id}`,
    // The region plugin uses "channels" to display regions on different lines
    channelIdx: id % 5,
    resize: true,
    ...params,
  };
}

export default defineComponent({
  emits: ["timingschange", "timeupdate", "seeking", "zoom-change"],
  components: {
    Wavesurfer,
    SmoothAudioPlayer,
  },
  props: {
    lyrics: String,
    timings: Array<LyricEvent>,
    audioData: Blob,
    // URL to the vocal track audio file
    vocalTrack: { type: Blob, required: false },
    // Blob driving audio playback (the waveform stays on vocalTrack/audioData).
    // Lets the user switch what they hear without changing the waveform.
    playbackTrack: { type: Blob, required: false },
    prerollSeconds: { type: Number, default: 5 },
    zoom: { type: Number, default: 50 },
    playbackRate: { type: Number, default: 1 },
  },
  data() {
    return {
      regions: [] as RegionParams[],
      audioSource: null as string | null,
      // Object URLs keyed by source blob. URLs live until unmount so an in-use
      // URL is never revoked (revoking one mid-playback aborts the media fetch
      // and wedges the <audio> element, notably in Firefox). Nothing here is
      // rendered, hence markRaw.
      trackUrls: markRaw(new Map<Blob, string>()),
    };
  },
  computed: {
    splitLyrics(): Array<string> {
      if (this.lyrics == null) {
        return [];
      }
      const lyricIterator = new LyricSegmentIterator(this.lyrics)[
        Symbol.iterator
      ]();

      return [...lyricIterator].map((segment) => segment.text);
    },
  },
  mounted() {
    this.regions = this.createRegions(this.timings ?? [], this.splitLyrics);
    const playbackBlob = this.playbackTrack || this.audioData;
    if (playbackBlob) {
      this.audioSource = this.trackUrl(playbackBlob);
    }
  },
  watch: {
    timings: {
      handler: function (newTimings: Array<LyricEvent>) {
        this.regions = this.createRegions(newTimings, this.splitLyrics);
      },
      deep: true
    },
    lyrics(newLyrics: String) {
      this.regions = this.createRegions(this.timings ?? [], this.splitLyrics);
    },
    playbackRate(value: number) {
      const player = this.audioPlayerRef();
      if (player) player.playbackRate = value;
    },
    playbackTrack(newTrack: Blob) {
      this.swapPlaybackSource(newTrack || this.audioData);
    },
  },
  methods: {
    audioPlayerRef() {
      return this.$refs.audioPlayer as
        | (InstanceType<typeof SmoothAudioPlayer> & { currentTime: number; playbackRate: number })
        | undefined;
    },
    wavesurferRef() {
      return this.$refs.wavesurfer as InstanceType<typeof Wavesurfer> | undefined;
    },
    createRegions(
      timings: Array<LyricEvent>,
      lyrics: Array<string>
    ): Array<RegionParams> {
      if (!timings || !lyrics) {
        return [];
      }
      let regions = [];
      let currentRegion = null;
      let currentLyricIndex = 0;
      for (let i = 0; i < timings.length; i++) {
        const [time, marker] = timings[i];
        if (marker === LYRIC_MARKERS.SEGMENT_START) {
          if (currentRegion) {
            regions.push(currentRegion);
            currentLyricIndex += 1;
          }
          const lyricSegment = lyrics[currentLyricIndex];
          currentRegion = createLyricRegion(regions.length, {
            start: time,
            end: undefined,
            content: lyricSegment,
            color: "rgba(102, 209, 255, 1)",
          });
        } else if (marker === LYRIC_MARKERS.SEGMENT_END && currentRegion) {
          currentRegion.end = time;
        }
      }
      if (currentRegion) {
        regions.push(currentRegion);
      }
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
      const newTimings = this.applyRegionUpdateToTimings(region, this.timings ?? []);
      this.$emit("timingschange", newTimings);
      this.$nextTick(() => {
        this.previewNewTiming(region);
      });
    },
    applyRegionUpdateToTimings(
      region: Region,
      timings: Array<LyricEvent>
    ): Array<LyricEvent> {
      const segmentNum = parseInt(region.id.split("_")[1]);
      return adjustSegmentTiming(segmentNum, timings, {
        start: region.start,
        end: region.isOpenEnded ? undefined : region.end,
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