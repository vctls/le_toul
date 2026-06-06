<template>
  <div class="preview-container">
    <b-message type="is-info">
      {{
        previewTrack === "backing"
          ? "Previewing the backing track. This matches the finished video's audio."
          : "Audio in this preview includes vocals, but the finished video won't."
      }}
    </b-message>
    <subtitle-display
      ref="subtitleDisplay"
      :subtitles="subtitles"
      :audioDelay="audioDelay"
      :fonts="fonts"
      :backgroundColor="backgroundColor"
      :videoBlob="videoBlob"
    />
    <smooth-audio-player
      ref="player"
      :src="audioDataUrl"
      controls
      @timeupdate="onAudioTimeUpdate"
      @playing="onAudioPlaying"
      @pause="onAudioPause"
      @seeking="onAudioSeeking"
      @seeked="onAudioSeeked"
      @waiting="onAudioWaiting"
    />
  </div>
</template>

<script lang="ts">
/* A component that displays WebVTT subtitles over a black screen, with an audio file provided as a prop */
// TODO: Incorporate audio delay

import { defineComponent } from "vue";
import bufferToWav from "audiobuffer-to-wav";
import SubtitleDisplay from "./SubtitleDisplay.vue";
import SmoothAudioPlayer from "./SmoothAudioPlayer.vue";

