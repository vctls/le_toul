<template>
  <b-tab-item
    value="submit"
    label="Submit"
    icon="blender"
    class="submit-tab scroll-wrapper"
    headerClass="submit-tab-header"
  >
    <div class="columns is-variable is-5">
      <div
        class="column is-4 settings-column"
        :class="{ 'has-more-above': scrollHints.above }"
        ref="settingsColumn"
        @scroll="updateScrollHints"
        @transitionend="updateScrollHints"
      >
        <h2 class="title">More Settings</h2>
        <b-field horizontal>
          <template #label>
            Count-Ins
            <b-tooltip
              append-to-body
              content-class="wide-tooltip"
              multilined
              label="Add count-in characters so you know when to start singing: before each screen, or before any line that follows a gap"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip>
          </template>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="none"
            type="is-primary is-light is-outlined"
          >
            <span>None</span>
          </b-radio-button>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="screen"
            type="is-primary is-light is-outlined"
          >
            <span>Screen start</span>
          </b-radio-button>
          <b-radio-button
            v-model="videoOptions.countInMode"
            native-value="line"
            type="is-primary is-light is-outlined"
          >
            <span>Line start</span>
          </b-radio-button>
        </b-field>
        <template v-if="videoOptions.countInMode !== 'none'">
          <b-field horizontal>
            <template #label>
              Dynamic Count-Ins
              <b-tooltip
                append-to-body
                content-class="wide-tooltip"
                multilined
                label="Split the count-in text into up to three marks: a long gap gets them all and shorter gaps get fewer. A gap too short for one still gets the last mark, which starts while the previous line is being sung, as long as the line is already on screen. Turn this off to show the whole text for a fixed length instead"
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-switch v-model="videoOptions.dynamicCountIns"></b-switch>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Text
              <b-tooltip
                append-to-body
                content-class="wide-tooltip"
                multilined
                :label="
                  videoOptions.dynamicCountIns
                    ? 'What a count-in shows before the singing starts, split by word if it has spaces and by character otherwise. Leave it empty to draw blocks'
                    : 'What a count-in shows before the singing starts'
                "
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-field>
              <b-input
                ref="countInInput"
                expanded
                :model-value="videoOptions.countInText"
                @update:model-value="
                  (v: string | number | undefined) => (videoOptions.countInText = String(v ?? ''))
                "
              ></b-input>
              <p class="control">
                <SymbolPicker :groups="countInSymbols" @pick="insertCountInSymbol" />
              </p>
            </b-field>
          </b-field>
          <b-field horizontal>
            <template #label>
              Count-In Gap
              <b-tooltip
                append-to-body
                content-class="wide-tooltip"
                multilined
                :label="
                  videoOptions.dynamicCountIns
                    ? 'A line that starts this long after the previous one gets every mark, and shorter gaps get fewer, down to the last mark alone. A full count-in lasts this long, with its marks evenly spaced'
                    : 'Add a count-in when a line starts more than this many seconds after the previous line ends'
                "
              >
                <b-icon size="is-small" icon="circle-question"></b-icon>
              </b-tooltip>
            </template>
            <b-numberinput
              expanded
              :model-value="videoOptions.countInThreshold"
              :min="0.5"
              :step="0.1"
              @update:model-value="
                (v: number | null | undefined) =>
                  (videoOptions.countInThreshold = Number(v ?? videoOptions.countInThreshold))
              "
              controls-position="compact"
            ></b-numberinput>
          </b-field>
          <b-field v-if="!videoOptions.dynamicCountIns" horizontal>
            <template #label>
              Count-In Length
              <b-tooltip
                append-to-body
                content-class="wide-tooltip"
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
              :step="0.1"
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
            Instrumental Breaks
            <b-tooltip
              append-to-body
              content-class="wide-tooltip"
              label="Add screens that count down long instrumentals"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.addInstrumentalScreens"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Show Fast Lines Early
            <b-tooltip
              append-to-body
              content-class="wide-tooltip"
              label="Show the first few lines of a screen early if it starts right after the previous screen ends"
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.addStaggeredLines"></b-switch
        ></b-field>
        <b-field v-if="advancedStore.isAdvanced && timingsStore.hasDisplayPeriods" horizontal>
          <template #label>
            Use Line Display Times
            <b-tooltip
              append-to-body
              content-class="wide-tooltip"
              multilined
              label="Show each line when its display times say, as set in the Edit tab or imported from a KBP file. When off, the automatic rules apply. The times are kept either way, and the KBP export still writes them."
            >
              <b-icon size="is-small" icon="circle-question"></b-icon>
            </b-tooltip> </template
          ><b-switch v-model="videoOptions.useStoredDisplayPeriods"></b-switch
        ></b-field>
        <b-field v-if="videoBlob" horizontal label="Use Background Video">
          <b-switch v-model="videoOptions.useBackgroundVideo"></b-switch
        ></b-field>
        <b-field horizontal>
          <template #label>
            Video Format
            <b-tooltip
              append-to-body
              content-class="wide-tooltip"
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
        <div class="card fonts-and-colors">
          <button
            type="button"
            class="card-header"
            aria-controls="fonts-and-colors"
            :aria-expanded="isShowingFontsAndColors"
            @click="isShowingFontsAndColors = !isShowingFontsAndColors"
          >
            <span class="card-header-title">
              <b-icon class="chevron" icon="angle-right"></b-icon>
              Fonts and Colors
            </span>
          </button>
          <div id="fonts-and-colors" ref="fontsAndColorsBody" class="fonts-and-colors-body">
            <div class="card-content">
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
                    append-to-body
                    content-class="wide-tooltip"
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
                  Rendering lyrics in &ldquo;{{ settingsStore.customFontFamily }}&rdquo;, overriding
                  the font above.
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
              <!-- The renderer draws bold unless told otherwise. -->
              <b-field horizontal label="Bold"
                ><b-switch
                  :model-value="videoOptions.font.bold !== false"
                  @update:model-value="(bold: boolean) => (videoOptions.font.bold = bold)"
                ></b-switch
              ></b-field>
              <b-field horizontal label="Italic"
                ><b-switch
                  :model-value="videoOptions.font.italic === true"
                  @update:model-value="(italic: boolean) => (videoOptions.font.italic = italic)"
                ></b-switch
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
              <b-field horizontal label="Outline Color"
                ><color-field v-model="videoOptions.color.outline" label="outline color"
              /></b-field>
              <b-field horizontal label="Outline Width"
                ><b-numberinput
                  expanded
                  :model-value="videoOptions.outlineWidth"
                  :min="0"
                  :step="0.5"
                  :min-step="0.1"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions.outlineWidth = Number(v ?? videoOptions.outlineWidth))
                  "
                  controls-position="compact"
                ></b-numberinput
              ></b-field>
              <b-field horizontal label="Shadow Color"
                ><color-field v-model="videoOptions.color.shadow" label="shadow color"
              /></b-field>
              <b-field horizontal>
                <template #label>
                  Shadow Offset X
                  <b-tooltip
                    append-to-body
                    content-class="wide-tooltip"
                    label="Positive values move the shadow right, negative values left. Zero on both axes turns it off."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </b-tooltip>
                </template>
                <b-numberinput
                  expanded
                  :model-value="videoOptions.shadowX"
                  :step="0.5"
                  :min-step="0.1"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions.shadowX = Number(v ?? videoOptions.shadowX))
                  "
                  controls-position="compact"
                ></b-numberinput>
              </b-field>
              <b-field horizontal>
                <template #label>
                  Shadow Offset Y
                  <b-tooltip
                    append-to-body
                    content-class="wide-tooltip"
                    label="Positive values move the shadow down, negative values up. Zero on both axes turns it off."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </b-tooltip>
                </template>
                <b-numberinput
                  expanded
                  :model-value="videoOptions.shadowY"
                  :step="0.5"
                  :min-step="0.1"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions.shadowY = Number(v ?? videoOptions.shadowY))
                  "
                  controls-position="compact"
                ></b-numberinput>
              </b-field>
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
              <b-field v-if="advancedStore.isAdvanced" horizontal>
                <template #label>
                  Line Spacing
                  <b-tooltip
                    append-to-body
                    content-class="wide-tooltip"
                    multilined
                    label="From the top of one line to the top of the next, as a multiple of the font size. A KBP file sets it from its own margins."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </b-tooltip>
                </template>
                <b-numberinput
                  expanded
                  :model-value="videoOptions.lineSpacing"
                  :min="0.5"
                  :step="0.1"
                  :min-step="0.001"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions.lineSpacing = Number(v ?? videoOptions.lineSpacing))
                  "
                  controls-position="compact"
                ></b-numberinput>
              </b-field>
              <b-field
                v-if="
                  advancedStore.isAdvanced &&
                  videoOptions.verticalAlignment === VerticalAlignment.Top
                "
                horizontal
              >
                <template #label>
                  Top Margin
                  <b-tooltip
                    append-to-body
                    content-class="wide-tooltip"
                    multilined
                    label="The space above the first line, as a multiple of the font size. A KBP file sets it from its own margins."
                  >
                    <b-icon size="is-small" icon="circle-question"></b-icon>
                  </b-tooltip>
                </template>
                <b-numberinput
                  expanded
                  :model-value="videoOptions.topMargin"
                  :min="0"
                  :step="0.1"
                  :min-step="0.001"
                  @update:model-value="
                    (v: number | null | undefined) =>
                      (videoOptions.topMargin = Number(v ?? videoOptions.topMargin))
                  "
                  controls-position="compact"
                ></b-numberinput>
              </b-field>
              <voice-style-settings v-if="voices.length > 1" :fonts="fonts" />
            </div>
          </div>
        </div>
      </div>
      <div class="column is-8 preview-column">
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
        :separation-songs-ahead="mediaStore.separationSongsAhead"
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
      <div class="download-links">
        <source-file-download-links
          :lyrics="lyricText"
          :timings="timingsText"
          :subtitles="allVoicesSubtitles()"
          :settings="settingsYaml"
          :font="customFont ?? undefined"
          :vocals="mediaStore.separatedTrack?.vocals"
          :accompaniment="mediaStore.separatedTrack?.backing"
        />
        <div v-if="advancedStore.isAdvanced && lyricText.trim()" class="kbp-export is-size-7">
          <span>Karaoke Builder Studio</span>
          <b-tooltip
            append-to-body
            content-class="wide-tooltip"
            multilined
            label="These lyrics and timings as a Karaoke Builder Studio project. They aren't included in the project download."
          >
            <b-icon size="is-small" icon="circle-question"></b-icon>
          </b-tooltip>
          <span class="ml-1">{{ kbpFileName }}</span>
          <button
            type="button"
            class="link-button"
            @click="downloadKbp"
            title="download Karaoke Builder Studio project"
          >
            <b-icon icon="download" />
          </button>
        </div>
      </div>
      <b-message
        v-if="advancedStore.isAdvanced && kbpExportWarnings.length"
        class="kbp-warnings mt-3"
        type="is-warning"
        size="is-small"
        title="Some parts may not look the same in KBS"
        closable
        @close="kbpExportWarnings = []"
      >
        <ul>
          <li v-for="warning in kbpExportWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </b-message>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { storeToRefs } from "pinia";
