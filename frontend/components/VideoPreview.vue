<template>
  <div class="preview-container">
    <div class="preview-stage">
      <subtitle-display
        ref="subtitleDisplay"
        @click="togglePlayback"
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
        @play="onAudioPlaying"
        @pause="onAudioPause"
        @seeking="onAudioSeeking"
        @seeked="onAudioSeeked"
        @waiting="onAudioWaiting"
      />
    </div>
  </div>
</template>

<script lang="ts">
/* A component that displays WebVTT subtitles over a black screen, with an audio file provided as a prop */
// TODO: Incorporate audio delay

import { defineComponent, markRaw } from "vue";
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
      // Nothing in here is rendered, so none of it needs to be reactive.
      view: markRaw({
        // Object URLs of already-prepared (silence-prepended) tracks,
        // keyed by source blob and by how much silence was prepended.
        // The audio delay can change while the preview is mounted,
        // for example when count-ins are toggled or timings are edited.
        // Caching makes repeat track switches instant, since preparing a full song takes seconds.
        // URLs also live until unmount, so one in use is never revoked:
        // revoking mid-playback aborts the media fetch and wedges the <audio> element,
        // notably in Firefox.
        preparedTrackUrls: new Map<Blob, Map<number, string>>(),
        // The preview stays mounted when its tab is hidden, but its inputs keep changing:
        // every timing tap updates the audio delay.
        // Preparing audio is expensive, so while hidden we only remember the latest update
        // and apply it when the preview becomes visible again.
        isDisplayed: true,
        pendingAudioUpdate: null as { audio: Blob; silence: number } | null,
        visibilityObserver: null as IntersectionObserver | null,
      }),
    };
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
    this.view.visibilityObserver = new IntersectionObserver((entries) => {
      this.view.isDisplayed = entries[entries.length - 1].isIntersecting;
      if (this.view.isDisplayed && this.view.pendingAudioUpdate) {
        const { audio, silence } = this.view.pendingAudioUpdate;
        this.view.pendingAudioUpdate = null;
        this.updateAudio(audio, silence);
      }
    });
    this.view.visibilityObserver.observe(this.$el);
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
    playerRef() {
      return this.$refs.player as
        | (InstanceType<typeof SmoothAudioPlayer> & { currentTime: number; playbackRate: number })
        | undefined;
    },
    subtitleDisplayRef() {
      return this.$refs.subtitleDisplay as InstanceType<typeof SubtitleDisplay> | undefined;
    },
    togglePlayback() {
      const audio = this.playerRef()?.audioPlayer as HTMLAudioElement | undefined;
      if (!audio) {
        return;
      }
      audio.focus();
      if (audio.paused) {
        audio.play().catch((error) => {
          console.error("Could not start playback:", error);
        });
      } else {
        audio.pause();
      }
    },
    scheduleAudioUpdate(audioData: Blob, silence: number) {
      if (!this.view.isDisplayed) {
        this.view.pendingAudioUpdate = { audio: audioData, silence };
        return;
      }
      this.updateAudio(audioData, silence);
    },
    setPlayhead(playhead: number) {
      const player = this.playerRef();
      if (player && playhead != player.currentTime) {
        player.currentTime = playhead;
      }
      this.subtitleDisplayRef()?.setPlayhead(playhead);
    },
    async updateAudio(audioData: Blob, silence: number) {
      let urlsBySilence = this.view.preparedTrackUrls.get(audioData);
      if (!urlsBySilence) {
        urlsBySilence = new Map<number, string>();
        this.view.preparedTrackUrls.set(audioData, urlsBySilence);
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
      const audio = this.playerRef()?.audioPlayer as HTMLAudioElement | undefined;
      const resumeTime = audio ? audio.currentTime : 0;
      const wasPlaying = audio ? !audio.paused : false;

      this.audioDataUrl = url;

      if (!audio || (resumeTime === 0 && !wasPlaying)) {
        return;
      }
      const onLoaded = () => {
        audio.currentTime = resumeTime;
        this.subtitleDisplayRef()?.setPlayhead(resumeTime);
        if (wasPlaying) {
          audio.play().catch((error) => {
            console.error("Could not resume playback:", error);
          });
        }
      };
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    },
    async prependSilence(audioData: Blob, secondsOfSilence: number): Promise<Blob> {
      if (secondsOfSilence == 0) {
        return audioData;
      }

      // TODO: can we do some of these steps in parallel?
      const audioContext = new AudioContext();
      const arrayBuffer = await audioData.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const offlineAudioContext = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        sampleRate: audioBuffer.sampleRate,
      });

      const source = offlineAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineAudioContext.destination);
      source.start();

      const songBuffer = await offlineAudioContext.startRendering();

      const songWithSilenceBuffer = audioContext.createBuffer(
        songBuffer.numberOfChannels,
        songBuffer.length + secondsOfSilence * audioBuffer.sampleRate,
        songBuffer.sampleRate,
      );

      for (let channel = 0; channel < songBuffer.numberOfChannels; channel++) {
        const resultData = songBuffer.getChannelData(channel);
        const silenceData = songWithSilenceBuffer.getChannelData(channel);
        silenceData.set(resultData, secondsOfSilence * audioBuffer.sampleRate);
      }

      const wavAudio: ArrayBuffer = bufferToWav(songWithSilenceBuffer);
      return new Blob([new DataView(wavAudio)], {
        type: "audio/wav",
      });
    },

    onAudioTimeUpdate(e: Event) {
      const currentTime = (e.target as HTMLAudioElement).currentTime;
      this.setPlayhead(currentTime);
      this.$emit("timeupdate", currentTime);
    },
    // These listeners call some internal libass-wasm functions
    // that dramatically improve rendering performance
    onAudioPlaying() {
      this.subtitleDisplayRef()?.play();
      this.$emit("playing");
    },

    onAudioPause() {
      this.subtitleDisplayRef()?.pause();
      this.$emit("pause");
    },
    onAudioSeeking() {
      this.playerRef()?.removeEventListener("timeupdate", this.onAudioTimeUpdate, false);
      this.$emit("seeking");
    },

    onAudioSeeked(e: Event) {
      this.playerRef()?.addEventListener("timeupdate", this.onAudioTimeUpdate, false);

      var currentTime = (e.target as HTMLAudioElement).currentTime;
      this.subtitleDisplayRef()?.setPlayhead(currentTime);

      this.$emit("seeked", currentTime);
    },
    onAudioWaiting() {
      this.subtitleDisplayRef()?.pause();
      this.$emit("waiting");
    },
  },
  beforeUnmount() {
    this.view.visibilityObserver?.disconnect();
    for (const urlsBySilence of this.view.preparedTrackUrls.values()) {
      for (const url of urlsBySilence.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.view.preparedTrackUrls.clear();
  },
});
</script>
<style scoped>
.preview-container {
  display: flex;
  flex-direction: column;
  text-align: center;
  width: 100%;
}

/* The pair is centred as one, so no spare height opens up between the frame and the controls. */
.preview-stage {
  container-type: inline-size;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
}

/* The frame prefers the height 16:9 wants at the stage's full width,
and shrinks from there to leave the player its own.
Its width follows from the height, so the ratio is measured against cqw. */
.preview-stage :deep(.video-container) {
  align-self: center;
  flex: 0 1 auto;
  height: calc(100cqw * 9 / 16);
  min-height: 0;
  width: auto;
}

.preview-container :deep(audio) {
  flex-shrink: 0;
  width: 100%;
}

.preview-container :deep(.video-container) {
  cursor: pointer;
}
</style>
