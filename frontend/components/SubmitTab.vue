<template>
  <b-tab-item label="Submit" icon="blender" class="submit-tab scroll-wrapper" headerClass="submit-tab-header">
    <div class="columns is-variable is-5">
      <div class="column settings-column">
        <h2 class="title">More Settings:</h2>
        <b-field horizontal>
          <template #label>
            Add Count-Ins
            <b-tooltip label="Add count-in dots so you know when to start singing">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-switch expanded v-model="videoOptions.addCountIns"></b-switch></b-field>
        <b-field horizontal>
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template><b-switch expanded
            v-model="videoOptions.addInstrumentalScreens"></b-switch></b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <b-tooltip
              label="Show the first few lines of a screen early if it starts right after the previous screen ends">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template><b-switch expanded v-model="videoOptions.addStaggeredLines"></b-switch></b-field>
        <b-field v-if="videoBlob" horizontal label="Use Background Video">
          <b-switch expanded v-model="videoOptions.useBackgroundVideo"></b-switch></b-field>
        <b-collapse :open="false">
          <template #trigger="props">
            <a aria-controls="contentIdForA11y4" :aria-expanded="props.open">
              Fonts and Colors
              <b-icon :icon="props.open ? 'angle-down' : 'angle-right'"></b-icon>
            </a>
          </template>
          <b-field horizontal label="Font">
            <b-select v-model="videoOptions.font.name">
              <option v-for="(path, name) in fonts" :key="path" :value="name"
                :selected="name == videoOptions.font.name">
                {{ name }}
              </option>
            </b-select>
          </b-field>
          <b-field horizontal label="Font Size"><b-numberinput v-model="videoOptions.font.size"
              controls-position="compact"></b-numberinput></b-field>
          <b-field horizontal label="Background Color"><b-colorpicker
              v-model="videoOptions.color.background" /></b-field>
          <b-field horizontal label="Primary Color"><b-colorpicker v-model="videoOptions.color.primary" /></b-field>
          <b-field horizontal label="Secondary Color"><b-colorpicker v-model="videoOptions.color.secondary" /></b-field>
          <b-field horizontal label="Lyric Vertical Alignment"><b-radio-button v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Top" type="is-primary is-light is-outlined">
              <span>Top</span>
            </b-radio-button>

            <b-radio-button v-model="videoOptions.verticalAlignment" :native-value="VerticalAlignment.Middle"
              type="is-primary is-light is-outlined">
              <span>Middle</span>
            </b-radio-button>

            <b-radio-button v-model="videoOptions.verticalAlignment" :native-value="VerticalAlignment.Bottom"
              type="is-primary is-light is-outlined">
              Bottom
            </b-radio-button>
          </b-field>
          <voice-style-settings v-if="voices.length > 1" :fonts="fonts" />
        </b-collapse>
      </div>
      <div class="column is-narrow">
        <h3 class="title">Video Preview:</h3>
        <b-field v-if="backingTrack" label="Preview audio" horizontal style="margin-bottom: 0.5em;">
          <b-select v-model="previewTrack">
            <option value="full">Full track</option>
            <option value="backing">Backing track</option>
          </b-select>
        </b-field>
        <video-preview v-if="songFile" :song-file="mediaStore.songFile" :backing-track="backingTrack"
          :preview-track="previewTrack" :subtitles="allVoicesSubtitles()" :audio-delay="audioDelay" :fonts="fonts"
          :background-color="videoOptions.color.background.toString()"
          :video-blob="videoOptions.useBackgroundVideo ? videoBlob : null" />
        <b-message v-else type="is-info">Upload a song to see the preview.</b-message>
      </div>
    </div>

    <div class="submit-button-container">
      <b-message v-model="submitError" type="is-danger" has-icon icon="circle-exclamation">
        There was a problem making your video: {{ submitError }}. Try again? Or
        email me?
      </b-message>
      <video-creation-progress-indicator v-if="isSubmitting" :song-duration="songDuration" :phase="creationPhase"
        :progress="videoProgress" :elapsed-time="elapsedSubmissionTime" />
      <b-message v-if="!canCreateVideo" type="is-info">
        {{ missingStepsMessage }}
      </b-message>
      <div class="buttons">
        <b-button expanded size="is-large" type="is-primary" :loading="isSubmitting" @click="createVideo"
          :disabled="!canCreateVideo && !isSubmitting">
          Create Video
        </b-button>
      </div>
      <source-file-download-links :lyrics="lyricText" :timings="timingsExport" :subtitles="allVoicesSubtitles()"
        :settings="settingsYaml" :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing" />
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { sum, map } from "lodash-es";
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { createScreens, VerticalAlignment, KaraokeOptions } from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import VideoCreationProgressIndicator from "@/components/VideoCreationProgressIndicator.vue";
import VoiceStyleSettings from "@/components/VoiceStyleSettings.vue";
import jszip from "jszip";
import yaml from "js-yaml";
import video from "@/lib/video";
import { CreationPhase } from "@/types";
import {
  useMediaStore,
  NO_VOCALS_SEPARATOR_MODEL,
  SeparatedTrack,
} from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";