import { OutputFormat, VerticalAlignment } from "@/lib/timing";
import VideoPreview from "@/components/VideoPreview.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import VideoCreationProgressIndicator from "@/components/VideoCreationProgressIndicator.vue";
import VoiceStyleSettings from "@/components/VoiceStyleSettings.vue";
import ColorField from "@/components/ColorField.vue";
import FileUpload from "@/components/FileUpload.vue";
import SymbolPicker from "@/components/SymbolPicker.vue";
import jszip from "jszip";
import video from "@/lib/video";
import { CreationPhase } from "@/types";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore, VideoSettings } from "@/stores/settings";
import { useTimingsStore } from "@/stores/timings";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";
import { abortable } from "@/lib/util";
import { projectSongEntryName } from "@/lib/projectFolder";
import { BUNDLED_FONTS as fonts, COUNT_IN_SYMBOLS } from "@/lib/fonts";
import { projectFilesToKbp } from "@/lib/kbpConvert";
import { applyVoiceStyle } from "@/lib/voiceStyle";
import { extensionForBlob } from "@/lib/audio";
import { slide } from "@/lib/slide";

// The rest of the bar is the zip, which carries the source song and both separated tracks.
const RENDER_SHARE = 0.95;

const outputFormatLabels: Record<OutputFormat, string> = {
  mp4: "MP4",
  mkv: "MKV, with vocal and original tracks",
};

