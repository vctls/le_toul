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
          <b-switch v-model="videoOptions.addCountIns"></b-switch></b-field>
        <template v-if="videoOptions.addCountIns">
          <b-field horizontal>
            <template #label>
              Count-In Text
              <b-tooltip label="What a count-in shows before the singing starts">
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-input :model-value="videoOptions.countInText"
              @update:model-value="(v: string | number | undefined) => (videoOptions.countInText = String(v ?? ''))"></b-input>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Gap
              <b-tooltip label="Add a count-in when the singing starts more than this many seconds after the previous screen ends">
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-numberinput :model-value="videoOptions.countInThreshold" :min="0.5" :step="0.5"
              @update:model-value="(v: number | null | undefined) => (videoOptions.countInThreshold = Number(v ?? videoOptions.countInThreshold))"
              controls-position="compact"></b-numberinput>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Length
              <b-tooltip label="How many seconds a count-in lasts. Can't be longer than the gap above.">
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-numberinput :model-value="videoOptions.countInDuration" :min="0.5" :max="videoOptions.countInThreshold"
              :step="0.5"
              @update:model-value="(v: number | null | undefined) => (videoOptions.countInDuration = Number(v ?? videoOptions.countInDuration))"
              controls-position="compact"></b-numberinput>
          </b-field>
        </template>
        <b-field horizontal>
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template><b-switch
            v-model="videoOptions.addInstrumentalScreens"></b-switch></b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <b-tooltip
              label="Show the first few lines of a screen early if it starts right after the previous screen ends">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template><b-switch v-model="videoOptions.addStaggeredLines"></b-switch></b-field>
        <b-field v-if="videoBlob" horizontal label="Use Background Video">
          <b-switch v-model="videoOptions.useBackgroundVideo"></b-switch></b-field>
        <b-collapse v-model="isShowingFontsAndColors">
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
          <b-field horizontal>
            <template #label>
              Custom Font
              <b-tooltip label="Upload your own .ttf or .otf font file. It overrides the font picked above.">
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <file-upload name="custom-font-upload" :accept="['.ttf', '.otf', '.ttc']"
              :model-value="(settingsStore.customFont as File | undefined) ?? undefined" @update:modelValue="onCustomFontChange" />
          </b-field>
          <b-field horizontal v-if="settingsStore.customFontFamily">
            <p class="help custom-font-help">
              Rendering lyrics in &ldquo;{{ settingsStore.customFontFamily }}&rdquo;, overriding the font above.
            </p>
          </b-field>
          <b-field horizontal label="Font Size"><b-numberinput :model-value="videoOptions.font.size" @update:model-value="(v: number | null | undefined) => (videoOptions.font.size = Number(v ?? videoOptions.font.size))"
              controls-position="compact"></b-numberinput></b-field>
          <b-field horizontal label="Background Color"><color-field v-model="videoOptions.color.background"
              label="background color" /></b-field>
          <b-field horizontal label="Primary Color"><color-field v-model="videoOptions.color.primary"
              label="primary color" /></b-field>
          <b-field horizontal label="Secondary Color"><color-field v-model="videoOptions.color.secondary"
              label="secondary color" /></b-field>
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
        <video-preview v-if="songFile" :song-file="songFile" :backing-track="backingTrack ?? undefined"
          :preview-track="previewTrack" :subtitles="allVoicesSubtitles()" :audio-delay="audioDelay" :fonts="fontMap"
          :background-color="videoOptions.color.background.toString()"
          :video-blob="videoOptions.useBackgroundVideo ? (videoBlob ?? undefined) : undefined" />
        <b-message v-else type="is-info" :closable="false">Upload a song to see the preview.</b-message>
      </div>
    </div>

    <div class="submit-button-container">
      <b-message :model-value="submitError !== null" @update:model-value="submitError = null"
        type="is-danger" has-icon icon="circle-exclamation">
        There was a problem making your video: {{ submitError }}. Try again? Or
        email me?
      </b-message>
      <video-creation-progress-indicator v-if="isSubmitting" :song-duration="songDuration ?? undefined" :phase="creationPhase"
        :progress="videoProgress" :elapsed-time="elapsedSubmissionTime ?? undefined" />
      <b-message v-if="!canCreateVideo" type="is-info" :closable="false">
        {{ missingStepsMessage }}
      </b-message>
      <div class="buttons">
        <b-button expanded size="is-large" type="is-primary" :loading="isSubmitting" @click="createVideo"
          :disabled="!canCreateVideo && !isSubmitting">
          Create Video
        </b-button>
      </div>
      <source-file-download-links :lyrics="lyricText" :timings="timingsExport" :subtitles="allVoicesSubtitles()"
        :settings="settingsYaml" :font="customFont ?? undefined" :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing" />
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import {map, sum} from "lodash-es";
import {defineComponent} from "vue";
import {storeToRefs} from "pinia";
import {createScreens, VerticalAlignment} from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import VideoCreationProgressIndicator from "@/components/VideoCreationProgressIndicator.vue";
import VoiceStyleSettings from "@/components/VoiceStyleSettings.vue";
import ColorField from "@/components/ColorField.vue";
import FileUpload from "@/components/FileUpload.vue";
import jszip from "jszip";
import yaml from "js-yaml";
import video from "@/lib/video";
import {CreationPhase, SeparationModel} from "@/types";
import {SeparatedTrack, useMediaStore,} from "@/stores/media";
import {useSettingsStore, VideoSettings} from "@/stores/settings";
import {isEmptyOverride, serializeVoiceStyle} from "@/lib/voiceStyle";
import {useTimingsStore} from "@/stores/timings";
import {useLyricsStore} from "@/stores/lyrics";

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
  "Trebuchet MS": "/static/fonts/Trebuchet.ttf",
  Verdana: "/static/fonts/Verdana.ttf",
  "Liberation Sans": "/static/fonts/LiberationSans.ttf",
};