export default defineComponent({
  components: { SubtitleDisplay, SmoothAudioPlayer },
  props: {
    songFile: {
      type: Blob,
      required: true,
    },
    // Backing (accompaniment) track, available once the song has been separated.
    // Lets the preview play the same audio the finished video will use.
    backingTrack: {
      type: Blob,
      required: false,
    },
    // Which track the preview should play: "full" (songFile) or "backing".
    previewTrack: {
      type: String,
      default: "full",
    },
    subtitles: {
      type: String,
      required: true,
    },
    audioDelay: {
      type: Number,
      default: 0.0,
    },
    fonts: {
      type: Object,
    },
    backgroundColor: {
      type: String,
      default: "#000000",
    },
    videoBlob: {
      type: Blob,
      required: false,
    },
  },
  data() {
    return {
      audioDataUrl: "",
    };
  },
  created() {
    // Object URLs of already-prepared (silence-prepended) tracks, keyed by
    // source blob and the amount of prepended silence (the audio delay can
    // change while the preview is mounted, e.g. when count-ins are toggled
    // or timings are edited). Caching makes repeat track switches instant
    // (preparing a full song takes seconds) and means URLs live until
    // unmount, so an in-use URL is never revoked (revoking one mid-playback
    // aborts the media fetch and wedges the <audio> element, notably in
    // Firefox). Deliberately not reactive.
    this.preparedTrackUrls = new Map<Blob, Map<number, string>>();
    // The preview stays mounted when its tab is hidden, but its inputs keep
    // changing (every timing tap updates the audio delay). Preparing audio
    // is expensive, so while hidden we only remember the latest requested
    // update and apply it when the preview becomes visible again.
    // Deliberately not reactive.
    this.isDisplayed = true;
    this.pendingAudioUpdate = null;
  },
  computed: {
    activeAudio(): Blob {
      if (this.previewTrack === "backing" && this.backingTrack) {
        return this.backingTrack;
      }
      return this.songFile;
    },
  },
  mounted() {
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.isDisplayed = entries[entries.length - 1].isIntersecting;
      if (this.isDisplayed && this.pendingAudioUpdate) {
        const { audio, silence } = this.pendingAudioUpdate;
        this.pendingAudioUpdate = null;
        this.updateAudio(audio, silence);
      }
    });
    this.visibilityObserver.observe(this.$el);
    this.updateAudio(this.activeAudio, this.audioDelay);
  },
  watch: {
    activeAudio(newAudio: Blob) {
      this.scheduleAudioUpdate(newAudio, this.audioDelay);
    },
    audioDelay(newDelay: number) {
      this.scheduleAudioUpdate(this.activeAudio, newDelay);
    },
  },
  methods: {
    scheduleAudioUpdate(audioData: Blob, silence: number) {
      if (!this.isDisplayed) {
        this.pendingAudioUpdate = { audio: audioData, silence };
        return;
      }
      this.updateAudio(audioData, silence);
    },
    setPlayhead(playhead: number) {
      if (playhead != this.$refs.player.currentTime) {
        this.$refs.player.currentTime = playhead;
      }
      this.$refs.subtitleDisplay.setPlayhead(playhead);
    },
    async updateAudio(audioData: Blob, silence: number) {
      let urlsBySilence = this.preparedTrackUrls.get(audioData);
      if (!urlsBySilence) {
        urlsBySilence = new Map<number, string>();
        this.preparedTrackUrls.set(audioData, urlsBySilence);
      }
      let url = urlsBySilence.get(silence);
      if (!url) {
        const audioWithSilence = await this.prependSilence(audioData, silence);
        url = URL.createObjectURL(audioWithSilence);
        urlsBySilence.set(silence, url);
      }
      if (url === this.audioDataUrl) {
        return;
      }

      // Capture the playhead/play state right before swapping the source,
      // since reloading the <audio> element resets playback to 0 and pauses.
      const audio = this.$refs.player?.audioPlayer as
        | HTMLAudioElement
        | undefined;
      const resumeTime = audio ? audio.currentTime : 0;
      const wasPlaying = audio ? !audio.paused : false;

      this.audioDataUrl = url;

      if (!audio || (resumeTime === 0 && !wasPlaying)) {
        return;
      }
      const onLoaded = () => {
        audio.currentTime = resumeTime;
        this.$refs.subtitleDisplay?.setPlayhead(resumeTime);
        if (wasPlaying) {
          audio.play().catch((error) => {
            console.error("Could not resume playback:", error);
          });
        }
      };
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    },
    async prependSilence(
      audioData: Blob,
      secondsOfSilence: number
    ): Promise<Blob> {
      // Prepend N seconds of silence to the start of the songfile
      if (secondsOfSilence == 0) {
        return audioData;
      }

      // TODO: can we do some of these steps in parallel?
      const audioContext = new AudioContext();
      const arrayBuffer = await audioData.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create an OfflineAudioContext with the desired duration
      const offlineAudioContext = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        sampleRate: audioBuffer.sampleRate,
      });

      // Create a source node from the original audio buffer
      const source = offlineAudioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect the source node to the destination node (output)
      source.connect(offlineAudioContext.destination);

      // Start rendering the audio
      source.start();

      // Wait for the audio to finish rendering
      const songBuffer = await offlineAudioContext.startRendering();

      // Create a new AudioBuffer with the desired length
      const songWithSilenceBuffer = audioContext.createBuffer(
        songBuffer.numberOfChannels,
        songBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        songBuffer.sampleRate
      );

      // Get the channel data from the result buffer
      for (let channel = 0; channel < songBuffer.numberOfChannels; channel++) {
        const resultData = songBuffer.getChannelData(channel);
        const silenceData = songWithSilenceBuffer.getChannelData(channel);

        // Copy the result data to the end of the silence buffer
        silenceData.set(resultData, secondsOfSilence * audioBuffer.sampleRate);
      }

      // Convert the result buffer to a wav
      const wavAudio: ArrayBuffer = bufferToWav(songWithSilenceBuffer);
      const result = new Blob([new DataView(wavAudio)], {
        type: "audio/wav",
      });

      return result;
    },

    onAudioTimeUpdate(e: Event) {
      const currentTime = (e.target as HTMLAudioElement).currentTime;
      this.setPlayhead(currentTime);
      this.$emit("timeupdate", currentTime);
    },
    // These listeners call some internal libass-wasm functions that dramatically
    // improve rendering performance
    onAudioPlaying() {
      this.$refs.subtitleDisplay.play();
      this.$emit("playing");
    },

    onAudioPause() {
      this.$refs.subtitleDisplay.pause();
      this.$emit("pause");
    },
    onAudioSeeking(e: Event) {
      this.$refs.player.removeEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );
      this.$emit("seeking");
    },

    onAudioSeeked(e: Event) {
      this.$refs.player.addEventListener(
        "timeupdate",
        this.onAudioTimeUpdate,
        false
      );

      var currentTime = (e.target as HTMLAudioElement).currentTime;
      this.$refs.subtitleDisplay.setPlayhead(currentTime);

      this.$emit("seeked", currentTime);
    },
    onAudioWaiting() {
      this.$refs.subtitleDisplay.pause();
      this.$emit("waiting");
    },
  },
  beforeUnmount() {
    this.visibilityObserver?.disconnect();
    for (const urlsBySilence of this.preparedTrackUrls.values()) {
      for (const url of urlsBySilence.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.preparedTrackUrls.clear();
  },
});
</script>
<style scoped>
.preview-container {
  text-align: center;
  width: 320px;
}
</style>