export default defineComponent({
  components: {
    VideoPreview,
    SourceFileDownloadLinks,
    VideoCreationProgressIndicator,
    VoiceStyleSettings,
    ColorField,
    FileUpload,
    SymbolPicker,
  },
  setup() {
    const mediaStore = useMediaStore();
    const settingsStore = useSettingsStore();
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    const fallbackFontsStore = useFallbackFontsStore();
    const { lyricText, voices } = storeToRefs(lyricsStore);
    const { allVoicesSubtitles } = storeToRefs(timingsStore);
    return {
      mediaStore,
      settingsStore,
      timingsStore,
      lyricsStore,
      fallbackFontsStore,
      advancedStore: useAdvancedStore(),
      lyricText,
      voices,
      allVoicesSubtitles,
    };
  },
  data() {
    return {
      // What the last KBP download couldn't carry over.
      kbpExportWarnings: [] as string[],
      fonts,
      countInSymbols: COUNT_IN_SYMBOLS,
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
      // Whether the settings column has content past its top and bottom edges. See the fade in the styles.
      scrollHints: { above: false },
      // Nothing rendered here, so keep Vue out of it.
      hintObserver: markRaw({ observer: null as ResizeObserver | null }),
    };
  },
  mounted() {
    if (this.videoBlob != null) {
      this.videoOptions.useBackgroundVideo = true;
    }
    if (!this.isShowingFontsAndColors) {
      (this.$refs.fontsAndColorsBody as HTMLElement).style.display = "none";
    }
    // The tab starts hidden, so the column has no size to measure until it is opened.
    // The observer's first callback is what catches that, and the tab strip resizing it later.
    this.hintObserver.observer = new ResizeObserver(() => this.updateScrollHints());
    const settingsColumn = this.$refs.settingsColumn as HTMLElement | undefined;
    if (settingsColumn) {
      this.hintObserver.observer.observe(settingsColumn);
    }
  },
  // Fields appear and disappear with the count-in mode and the uploaded font,
  // which changes how far a column scrolls without anyone scrolling it.
  updated() {
    this.updateScrollHints();
  },
  beforeUnmount() {
    this.hintObserver.observer?.disconnect();
  },
  watch: {
    isShowingFontsAndColors(open: boolean) {
      slide(this.$refs.fontsAndColorsBody as HTMLElement, open);
    },
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
      const map: Record<string, string> = { ...this.fallbackFontsStore.fontUrls };
      if (customFontFamily && customFontUrl) {
        map[customFontFamily] = customFontUrl;
      }
      for (const voice of this.voices) {
        const font = this.settingsStore.getVoiceFont(voice);
        if (font) {
          map[font.family] = font.url;
        }
      }
      return map;
    },
    // Only these are written for FFmpeg's libass, which has no fonts of its own to fall back on.
    renderFontMap(): Record<string, string> {
      const families = new Set([
        this.renderOptions.font.name,
        ...this.voices.map(
          (voice) =>
            applyVoiceStyle(this.renderOptions, this.settingsStore.renderVoiceStyle(voice)).font
              .name,
        ),
      ]);
      for (const [, family] of this.allVoicesSubtitles().matchAll(/\\fn([^\\}]+)/g)) {
        families.add(family);
      }
      return Object.fromEntries(
        Object.entries(this.fontMap).filter(([family]) => families.has(family)),
      );
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
    audioDelay(): number {
      return this.timingsStore.audioDelay;
    },
    kbpFileName(): string {
      const song = this.mediaStore.songFile?.name;
      return song ? song.replace(/\.[^.]*$/, "") + ".kbp" : "project.kbp";
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
    timingsText(): string {
      return this.timingsStore.timingsText;
    },
    settingsYaml(): string {
      return this.settingsStore.settingsYaml;
    },
  },
  methods: {
    /**
     * Put a symbol into the count-in text where the cursor was, replacing any selection.
     */
    insertCountInSymbol(symbol: string) {
      const input = (this.$refs.countInInput as { $refs: { input: HTMLInputElement } }).$refs.input;
      const text = this.videoOptions.countInText;
      const start = input.selectionStart ?? text.length;
      const end = input.selectionEnd ?? text.length;
      this.videoOptions.countInText = text.slice(0, start) + symbol + text.slice(end);
      const cursor = start + symbol.length;
      // The input has lost focus to the picker but still keeps its cursor for the next pick.
      this.$nextTick(() => input.setSelectionRange(cursor, cursor));
    },
    updateScrollHints() {
      const el = this.$refs.settingsColumn as HTMLElement | undefined;
      // Sub-pixel leftovers are rounding, not content.
      this.scrollHints.above = !!el && el.scrollTop > 1;
    },
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
          fontMap: this.renderFontMap,
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

    downloadKbp() {
      const { kbp, warnings } = projectFilesToKbp({
        lyrics: this.lyricText,
        timings: this.timingsStore.segmentsByVoice,
        settings: this.settingsYaml,
        audioName: this.mediaStore.songFile?.name ?? null,
      });
      this.kbpExportWarnings = warnings;
      const anchor = document.createElement("a");
      anchor.style.display = "none";
      anchor.href = URL.createObjectURL(new Blob([kbp], { type: "text/plain;charset=utf-8" }));
      anchor.download = this.kbpFileName;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
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
      zip.file("timings.txt", this.timingsText);
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
        zip.file(`vocals.${extensionForBlob(separated.vocals)}`, separated.vocals);
      }
      if (separated?.backing && separated.backing.size > 0) {
        zip.file(`accompaniment.${extensionForBlob(separated.backing)}`, separated.backing);
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
.field.is-horizontal .field-label {
  flex-grow: 3;
}

/* These tooltips are appended to the body so the scrolling column can't clip them,
which also puts them out of reach of this component's scoped styles.
Bulma sets the multiline width per size class, so overriding its 240px takes a selector naming the size too. */
.b-tooltip.is-multiline.is-medium .tooltip-content.wide-tooltip {
  width: 24rem;
}

/* Buefy drops the appended wrapper to z-index: -1 as soon as the tooltip starts closing,
so the fade-out plays out behind the page.
Hold it in front for good:
once hidden the wrapper is zero-sized and its content is display:none, so it covers nothing.
Only an ancestor selector can reach the wrapper,
which Buefy builds in JS and gives no class of its own. */
body > div:has(> .b-tooltip > .tooltip-content.wide-tooltip) {
  z-index: 99 !important;
}
</style>
<style scoped>
.fonts-and-colors {
  margin-top: 1rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  box-shadow: none;
}

.fonts-and-colors:has(> .card-header:hover) {
  border-color: var(--bulma-border-hover);
}

.fonts-and-colors .card-header {
  width: 100%;
  border: none;
  padding: 0;
  font: inherit;
  text-align: start;
  cursor: pointer;
  box-shadow: none;
}

.fonts-and-colors .card-header-title {
  gap: 0.25rem;
  padding: calc(0.5em - 1px) calc(0.75em - 1px);
}

.fonts-and-colors .chevron {
  transition: transform 250ms ease;
}

.fonts-and-colors .card-header[aria-expanded="true"] .chevron {
  transform: rotate(90deg);
}

.fonts-and-colors-body {
  transition: height 250ms ease;
}

.fonts-and-colors .card-content {
  padding: 0 calc(0.75em - 1px) 0.75rem;
}

/* With no transition, slide() snaps the section to its end state. */
@media (prefers-reduced-motion: reduce) {
  .fonts-and-colors-body,
  .fonts-and-colors .chevron {
    transition: none;
  }
}

.kbp-warnings ul {
  list-style: disc;
  padding-left: 1.25em;
}

.download-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  row-gap: 0.25rem;
}

.kbp-export {
  white-space: nowrap;
  border-left: 1px solid var(--bulma-border);
  margin-left: 0.75rem;
  padding-left: 0.75rem;
}

/* Narrow screens put the export on a line of its own, where a divider would lead nowhere. */
@media screen and (max-width: 768px) {
  .kbp-export {
    border-left: none;
    margin-left: 0;
    padding-left: 0;
  }
}

/* Buefy pins every .tab-item at flex-shrink: 0,
which would hold the tab open at its content height inside the clipped .tab-content
and leave nothing for overflow to scroll. */
.b-tabs .tab-content .submit-tab {
  display: flex;
  flex-direction: column;
  flex-shrink: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Bulma only lays the columns side by side from its tablet breakpoint up.
Once they are, the settings list scrolls on its own rather than pushing Create Video off the bottom,
and the preview fits itself to the height beside it.
Below the breakpoint the columns are stacked blocks and the tab scrolls as one. */
@media screen and (min-width: 769px) {
  .b-tabs .tab-content .submit-tab {
    overflow-y: hidden;
  }

  .submit-tab > .columns {
    flex: 1 1 auto;
    min-height: 0;
  }

  .submit-tab > .columns > .column {
    min-height: 0;
  }

  /* Themed, always-on scrollbar for supporting browsers (not Firefox). */
  .settings-column {
    overflow-y: auto;
    scrollbar-color: var(--bulma-border) transparent;
    scrollbar-gutter: stable;
  }

  .preview-column {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* The height the heading and the track picker leave, which the preview fits itself into. */
  .preview-column > .preview-container {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Fading the content out at an edge reads as "there is more this way" in every browser,
  scrollbar or no scrollbar.
  The bottom fade is always on, so it doesn't pop in when a section grows past the edge.
  The padding of the same height lets the last setting scroll clear of it.
  The top fade only shows once the column is scrolled, so the heading stays crisp at rest. */
  .settings-column {
    --fade-below: 2.5rem;
    padding-bottom: var(--fade-below);
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 var(--fade-above, 0px),
      #000 calc(100% - var(--fade-below)),
      transparent 100%
    );
  }

  .settings-column.has-more-above {
    --fade-above: 2.5rem;
  }

  .submit-button-container {
    flex-shrink: 0;
  }
}

.submit-tab .column {
  text-align: center;
}

/* Flex items default to refusing to shrink below their content,
which here means a long file name widens its field until it overflows the column. */
.submit-tab :deep(.field-body > .field) {
  min-width: 0;
}

/* Bulma decides label-beside-control on the viewport, from its tablet breakpoint up.
This column is a third of the viewport, so it has to answer to its own width instead. */
.settings-column {
  container-type: inline-size;
}

/* An even split with the control, rather than the global 3:5:
this is the narrow column, and at 3:5 twice as many of its labels wrap onto a second line. */
@container (min-width: 30rem) {
  .settings-column :deep(.field.is-horizontal > .field-label) {
    flex-grow: 5;
  }
}

/* Undo what Bulma's own breakpoint adds, which is all that makes the row. */
@container (max-width: 30rem) {
  .settings-column :deep(.field.is-horizontal) {
    display: block;
  }

  .settings-column :deep(.field-label) {
    flex: initial;
    margin-block-end: 0.5rem;
    margin-inline-end: 0;
    text-align: left;
  }

  /* Bulma lays .field-body's controls out in a row from its tablet breakpoint up,
  which keeps a multi-control field (the count-in buttons) on one line once the label moves off it.
  Only the wrapping is ours, for when even that row runs out of room. */
  .settings-column :deep(.field-body) {
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }
}

/* Bulma's label padding assumes a one-line input; these rows hold taller controls. */
.submit-tab :deep(.field.is-horizontal) {
  align-items: center;
}

.submit-tab :deep(.field.is-horizontal > .field-label) {
  padding-top: 0;
}

.submit-tab .radios {
  width: 100%;
  flex-wrap: nowrap;
  column-gap: 0;
  justify-content: space-between;
}

.submit-tab .radios :deep(.radio) {
  white-space: nowrap;
}
</style>
