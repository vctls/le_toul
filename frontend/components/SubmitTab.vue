<template>
  <b-tab-item
    value="submit"
    label="Submit"
    icon="blender"
    class="submit-tab scroll-wrapper"
    headerClass="submit-tab-header"
  >
    <div class="columns is-variable is-5">
      <div class="column settings-column">
        <h2 class="title">More Settings</h2>
        <b-field horizontal>
          <template #label>
            Add Count-Ins
            <b-tooltip label="Add count-in dots so you know when to start singing">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-switch v-model="videoOptions.addCountIns"></b-switch
        ></b-field>
        <template v-if="videoOptions.addCountIns">
          <b-field horizontal>
            <template #label>
              Count-In Text
              <b-tooltip label="What a count-in shows before the singing starts">
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-input
              :model-value="videoOptions.countInText"
              @update:model-value="
                (v: string | number | undefined) => (videoOptions.countInText = String(v ?? ''))
              "
            ></b-input>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Gap
              <b-tooltip
                multilined
                label="Add a count-in when the singing starts more than this many seconds after the previous screen ends"
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.countInThreshold"
              :min="0.5"
              :step="0.5"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.countInThreshold = Number(v ?? videoOptions.countInThreshold))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Length
              <b-tooltip
                label="How many seconds a count-in lasts. Can't be longer than the gap above."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.countInDuration"
              :min="0.5"
              :max="videoOptions.countInThreshold"
              :step="0.5"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.countInDuration = Number(v ?? videoOptions.countInDuration))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
        </template>
        <b-field horizontal>
          <template #label>
            Add Instrumental Breaks
            <b-tooltip label="Add screens that count down long instrumentals">
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.addInstrumentalScreens"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <b-tooltip
              label="Show the first few lines of a screen early if it starts right after the previous screen ends"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.addStaggeredLines"></b-switch
        ></b-field>
        <b-field v-if="videoBlob" horizontal label="Use Background Video">
          <b-switch v-model="videoOptions.useBackgroundVideo"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Video Format
            <b-tooltip
              multilined
              label="MKV also carries the vocals and the original mix as extra audio tracks, for players that can switch between them"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-select
            expanded
            :model-value="videoOptions.outputFormat"
            @update:model-value="(v: string) => (videoOptions.outputFormat = v as OutputFormat)"
          >
            <option v-for="(label, format) in outputFormatLabels" :key="format" :value="format">
              {{ label }}
            </option>
          </b-select>
        </b-field>
        <b-collapse v-model="isShowingFontsAndColors">
          <template #trigger="props">
            <a aria-controls="contentIdForA11y4" :aria-expanded="props.open">
              Fonts and Colors
              <b-icon :icon="props.open ? 'angle-down' : 'angle-right'"></b-icon>
            </a>
          </template>
          <b-field horizontal label="Font">
            <b-select expanded v-model="videoOptions.font.name">
              <option
                v-for="(path, name) in fonts"
                :key="path"
                :value="name"
                :selected="name == videoOptions.font.name"
              >
                {{ name }}
              </option>
            </b-select>
          </b-field>
          <b-field horizontal>
            <template #label>
              Custom Font
              <b-tooltip
                label="Upload your own .ttf or .otf font file. It overrides the font picked above."
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <file-upload
              expanded
              name="custom-font-upload"
              :accept="['.ttf', '.otf', '.ttc']"
              :model-value="(settingsStore.customFont as File | undefined) ?? undefined"
              @update:modelValue="onCustomFontChange"
            />
          </b-field>
          <b-field horizontal v-if="settingsStore.customFontFamily">
            <p class="help custom-font-help">
              Rendering lyrics in &ldquo;{{ settingsStore.customFontFamily }}&rdquo;, overriding the
              font above.
            </p>
          </b-field>
          <b-field horizontal label="Font Size"
            ><b-numberinput
              expanded
              :model-value="videoOptions.font.size"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.font.size = Number(v ?? videoOptions.font.size))
              "
              controls-position="compact"
            ></b-numberinput
          ></b-field>
          <b-field horizontal label="Background Color"
            ><color-field v-model="videoOptions.color.background" label="background color"
          /></b-field>
          <b-field horizontal label="Primary Color"
            ><color-field v-model="videoOptions.color.primary" label="primary color"
          /></b-field>
          <b-field horizontal label="Secondary Color"
            ><color-field v-model="videoOptions.color.secondary" label="secondary color"
          /></b-field>
          <b-field horizontal label="Lyric Vertical Alignment"
            ><b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Top"
              type="is-primary is-light is-outlined"
            >
              <span>Top</span>
            </b-radio-button>

            <b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Middle"
              type="is-primary is-light is-outlined"
            >
              <span>Middle</span>
            </b-radio-button>

            <b-radio-button
              v-model="videoOptions.verticalAlignment"
              :native-value="VerticalAlignment.Bottom"
              type="is-primary is-light is-outlined"
            >
              Bottom
            </b-radio-button>
          </b-field>
          <voice-style-settings v-if="voices.length > 1" :fonts="fonts" />
        </b-collapse>
      </div>
      <div class="column">
        <h3 class="title">Video Preview</h3>
        <b-field v-if="backingTrack" label="Preview audio" horizontal style="margin-bottom: 0.5em">
          <b-select v-model="previewTrack">
            <option value="full">Full track</option>
            <option value="backing">Backing track</option>
          </b-select>
        </b-field>
        <video-preview
          v-if="songFile"
          :song-file="songFile"
          :backing-track="backingTrack ?? undefined"
          :preview-track="previewTrack"
          :subtitles="allVoicesSubtitles()"
          :audio-delay="audioDelay"
          :fonts="fontMap"
          :background-color="videoOptions.color.background.toString()"
          :output-format="videoOptions.outputFormat"
          :video-blob="videoOptions.useBackgroundVideo ? (videoBlob ?? undefined) : undefined"
        />
        <b-message v-else type="is-info" :closable="false"
          >Upload a song to see the preview.</b-message
        >
      </div>
    </div>

    <div class="submit-button-container">
      <b-message
        :model-value="submitError !== null"
        @update:model-value="submitError = null"
        type="is-danger"
        has-icon
        icon="circle-exclamation"
      >
        There was a problem generating the video: {{ submitError }}
      </b-message>
      <video-creation-progress-indicator
        v-if="isSubmitting"
        :song-duration="songDuration ?? undefined"
        :phase="creationPhase"
        :progress="videoProgress"
        :step="creationStep"
        :elapsed-time="elapsedSubmissionTime ?? undefined"
        :separation-progress="mediaStore.separationProgress"
        :separation-stage="mediaStore.separationStage"
        :waiting-for-separation="waitingForSeparation"
      />
      <b-message v-if="!canCreateVideo" type="is-info" :closable="false">
        {{ missingStepsMessage }}
      </b-message>
      <div class="buttons">
        <b-button
          :expanded="!isSubmitting"
          size="is-large"
          type="is-primary"
          :loading="isSubmitting"
          @click="createVideo"
          :disabled="!canCreateVideo && !isSubmitting"
        >
          Create Video
        </b-button>
        <b-button
          v-if="isSubmitting"
          size="is-large"
          type="is-danger is-light"
          @click="cancelCreation"
        >
          Cancel
        </b-button>
      </div>
      <source-file-download-links
        :lyrics="lyricText"
        :timings="timingsExport"
        :subtitles="allVoicesSubtitles()"
        :settings="settingsYaml"
        :font="customFont ?? undefined"
        :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing"
      />
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { map, sum } from "lodash-es";
import { defineComponent, markRaw } from "vue";
import { storeToRefs } from "pinia";
import { createScreens, OutputFormat, VerticalAlignment } from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import VideoCreationProgressIndicator from "@/components/VideoCreationProgressIndicator.vue";
import VoiceStyleSettings from "@/components/VoiceStyleSettings.vue";
import ColorField from "@/components/ColorField.vue";
import FileUpload from "@/components/FileUpload.vue";
import jszip from "jszip";
import yaml from "js-yaml";
import video from "@/lib/video";
import { CreationPhase } from "@/types";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore, VideoSettings } from "@/stores/settings";
import { isEmptyOverride, serializeVoiceStyle } from "@/lib/voiceStyle";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { abortable } from "@/lib/util";
import { projectSongEntryName } from "@/lib/projectFolder";