export default defineComponent({
  components: {
    VideoPreview,
    SourceFileDownloadLinks,
    VideoCreationProgressIndicator,
    VoiceStyleSettings,
    ColorField,
    FileUpload,
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
  data() {
    return {
      fonts,
      VerticalAlignment,
      isSubmitting: false,
      elapsedSubmissionTime: null as number | null,
      creationPhase: CreationPhase.NotStarted,
      videoProgress: 0,
      submitError: null as string | null,
      // Which track the preview plays: "full" (with vocals) or "backing".
      previewTrack: "full",
      isShowingFontsAndColors: false,
    };
  },
  mounted() {
    // Initialize useBackgroundVideo based on whether the song has a video
    if (this.videoBlob != null) {
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
      set(newValue: VideoSettings) {
        this.settingsStore.videoOptions = newValue;
      }
    },
    renderOptions() {
      return this.settingsStore.renderOptions;
    },
    // Keyed by the family name an ASS style row references, not by file name.
    fontMap(): Record<string, string> {
      const { customFontFamily, customFontUrl } = this.settingsStore;
      if (!customFontFamily || !customFontUrl) {
        return fonts;
      }
      return { ...fonts, [customFontFamily]: customFontUrl };
    },
    songFile(): File | null {
      return this.mediaStore.songFile as File | null;
    },
    customFont(): File | null {
      return (this.settingsStore.customFont as File | null) ?? null;
    },
    backingTrack(): Blob | null {
      return (this.mediaStore.separatedTrack?.backing as Blob | undefined) || null;
    },
    songDuration() {
      return this.mediaStore.songDuration;
    },
    videoBlob(): Blob | null {
      return this.mediaStore.backgroundVideo as Blob | null;
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
        this.mediaStore.songDuration ?? 0,
        this.mediaStore.songTitle ?? "",
        this.mediaStore.songArtist ?? "",
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
      // Exports the picked font, not the uploaded one: a settings file naming a font it
      // can't carry would no longer load back.
      const { vocalSeparationModel, color, ...rest } = this.videoOptions;
      const styledVoices = Object.entries(this.settingsStore.voiceStyles).filter(
        ([, style]) => !isEmptyOverride(style)
      );
      const document: Record<string, unknown> = {
        song: {
          title: this.mediaStore.songTitle,
          artist: this.mediaStore.songArtist,
          duration: this.mediaStore.songDuration,
          youtubeUrl: this.mediaStore.youtubeUrl,
        },
        // The model the user actually picked, so the file can be loaded back.
        separationModel: this.mediaStore.separationModel,
        videoOptions: {
          ...rest,
          color: {
            background: color.background.toString(),
            primary: color.primary.toString(),
            secondary: color.secondary.toString(),
          },
        },
      };
      if (styledVoices.length > 0) {
        document.voiceStyles = Object.fromEntries(
          styledVoices.map(([voice, style]) => [voice, serializeVoiceStyle(style)])
        );
      }
      return yaml.dump(document);
    },
    videoDuration(): number {
      return (this.mediaStore.songDuration ?? 0) + this.audioDelay;
    },
    videoFps(): number {
      return this.videoOptions.useBackgroundVideo ? 30 : 20;
    },
    ffmpegLogParser() {
      return video.getProgressParser(this.videoFps, this.videoDuration);
    },
  },
  methods: {
    async onCustomFontChange(file: File | null) {
      try {
        await this.settingsStore.setCustomFont(file);
        if (file) {
          this.$buefy.toast.open({
            message: `Using "${this.settingsStore.customFontFamily}" for the lyrics.`,
            type: "is-success",
            duration: 2000,
          });
        }
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: (e as Error).message,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    async separateTrack(
      songFile: File,
      model: string
    ): Promise<SeparatedTrack> {
      return new Promise<SeparatedTrack>(
          (resolve, reject) => {
            if (this.mediaStore.separatedTrack) {
              resolve(this.mediaStore.separatedTrack);
              return;
            }
            this.mediaStore.startSeparation(songFile, model as SeparationModel);
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
    },
    async createVideo() {
      const songFile = this.songFile;
      if (!songFile) {
        return;
      }
      let self = this;
      let elapsedTimeInterval: ReturnType<typeof setInterval> | undefined;
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
          songFile,
          this.mediaStore.separationModel
        );
        this.creationPhase = CreationPhase.CreatingVideo;
        const videoOptions = { createTitleScreens: true, ...this.renderOptions };
        const videoFile: Uint8Array = await video.createVideo(
          separatedTrack.backing,
          videoOptions.useBackgroundVideo ? this.videoBlob : null,
          this.allVoicesSubtitles(),
          this.audioDelay,
          videoOptions,
          {
            artist: this.mediaStore.songArtist ?? undefined,
            title: this.mediaStore.songTitle ?? undefined,
            duration: this.mediaStore.songDuration ?? undefined,
          },
          this.fontMap,
          (progress) => {
            self.videoProgress = progress;
          }
        );
        await this.zipAndSendFiles(videoFile);
      } catch (e) {
        console.error(e);
        this.submitError = e instanceof Error ? e.message : String(e);
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
      const zip = new jszip();
      zip.file(this.videoFileName, videoBlob);
      zip.file("subtitles.ass", this.allVoicesSubtitles());
      zip.file("lyrics.txt", this.lyricText);
      zip.file("timings.json", JSON.stringify(this.timingsExport));
      zip.file("settings.yaml", this.settingsYaml);
      if (this.customFont) {
        zip.file(this.customFont.name, this.customFont);
      }

      const separated = this.mediaStore.separatedTrack;
      if (separated?.vocals && separated.vocals.size > 0) {
        zip.file("vocals.wav", separated.vocals);
      }
      if (separated?.backing && separated.backing.size > 0) {
        zip.file("accompaniment.wav", separated.backing);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      await this.sendZipFile(zipBlob);
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

.submit-tab .column {
  text-align: center;
}
</style>