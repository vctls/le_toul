<template>
  <div class="wrapper">
    <b-navbar shadow :mobile-burger="false">
      <template #brand>
        <b-navbar-item tag="span">
          <span class="title">{{ appName }}</span>
        </b-navbar-item>
      </template>
      <template #end>
        <b-navbar-item tag="div">
          <div class="buttons">
            <viewport-tooltip label="Show or hide the instructions on each tab">
              <b-button
                :type="helpStore.isShowingHelp ? 'is-primary' : 'is-text'"
                @click="helpStore.toggleHelp()"
                aria-label="Instructions"
                :aria-pressed="helpStore.isShowingHelp"
              >
                <b-icon icon="circle-question" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip
              label="Show or hide the advanced features: the Edit tab, Karaoke Builder Studio files and line display times"
            >
              <b-button
                :type="advancedStore.isAdvanced ? 'is-primary' : 'is-text'"
                @click="advancedStore.toggleAdvanced()"
                aria-label="Advanced"
                :aria-pressed="advancedStore.isAdvanced"
              >
                <b-icon icon="sliders" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip label="Discard the saved session and start fresh">
              <b-button type="is-text" @click="confirmStartOver" aria-label="Start Over">
                <b-icon icon="trash-can" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip :label="themeTitle">
              <b-button type="is-text" @click="themeStore.cycle()" :aria-label="themeButton.label">
                <b-icon :icon="themeButton.icon" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip v-if="DONATE_URL" label="Support the project on Buy Me A Coffee">
              <b-button
                tag="a"
                :href="DONATE_URL"
                type="is-text"
                target="_blank"
                aria-label="Buy Me A Coffee"
              >
                <b-icon icon="circle-dollar-to-slot" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
            <viewport-tooltip label="View the source code on GitHub">
              <b-button
                tag="a"
                href="https://github.com/vctls/le_toul"
                type="is-text"
                aria-label="GitHub"
              >
                <b-icon pack="fab" icon="github" size="is-large"></b-icon>
              </b-button>
            </viewport-tooltip>
          </div>
        </b-navbar-item>
      </template>
    </b-navbar>
    <b-tabs
      :model-value="activeTab"
      @update:model-value="setActiveTab"
      expanded
      :animated="false"
      :vertical="!isMobile"
      type="is-boxed"
      class="main-tabs"
    >
      <help-tab></help-tab>
      <song-info-tab></song-info-tab>
      <lyric-input-tab></lyric-input-tab>
      <song-timing-tab></song-timing-tab>
      <timing-adjustment-tab />
      <timing-edit-tab />
      <submit-tab></submit-tab>
    </b-tabs>
    <confirm-modal
      v-model="isConfirmingStartOver"
      title="Start over?"
      type="is-danger"
      icon="circle-exclamation"
      confirm-label="Start over"
      @confirm="startOver"
    >
      <p>
        This will discard the current song, tracks, lyrics, timings and uploaded fonts. Other
        settings will be kept. Save anything you want to keep first.
      </p>
      <source-file-download-links
        class="mt-4"
        label="Current files: "
        :song="mediaStore.songFile ?? undefined"
        :lyrics="lyricsStore.lyricText"
        :timings="timingsStore.hasAnyTimings ? timingsStore.timingsText : undefined"
        :font="settingsStore.customFont ?? undefined"
        :fonts="voiceFonts"
        :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing"
      />
    </confirm-modal>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { isMobile } from "@/lib/device";
import { DONATE_URL, appName } from "@/constants";
import HelpTab from "@/components/HelpTab.vue";
import SongInfoTab from "@/components/SongInfoTab.vue";
import LyricInputTab from "@/components/LyricInputTab.vue";
import SongTimingTab from "@/components/SongTimingTab.vue";
import TimingAdjustmentTab from "@/components/TimingAdjustmentTab.vue";
import TimingEditTab from "@/components/TimingEditTab.vue";
import SubmitTab from "@/components/SubmitTab.vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import ViewportTooltip from "@/components/ViewportTooltip.vue";
import { useMediaStore } from "@/stores/media";
import { useLyricsStore } from "@/stores/lyrics";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { useTimingsStore } from "@/stores/timings";
import { useSettingsStore } from "@/stores/settings";
import { useHelpStore } from "@/stores/help";
import { useAdvancedStore } from "@/stores/advanced";
import { useLegacyTimingStore } from "@/stores/legacyTiming";
import { useThemeStore } from "@/stores/theme";
import { useFallbackFontsStore } from "@/stores/fallbackFonts";
import { ThemePreference } from "@/lib/colorScheme";
import { useTabRoute } from "@/lib/tabRoute";

