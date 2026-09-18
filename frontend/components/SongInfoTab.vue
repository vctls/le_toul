<template>
  <b-tab-item
    value="song"
    :class="['song-info-tab', 'scroll-wrapper']"
    headerClass="song-info-tab-header"
  >
    <template #header>
      <b-icon v-if="!isSeparatingTrack" icon="file-audio"></b-icon>
      <b-tooltip v-else :label="separationHeaderLabel" position="is-bottom">
        <span v-if="separationProgress !== null" class="icon">
          <circular-progress :value="separationProgress" label="Track separation progress" />
        </span>
        <span v-else class="icon is-small loader"></span>
      </b-tooltip>
      <span> Song File</span>
    </template>
    <h2 class="title">Get Your Song Ready</h2>
    <file-upload
      name="song-file-upload"
      label="Upload a file from your computer:"
      tooltip="The full song, as audio or video. Its vocals are separated out to make the backing track."
      v-model="mediaStore.songFile"
    ></file-upload>
    <b-field label="Or paste a YouTube video URL:" :type="youtubeError ? 'is-danger' : ''">
      <template #message>
        <span v-html="youtubeError"></span>
      </template>
      <b-input
        type="text"
        :model-value="mediaStore.youtubeUrl ?? ''"
        @update:model-value="
          (v: string | number | undefined) => {
            mediaStore.youtubeUrl = v == null ? null : String(v);
          }
        "
      />
      <b-button
        label="Load"
        :type="mediaStore.youtubeUrl ? 'is-primary' : 'is-light'"
        :disabled="!mediaStore.youtubeUrl"
        @click="loadYouTubeUrl"
        :loading="isLoadingYouTube"
      />
    </b-field>
    <b-field label="Song Artist">
      <b-input
        class="metadata-input"
        name="artist"
        :model-value="mediaStore.songArtist ?? ''"
        @update:model-value="
          (v: string | number | undefined) => {
            mediaStore.songArtist = v == null ? null : String(v);
          }
        "
      />
    </b-field>
    <b-field label="Song Title">
      <b-input
        class="metadata-input"
        name="title"
        :model-value="mediaStore.songTitle ?? ''"
        @update:model-value="
          (v: string | number | undefined) => {
            mediaStore.songTitle = v == null ? null : String(v);
          }
        "
      />
    </b-field>
    <b-field label="Separation Model" class="separation-model-field">
      <div class="separation-model-radios">
        <div class="model-group-label">Keep backing vocals</div>
        <b-radio
          v-model="mediaStore.separationModel"
          :native-value="BACKING_VOCALS_SEPARATOR_MODEL"
        >
          MDX-Net <span class="hint">(fast)</span>
        </b-radio>
        <b-radio
          v-model="mediaStore.separationModel"
          :native-value="BACKING_VOCALS_HQ_SEPARATOR_MODEL"
        >
          Mel-Band Roformer (aufr33/viperx)
          <span class="hint">(high quality · minutes per song on CPU)</span>
        </b-radio>
        <b-radio
          v-model="mediaStore.separationModel"
          :native-value="BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL"
        >
          Mel-Band Roformer (becruily)
          <span class="hint">(high quality, newer · minutes per song on CPU)</span>
        </b-radio>
        <div class="model-group-label">Remove backing vocals</div>
        <b-radio v-model="mediaStore.separationModel" :native-value="NO_VOCALS_SEPARATOR_MODEL">
          MDX-Net Inst HQ <span class="hint">(fast)</span>
        </b-radio>
        <b-radio v-model="mediaStore.separationModel" :native-value="NO_VOCALS_HQ_SEPARATOR_MODEL">
          BS-Roformer
          <span class="hint">(highest SDR · slowest on CPU)</span>
        </b-radio>
      </div>
    </b-field>

    <b-collapse v-model="isShowingAdvanced">
      <template #trigger="props">
        <b-button type="is-text" aria-controls="contentIdForA11y4" :aria-expanded="props.open">
          <span>Advanced</span>
          <b-icon :icon="props.open ? 'angle-down' : 'angle-right'"></b-icon>
        </b-button>
      </template>
      <div class="box">
        <div class="columns is-multiline is-variable is-4">
          <div class="column is-full">
            <folder-upload
              name="project-folder-upload"
              expanded
              label="Project Folder"
              tooltip="A folder of files downloaded from the Submit tab and extracted. Loads whichever of the song, lyrics, timings, settings, tracks and font it holds."
              @select="onProjectFolderSelect"
            />
          </div>
          <div class="column is-half-tablet is-one-third-desktop">
            <file-upload
              name="settings-file-upload"
              :accept="['.yaml', '.yml']"
              label="Settings File"
              tooltip="A settings.yaml exported from the Submit tab. Restores the video options, voice styles and song details."
              v-model="mediaStore.settingsFile"
              @update:modelValue="onSettingsFileChange"
            />
          </div>
          <div class="column is-half-tablet is-one-third-desktop">
            <file-upload
              name="lyrics-file-upload"
              :accept="['.txt', 'text/plain']"
              label="Lyrics File"
              tooltip="A plain text lyrics file. Its contents replace whatever is in the Lyrics tab."
              v-model="mediaStore.lyricsFile"
              @update:modelValue="onLyricsFileChange"
            />
          </div>
          <div class="column is-half-tablet is-one-third-desktop">
            <file-upload
              name="timings-file-upload"
              :accept="['.json']"
              label="Timings File"
              tooltip="A timings.json exported from the Submit tab. Restores the timings you tapped out, so you can pick up where you left off."
              v-model="mediaStore.timingsFile"
              @update:modelValue="onTimingsFileChange"
            />
          </div>
          <div class="column is-half-tablet is-one-third-desktop">
            <file-upload
              name="backing-track-upload"
              label="Backing Track"
              tooltip="An instrumental track you already have. Skips the separation step."
              v-model="mediaStore.backingTrackFile"
              @update:modelValue="onBackingTrackFileChange"
            />
          </div>
          <div class="column is-half-tablet is-one-third-desktop">
            <file-upload
              name="vocal-track-upload"
              label="Vocal Track"
              tooltip="A vocals-only track you already have. Used to check your timings against the singing."
              v-model="mediaStore.vocalTrackFile"
              @update:modelValue="onVocalTrackFileChange"
            />
          </div>
        </div>
      </div>
    </b-collapse>

    <div class="buttons">
      <b-tooltip position="is-right" :label="separatingTrackMessage" :always="isSeparatingTrack">
        <b-button
          label="Separate Track"
          type="is-primary"
          :disabled="!mediaStore.songFile || isSeparatingTrack"
          :loading="isSeparatingTrack"
          @click="separateTrack"
        />
      </b-tooltip>
    </div>
    <div class="separation-progress" v-if="isSeparatingTrack">
      <b-progress
        type="is-primary"
        size="is-medium"
        :rounded="false"
        :value="separationPercent"
        show-value
      >
        {{ separationProgressMessage }}
      </b-progress>
      <!-- Beside the Separate Track button, its always-on tooltip would swallow the clicks. -->
      <b-button label="Cancel" type="is-danger is-light" @click="cancelSeparation" />
    </div>

    <confirm-modal
      v-model="isConfirmingSeparation"
      title="Separate again?"
      type="is-warning"
      icon="warning"
      confirm-label="Separate again"
      cancel-label="Keep what I have"
      @confirm="separateAgain"
    >
      <p>
        The backing and vocal tracks you have now will be unloaded, and the video will wait for the
        new separation before it renders. Save them first if you want to keep them.
      </p>
      <source-file-download-links
        class="mt-4"
        label="Current tracks: "
        :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing"
      />
    </confirm-modal>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { mapStores } from "pinia";