// The rest of the bar is the zip, which carries the source song and both separated tracks.
const RENDER_SHARE = 0.95;

const outputFormatLabels: Record<OutputFormat, string> = {
  mp4: "MP4",
  mkv: "MKV, with vocal and original tracks",
};

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
      outputFormatLabels,
      VerticalAlignment,
      isSubmitting: false,
      elapsedSubmissionTime: null as number | null,
      creationPhase: CreationPhase.NotStarted,
      waitingForSeparation: false,
      videoProgress: 0,
      creationStep: "",
      submitError: null as string | null,
      // Which track the preview plays: "full" (with vocals) or "backing".
      previewTrack: "full",
      isShowingFontsAndColors: true,
      // Vue would proxy the controller, whose methods need the instance itself.
      creation: markRaw({ abort: null as AbortController | null }),
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
      },
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
      const lyrics = primaryVoice
        ? this.lyricsStore.lyricTextForVoice(primaryVoice)
        : this.lyricText;
      const timings = primaryVoice ? this.timingsStore.timingsForVoice(primaryVoice) : this.timings;
      // createScreens tolerates partial or missing timings, so this works
      // even before the timing step is finished.
      const screens = createScreens(
        lyrics,
        timings,
        this.mediaStore.songDuration ?? 0,
        this.mediaStore.songTitle ?? "",
        this.mediaStore.songArtist ?? "",
        this.videoOptions,
      );
      return sum(map(screens, "audioDelay"));
    },
    zipFileName(): string {
      return `${this.videoFileName}.zip`;
    },
    videoFileName(): string {
      const extension = this.videoOptions.outputFormat;
      if (this.mediaStore.songArtist && this.mediaStore.songTitle) {
        return `${this.mediaStore.songArtist} - ${this.mediaStore.songTitle} [karaoke].${extension}`;
      }
      return `karaoke.${extension}`;
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
        ([, style]) => !isEmptyOverride(style),
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
          styledVoices.map(([voice, style]) => [voice, serializeVoiceStyle(style)]),
        );
      }
      return yaml.dump(document);
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
    // Stops whatever the submission is doing.
    // A separation that was already running when the video was requested keeps going:
    // the user called off the video, not the work the Song File tab started.
    cancelCreation() {
      this.creation.abort?.abort();
      if (!this.waitingForSeparation) {
        this.mediaStore.cancelSeparation();
      }
    },
    async createVideo() {
      const songFile = this.songFile;
      if (!songFile) {
        return;
      }
      const abort = new AbortController();
      this.creation.abort = abort;
      let elapsedTimeInterval: ReturnType<typeof setInterval> | undefined;
      this.isSubmitting = true;
      try {
        this.creationPhase = CreationPhase.SeparatingVocals;
        // A separation started from the Song File tab keeps running and this one only waits on it,
        // which otherwise looks like a stalled render.
        this.waitingForSeparation = this.mediaStore.isProcessing && !this.mediaStore.separatedTrack;
        this.videoProgress = 0;
        this.creationStep = "";
        elapsedTimeInterval = setInterval(() => {
          if (!this.mediaStore.separationStartTime) {
            return;
          }
          this.elapsedSubmissionTime =
            new Date().getTime() - this.mediaStore.separationStartTime.getTime();
        }, 1000);
        const separatedTrack =
          this.mediaStore.separatedTrack ??
          (await abortable(
            this.mediaStore.startSeparation(songFile, this.mediaStore.separationModel),
            abort.signal,
          ));
        if (!separatedTrack) {
          throw new Error(this.mediaStore.error ?? "Track separation failed");
        }
        this.creationPhase = CreationPhase.CreatingVideo;
        this.waitingForSeparation = false;
        const videoOptions = { createTitleScreens: true, ...this.renderOptions };
        const videoFile: Uint8Array = await video.createVideo({
          accompaniment: separatedTrack.backing,
          backgroundVideo: videoOptions.useBackgroundVideo ? this.videoBlob : null,
          subtitles: this.allVoicesSubtitles(),
          audioDelay: this.audioDelay,
          videoOptions,
          metadata: {
            artist: this.mediaStore.songArtist ?? undefined,
            title: this.mediaStore.songTitle ?? undefined,
            duration: this.mediaStore.songDuration ?? undefined,
          },
          fontMap: this.fontMap,
          alternateTracks: { vocals: separatedTrack.vocals, original: songFile },
          signal: abort.signal,
          onProgress: (progress, step) => {
            this.videoProgress = progress * RENDER_SHARE;
            this.creationStep = step;
          },
        });
        await this.zipAndSendFiles(videoFile, abort.signal);
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error(e);
          this.submitError = e instanceof Error ? e.message : String(e);
        }
      } finally {
        if (this.creation.abort === abort) {
          this.creation.abort = null;
        }
        this.isSubmitting = false;
        clearInterval(elapsedTimeInterval);
        this.elapsedSubmissionTime = null;
        this.creationPhase = CreationPhase.NotStarted;
        this.waitingForSeparation = false;
        this.creationStep = "";
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
    async zipAndSendFiles(videoBlob: Uint8Array, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const zip = new jszip();
      zip.file(this.videoFileName, videoBlob);
      zip.file("subtitles.ass", this.allVoicesSubtitles());
      zip.file("lyrics.txt", this.lyricText);
      zip.file("timings.json", JSON.stringify(this.timingsExport));
      zip.file("settings.yaml", this.settingsYaml);
      if (this.customFont) {
        zip.file(this.customFont.name, this.customFont);
      }

      // Named after its role rather than kept as uploaded,
      // so a folder extracted from this zip can tell the source song from the karaoke video beside it.
      if (this.songFile) {
        zip.file(projectSongEntryName(this.songFile.name), this.songFile);
      }

      const separated = this.mediaStore.separatedTrack;
      if (separated?.vocals && separated.vocals.size > 0) {
        zip.file("vocals.wav", separated.vocals);
      }
      if (separated?.backing && separated.backing.size > 0) {
        zip.file("accompaniment.wav", separated.backing);
      }

      this.creationStep = "packaging the files";
      const zipBlob = await zip.generateAsync({ type: "blob" }, ({ percent }) => {
        this.videoProgress = RENDER_SHARE + (percent / 100) * (1 - RENDER_SHARE);
      });
      // jszip has no way to stop, so a cancel lands here as a download not offered.
      signal?.throwIfAborted();
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

.submit-tab .column {
  text-align: center;
}

.settings-column :deep(.b-tooltip.is-multiline .tooltip-content) {
  width: 24rem;
}

/* Bulma's label padding assumes a one-line input; these rows hold taller controls. */
.submit-tab :deep(.field.is-horizontal) {
  align-items: center;
}

.submit-tab :deep(.field.is-horizontal > .field-label) {
  padding-top: 0;
}
</style>