const THEME_BUTTONS: Record<ThemePreference, { icon: string; label: string }> = {
  system: { icon: "circle-half-stroke", label: "Theme: follow system" },
  light: { icon: "sun", label: "Theme: light" },
  dark: { icon: "moon", label: "Theme: dark" },
};

export default defineComponent({
  components: {
    HelpTab,
    SongInfoTab,
    LyricInputTab,
    SongTimingTab,
    TimingAdjustmentTab,
    TimingEditTab,
    SubmitTab,
    ConfirmModal,
    SourceFileDownloadLinks,
    ViewportTooltip,
  },
  setup() {
    return {
      mediaStore: useMediaStore(),
      lyricsStore: useLyricsStore(),
      lyricsLookupStore: useLyricsLookupStore(),
      timingsStore: useTimingsStore(),
      settingsStore: useSettingsStore(),
      helpStore: useHelpStore(),
      advancedStore: useAdvancedStore(),
      legacyTimingStore: useLegacyTimingStore(),
      themeStore: useThemeStore(),
      fallbackFontsStore: useFallbackFontsStore(),
      ...useTabRoute(),
    };
  },
  data() {
    return {
      DONATE_URL,
      appName: appName(),
      isSubmitting: false,
      isConfirmingStartOver: false,
    };
  },

  computed: {
    isMobile,
    voiceFonts(): File[] {
      return this.lyricsStore.voices
        .map((voice) => this.settingsStore.getVoiceFont(voice)?.file)
        .filter((file): file is File => file !== undefined);
    },
    themeButton(): { icon: string; label: string } {
      return THEME_BUTTONS[this.themeStore.preference];
    },
    themeTitle(): string {
      return `${this.themeButton.label} — click to change`;
    },
    isOnHiddenTab(): boolean {
      return (
        (this.activeTab === "edit" && !this.advancedStore.isAdvanced) ||
        (this.activeTab === "timing" && !this.legacyTimingStore.isShown)
      );
    },
  },
  watch: {
    // Buefy shows a blank page for a hidden tab that is still active.
    isOnHiddenTab: {
      handler(isHidden: boolean) {
        if (isHidden) this.setActiveTab("adjust");
      },
      immediate: true,
    },
  },
  methods: {
    confirmStartOver() {
      this.isConfirmingStartOver = true;
    },
    async startOver() {
      this.timingsStore.clear();
      this.lyricsStore.clear();
      this.lyricsLookupStore.reset();
      await this.mediaStore.clearSession();
      await this.settingsStore.clearCustomFonts();
    },
  },
});
</script>

<style scoped>
.wrapper > .navbar {
  flex-shrink: 0;
}

/* Bulma hides the navbar menu below its desktop breakpoint, behind a burger we
   don't use. Keep the whole bar laid out as one row at every width. */
@media screen and (max-width: 1023px) {
  .wrapper :deep(.navbar) {
    display: flex;
    align-items: stretch;
  }

  .wrapper :deep(.navbar-menu) {
    display: flex;
    align-items: stretch;
    flex-grow: 1;
    background-color: transparent;
    box-shadow: none;
    padding: 0;
  }

  .wrapper :deep(.navbar-end) {
    display: flex;
    align-items: stretch;
    margin-left: auto;
  }

  .wrapper :deep(.navbar-end .navbar-item) {
    display: flex;
    align-items: center;
  }
}

.main-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
}

/* Buefy adds a bottom margin once the tabs have a sibling after them, such as
   the start over modal while it is open. The doubled class outranks that rule. */
.b-tabs.main-tabs {
  margin-bottom: 0;
}

.b-tabs.is-vertical {
  flex-wrap: nowrap;
}

.scroll-wrapper {
  overflow-y: scroll;
  -webkit-overflow-scrolling: touch;
  height: 100%;
}
</style>
<style>
.b-tabs.main-tabs .tab-content {
  flex-grow: 1;
  overflow: hidden;
}
</style>