import { fetchYouTubeVideo, parseYouTubeTitle } from "@/lib/video";
import { SeparationModel } from "@/types";

import {
  useMediaStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
} from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { parseSettingsYaml } from "@/lib/settingsFile";
import { classifyProjectFolder } from "@/lib/projectFolder";
import FileUpload from "@/components/FileUpload.vue";
import FolderUpload from "@/components/FolderUpload.vue";
import CircularProgress from "@/components/CircularProgress.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import ConfirmModal from "@/components/ConfirmModal.vue";

function formatList(items: string[]): string {
  if (items.length < 2) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export default defineComponent({
  components: {
    FileUpload,
    FolderUpload,
    CircularProgress,
    SourceFileDownloadLinks,
    ConfirmModal,
  },
  setup() {
    const mediaStore = useMediaStore();
    const timingsStore = useTimingsStore();
    const settingsStore = useSettingsStore();
    const lyricsStore = useLyricsStore();
    return {
      mediaStore,
      timingsStore,
      settingsStore,
      lyricsStore,
    };
  },
  data() {
    return {
      isLoadingYouTube: false,
      youtubeError: null as string | null,
      BACKING_VOCALS_SEPARATOR_MODEL,
      NO_VOCALS_SEPARATOR_MODEL,
      BACKING_VOCALS_HQ_SEPARATOR_MODEL,
      BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
      NO_VOCALS_HQ_SEPARATOR_MODEL,
      isShowingAdvanced: false,
      isConfirmingSeparation: false,
    };
  },
  computed: {
    isSeparatingTrack() {
      return this.mediaStore.isProcessing;
    },
    separationProgress(): number | null {
      return this.mediaStore.separationProgress;
    },
    separationPercent(): number | undefined {
      // undefined leaves the bar indeterminate rather than parked at zero.
      return this.separationProgress === null ? undefined : this.separationProgress * 100;
    },
    separationStage(): string {
      return this.mediaStore.separationStage ?? "separating the track";
    },
    separationProgressMessage(): string {
      const stage = this.separationStage[0].toUpperCase() + this.separationStage.slice(1);
      if (this.separationProgress === null) {
        return `${stage}...`;
      }
      return `${stage}: ${Math.round(this.separationProgress * 100)}%`;
    },
    separationHeaderLabel(): string {
      return this.isSeparatingTrack ? this.separationProgressMessage : "Separating track";
    },
    separatingTrackMessage() {
      if (this.isSeparatingTrack) {
        return "Separating track...head to the Lyrics tab to keep working on the song!";
      }
      if (this.mediaStore.hasSeparatedTrack) {
        return "You already have a backing track. Separating again replaces it.";
      }
      return "Start separating the track while you work on the song timings. It's faster!";
    },
    ...mapStores(useMediaStore),
  },
  methods: {
    async loadYouTubeUrl() {
      this.isLoadingYouTube = true;
      this.youtubeError = null;
      try {
        const [audioBlob, videoBlob, metadata] = await fetchYouTubeVideo(
          this.mediaStore.youtubeUrl ?? "",
        );
        this.mediaStore.songFile = new File([audioBlob], "audio.mp4", {
          type: "audio/mp4",
        });
        const parsedMetadata = parseYouTubeTitle(metadata);
        this.mediaStore.songArtist = parsedMetadata[0];
        this.mediaStore.songTitle = parsedMetadata[1];

        // Update the media store
        this.mediaStore.backgroundVideo = videoBlob;
      } catch (e) {
        console.error(e);
        let errorMessage = e instanceof Error ? e.message : String(e);

        // Try to extract the detail from JSON error responses
        try {
          const errorObj = JSON.parse(errorMessage);
          if (errorObj.detail) {
            errorMessage = errorObj.detail;
          }
        } catch (parseError) {
          // If it's not JSON, use the original message
        }

        this.youtubeError =
          `There was a problem downloading that video: ${errorMessage}.` +
          `Please try again, or use an external service or program to get the audio and add it above.`;
      }
      this.isLoadingYouTube = false;
    },
    // Load a settings.yaml (as exported from the Submit tab) back into the app:
    // video options, per-voice styles, the separation model and the song metadata.
    // Returns the entries the file had that couldn't be applied.
    async applySettingsFile(file: File): Promise<string[]> {
      const settings = parseSettingsYaml(await file.text());

      this.settingsStore.applyVideoOptions(settings.videoOptions);
      if (settings.voiceStyles) {
        this.settingsStore.setVoiceStyles(settings.voiceStyles);
      }
      if (settings.separationModel) {
        this.mediaStore.separationModel = settings.separationModel;
      }
      if (settings.song.title) {
        this.mediaStore.songTitle = settings.song.title;
      }
      if (settings.song.artist) {
        this.mediaStore.songArtist = settings.song.artist;
      }
      if (settings.song.youtubeUrl) {
        this.mediaStore.youtubeUrl = settings.song.youtubeUrl;
      }
      // The real duration is derived from the audio,
      // so the file's value is only useful as a stand-in until a song is loaded.
      if (settings.song.duration && !this.mediaStore.songFile) {
        this.mediaStore.songDuration = settings.song.duration;
      }

      for (const warning of settings.warnings) {
        console.warn(`settings.yaml: ${warning}`);
      }
      return settings.warnings;
    },
    async onSettingsFileChange(file: File | null) {
      if (!file) {
        return;
      }
      try {
        const warnings = await this.applySettingsFile(file);
        this.$buefy.toast.open({
          message: warnings.length
            ? `Settings loaded, but ${warnings.length} entr${warnings.length === 1 ? "y was" : "ies were"} skipped (see the console).`
            : "Settings loaded!",
          type: warnings.length ? "is-warning" : "is-success",
          duration: warnings.length ? 5000 : 2000,
        });
      } catch (e) {
        console.error(e);
        this.mediaStore.settingsFile = null;
        this.$buefy.toast.open({
          message: (e as Error).message,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    async applyTimingsFile(file: File) {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed)) {
        // Legacy / single-voice format: an array of [time, marker] tuples.
        this.timingsStore.resetTimings(parsed);
      } else {
        // Multi-voice format: a per-voice map of timing arrays.
        this.timingsStore.setAllTimings(parsed);
      }
    },
    async onTimingsFileChange(file: File | null) {
      if (!file) {
        this.timingsStore.resetTimings([]);
        return;
      }
      try {
        await this.applyTimingsFile(file);
      } catch (e) {
        console.error(e);
        this.mediaStore.timingsFile = null;
        this.$buefy.toast.open({
          message: `Couldn't read that timings file: ${(e as Error).message}`,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    // Clearing the file leaves the lyrics alone: the text is editable in the
    // Lyrics tab and there is no earlier version to fall back to.
    async onLyricsFileChange(file: File | null) {
      if (!file) {
        return;
      }
      try {
        this.lyricsStore.setLyrics(await file.text());
        this.$buefy.toast.open({ message: "Lyrics loaded!", type: "is-success", duration: 2000 });
      } catch (e) {
        console.error(e);
        this.mediaStore.lyricsFile = null;
        this.$buefy.toast.open({
          message: `Couldn't read that lyrics file: ${(e as Error).message}`,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
    // Loads whatever an extracted project folder holds, applying each file exactly as its
    // own upload field would. What the folder hasn't got is left alone.
    async onProjectFolderSelect(files: File[]) {
      const project = classifyProjectFolder(files);
      const loaded: string[] = [];
      const failed: string[] = [];
      const apply = async (label: string, file: File, run: () => Promise<void> | void) => {
        try {
          await run();
          loaded.push(label);
        } catch (e) {
          console.error(e);
          failed.push(file.name);
        }
      };

      if (project.song) {
        const song = project.song;
        await apply("the song", song, async () => {
          this.mediaStore.songFile = song;
          // The song's own tags land on the title and artist a moment later. Let them,
          // before the settings file puts the project's own values back.
          await this.mediaStore.metadataSettled();
        });
      }
      if (project.settings) {
        const settings = project.settings;
        await apply("settings", settings, async () => {
          await this.applySettingsFile(settings);
          this.mediaStore.settingsFile = settings;
        });
      }
      if (project.lyrics) {
        const lyrics = project.lyrics;
        await apply("lyrics", lyrics, async () => {
          this.lyricsStore.setLyrics(await lyrics.text());
          this.mediaStore.lyricsFile = lyrics;
        });
      }
      if (project.timings) {
        const timings = project.timings;
        await apply("timings", timings, async () => {
          await this.applyTimingsFile(timings);
          this.mediaStore.timingsFile = timings;
        });
      }
      if (project.backing) {
        const backing = project.backing;
        await apply("the backing track", backing, async () => {
          await this.mediaStore.setBackingTrack(backing);
          this.mediaStore.backingTrackFile = backing;
        });
      }
      if (project.vocals) {
        const vocals = project.vocals;
        await apply("the vocal track", vocals, async () => {
          await this.mediaStore.setVocalTrack(vocals);
          this.mediaStore.vocalTrackFile = vocals;
        });
      }
      if (project.font) {
        const font = project.font;
        await apply("the font", font, () => this.settingsStore.setCustomFont(font));
      }

      if (project.ignored.length) {
        console.warn(`Not loaded from the project folder: ${project.ignored.join(", ")}`);
      }
      if (failed.length) {
        this.$buefy.toast.open({
          message: loaded.length
            ? `Loaded ${formatList(loaded)}, but couldn't read ${formatList(failed)}.`
            : `Couldn't read ${formatList(failed)}.`,
          type: "is-danger",
          duration: 5000,
        });
        return;
      }
      this.$buefy.toast.open({
        message: loaded.length
          ? `Loaded ${formatList(loaded)}.`
          : "Nothing to load in that folder.",
        type: loaded.length ? "is-success" : "is-warning",
        duration: loaded.length ? 3000 : 5000,
      });
    },
    onSeparationModelChange(model: SeparationModel) {
      this.mediaStore.separationModel = model;
    },
    onBackingTrackFileChange(file: File | null) {
      this.mediaStore.setBackingTrack(file);
    },
    onVocalTrackFileChange(file: File | null) {
      this.mediaStore.setVocalTrack(file);
    },
    // Separating again throws away the track that is loaded, so ask before it goes.
    separateTrack() {
      if (this.mediaStore.hasSeparatedTrack) {
        this.isConfirmingSeparation = true;
        return;
      }
      this.runSeparation();
    },
    separateAgain() {
      this.mediaStore.discardSeparatedTrack();
      this.runSeparation();
    },
    runSeparation() {
      this.mediaStore.startSeparation(this.mediaStore.songFile, this.mediaStore.separationModel);
    },
    cancelSeparation() {
      this.mediaStore.cancelSeparation();
    },
  },
});
</script>
<style scoped>
.song-info-tab {
  overflow-x: hidden;
  overflow-y: auto;
}

.metadata-input :deep(.input) {
  width: auto;
  max-width: 100%;
}

/* Content sizing drops the browser's default 20-character box,
  which is the width of the YouTube field above; 14rem restores it as the floor. */
@supports (field-sizing: content) {
  .metadata-input :deep(.input) {
    min-width: 14rem;
    field-sizing: content;
  }
}

.buttons {
  margin-top: 1.5rem;
}

/* A disabled button eats its own hover events, so the tooltip wrapper around it would never see them. */
.buttons :deep(button[disabled]) {
  pointer-events: none;
}

.separation-progress {
  padding-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.separation-progress :deep(.progress-wrapper) {
  flex: 1;
  margin-bottom: 0;
}

.separation-model-radios {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.separation-model-radios .model-group-label {
  font-weight: 600;
  font-size: 0.9em;
  margin-top: 0.5rem;
  color: #555;
}

.separation-model-radios .model-group-label:first-child {
  margin-top: 0;
}

.separation-model-radios .hint {
  color: #888;
  font-size: 0.85em;
  margin-left: 0.25rem;
}
</style>