const fonts = {
  "Andale Mono": "/static/fonts/AndaleMono.ttf",
  Arial: "/static/fonts/Arial.ttf",
  "Arial Narrow": "/static/fonts/ArialNarrow.ttf",
  "Comic Sans MS": "/static/fonts/ComicSans.ttf",
  "Courier New": "/static/fonts/CourierNew.ttf",
  Georgia: "/static/fonts/Georgia.ttf",
  Impact: "/static/fonts/Impact.ttf",
  "Metal Mania": "/static/fonts/MetalMania.ttf",
  "Times New Roman": "/static/fonts/TimesNewRoman.ttf",
  Trebuchet: "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/fonts/LiberationSans.ttf",
};

export default defineComponent({
  components: {
    VideoPreview,
    SourceFileDownloadLinks,
    VideoCreationProgressIndicator,
    VoiceStyleSettings,
  },
  setup() {
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const { lyricText, voices } = storeToRefs(lyricsStore);
    const { allVoicesSubtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      settingsStore,
      timingsStore,
      lyricsStore,
      lyricText,
      voices,
      allVoicesSubtitles,
    };
  },
  props: {
    musicSeparationModel: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      fonts,
      VerticalAlignment,
      isSubmitting: false,
      elapsedSubmissionTime: null,
      creationPhase: CreationPhase.NotStarted,
      videoProgress: 0,
      submitError: null,
      // Which track the preview plays: "full" (with vocals) or "backing".
      previewTrack: "full",
    };
  },
  mounted() {
    // Initialize useBackgroundVideo based on whether the song has a video
    if (this.mediaStore.videoBlob != null) {
      this.videoOptions.useBackgroundVideo = true;
    }
  },

  computed: {
    canCreateVideo() {
      return (
        this.mediaStore.songFile &&
        this.lyricText.length > 0 &&
        this.timingsStore.areTimingsFinished
      );
    },
    missingStepsMessage(): string {
      const steps = [];
      if (!this.mediaStore.songFile) {
        steps.push("upload a song");
      }
      if (this.lyricText.length === 0) {
        steps.push("enter lyrics");
      }
      if (!this.timingsStore.areTimingsFinished) {
        steps.push("finish timing the lyrics");
      }
      const last = steps.pop();
      const stepText = steps.length > 0 ? `${steps.join(", ")} and ${last}` : last;
      return `To create your video, ${stepText}.`;
    },
    videoOptions: {
      get() {
        return this.settingsStore.videoOptions;
      },
      set(newValue) {
        this.settingsStore.videoOptions = newValue;
      }
    },
    songFile() {
      return this.mediaStore.songFile;
    },
    backingTrack() {
      return this.mediaStore.separatedTrack?.backing || null;
    },
    songDuration() {
      return this.mediaStore.songDuration;
    },
    videoBlob() {
      return this.mediaStore.backgroundVideo;
    },
    // subtitles now comes from the timings store
    audioDelay(): number {
      // The shared title/count-in screens (which delay the audio) come from the primary
      // voice — the first voice with timings. Falls back to the active voice's timings.
      const primaryVoice = this.timingsStore.voicesWithTimings[0];
      const lyrics = primaryVoice ? this.lyricsStore.lyricTextForVoice(primaryVoice) : this.lyricText;
      const timings = primaryVoice ? this.timingsStore.timingsForVoice(primaryVoice) : this.timings;
      // createScreens tolerates partial or missing timings, so this works
      // even before the timing step is finished.
      const screens = createScreens(
        lyrics,
        timings,
        this.mediaStore.songDuration,
        this.mediaStore.songTitle,
        this.mediaStore.songArtist,
        this.videoOptions
      );
      return sum(map(screens, "audioDelay"));
    },
    zipFileName(): string {
      return `${this.videoFileName}.zip`;
    },
    videoFileName(): string {
      if (this.mediaStore.songArtist && this.mediaStore.songTitle) {
        return `${this.mediaStore.songArtist} - ${this.mediaStore.songTitle} [karaoke].mp4`;
      }
      return "karaoke.mp4";
    },
    timings() {
      return this.timingsStore.rawTimings;
    },
    // All voices' timings, for the downloadable timings.json.
    timingsExport() {
      return this.timingsStore.allTimings;
    },
    settingsYaml(): string {
      const { vocalSeparationModel, color, ...rest } = this.videoOptions;
      return yaml.dump({
        song: {
          title: this.mediaStore.songTitle,
          artist: this.mediaStore.songArtist,
          duration: this.mediaStore.songDuration,
          youtubeUrl: this.mediaStore.youtubeUrl,
        },
        separationModel: this.musicSeparationModel,
        videoOptions: {
          ...rest,
          color: {
            background: color.background.toString(),
            primary: color.primary.toString(),
            secondary: color.secondary.toString(),
          },
        },
      });
    },
    videoDuration(): number {
      return this.mediaStore.songDuration + this.audioDelay;
    },
    videoFps(): number {
      return this.videoOptions.useBackgroundVideo ? 30 : 20;
    },
    ffmpegLogParser() {
      return video.getProgressParser(this.videoFps, this.videoDuration);
    },
  },
  methods: {
    async separateTrack(
      songFile: File,
      model: string
    ): Promise<SeparatedTrack> {
      const backingTrackPromise = new Promise<SeparatedTrack>(
        (resolve, reject) => {
          if (this.mediaStore.separatedTrack) {
            resolve(this.mediaStore.separatedTrack);
            return;
          }
          this.mediaStore.startSeparation(songFile, model);
          const stopWatchingBacking = this.$watch(
            "mediaStore.separatedTrack",
            (separatedTrack) => {
              console.log("separatedTrackWatcher", separatedTrack);
              if (separatedTrack) {
                stopWatchingBacking();
                stopWatchingError();
                resolve(separatedTrack);
              }
            }
          );
          const stopWatchingError = this.$watch(
            "mediaStore.error",
            (error) => {
              stopWatchingBacking();
              stopWatchingError();
              reject(error);
            }
          );
        }
      );
      return backingTrackPromise;
    },
    async createVideo() {
      let self = this;
      let elapsedTimeInterval: ReturnType<typeof setInterval>;
      this.isSubmitting = true;
      try {
        this.creationPhase = CreationPhase.SeparatingVocals;
        this.videoProgress = 0;
        elapsedTimeInterval = setInterval(() => {
          if (!this.mediaStore.separationStartTime) {
            return;
          }
          this.elapsedSubmissionTime =
            new Date().getTime() -
            this.mediaStore.separationStartTime.getTime();
        }, 1000);
        const separatedTrack = await this.separateTrack(
          this.songFile,
          this.musicSeparationModel
        );
        this.creationPhase = CreationPhase.CreatingVideo;
        const videoOptions = { createTitleScreens: true, ...this.videoOptions };
        const videoFile: Uint8Array = await video.createVideo(
          separatedTrack.backing,
          videoOptions.useBackgroundVideo ? this.videoBlob : null,
          this.allVoicesSubtitles(),
          this.audioDelay,
          videoOptions,
          {
            artist: this.mediaStore.songArtist,
            title: this.mediaStore.songTitle,
            duration: this.mediaStore.songDuration,
          },
          fonts,
          (progress) => {
            self.videoProgress = progress;
          }
        );
        this.zipAndSendFiles(videoFile);
      } catch (e) {
        console.error(e);
        this.submitError = e.message;
      } finally {
        this.isSubmitting = false;
        clearInterval(elapsedTimeInterval);
        this.elapsedSubmissionTime = null;
        this.creationPhase = CreationPhase.NotStarted;
      }
    },

    async sendZipFile(zipFile: Blob) {
      const anchor = document.createElement("a");
      const filename = this.zipFileName;

      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(zipFile);
      anchor.download = filename;
      anchor.click();
    },
    async zipAndSendFiles(videoBlob: Uint8Array) {
      var zip = new jszip();
      zip.file(this.videoFileName, videoBlob);
      zip.file("subtitles.ass", this.allVoicesSubtitles());
      zip.file("lyrics.txt", this.lyricText);
      zip.file("timings.json", JSON.stringify(this.timingsExport));
      zip.file("settings.yaml", this.settingsYaml);

      const separated = this.mediaStore.separatedTrack;
      if (separated?.vocals && separated.vocals.size > 0) {
        zip.file("vocals.wav", separated.vocals);
      }
      if (separated?.backing && separated.backing.size > 0) {
        zip.file("accompaniment.wav", separated.backing);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      this.sendZipFile(zipBlob);
    },
  },
});
</script>
<style>
/* .fit-content {
  width: max-content;
} */
.field.is-horizontal .field-label {
  flex-grow: 3;
}
</style>
<style scoped>
.submit-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.settings-column {
  margin: 0 10%;
}

.submit-tab column {
  text-align: center;
}
</style>