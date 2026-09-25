<template>
  <div class="wrapper">
    <b-navbar shadow :mobile-burger="false">
      <template #brand>
        <b-navbar-item tag="span">
          <span class="title">Le Toul</span>
        </b-navbar-item>
      </template>
      <template #end>
        <b-navbar-item tag="div">
          <div class="buttons">
            <b-button
              :type="helpStore.isShowingHelp ? 'is-primary' : 'is-text'"
              @click="helpStore.toggleHelp()"
              title="Show or hide the instructions on each tab"
            >
              <b-icon icon="circle-question" size="is-large" title="Instructions"></b-icon>
            </b-button>
            <b-button
              type="is-text"
              @click="confirmStartOver"
              title="Discard the saved session and start fresh"
            >
              <b-icon icon="arrow-rotate-left" size="is-large" title="Start Over"></b-icon>
            </b-button>
            <b-button type="is-text" @click="themeStore.cycle()" :title="themeTitle">
              <b-icon :icon="themeButton.icon" size="is-large" :title="themeButton.label"></b-icon>
            </b-button>
            <b-button v-if="DONATE_URL" tag="a" :href="DONATE_URL" type="is-text" target="_blank">
              <b-icon icon="circle-dollar-to-slot" size="is-large" title="Buy Me A Coffee">
              </b-icon>
            </b-button>
            <b-button tag="a" href="https://github.com/vctls/le_toul" type="is-text">
              <b-icon pack="fab" icon="github" size="is-large" title="GitHub"> </b-icon>
            </b-button>
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
        This will discard the current song, tracks, lyrics and timings. Settings will be kept. Save
        anything you want to keep first.
      </p>
      <source-file-download-links
        class="mt-4"
        label="Current files: "
        :song="mediaStore.songFile ?? undefined"
        :lyrics="lyricsStore.lyricText"
        :timings="timingsStore.hasAnyTimings ? timingsStore.timingsFile : undefined"
        :vocals="mediaStore.separatedTrack?.vocals"
        :accompaniment="mediaStore.separatedTrack?.backing"
      />
    </confirm-modal>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { isMobile } from "@/lib/device";
import { DONATE_URL } from "@/constants";
import HelpTab from "@/components/HelpTab.vue";
import SongInfoTab from "@/components/SongInfoTab.vue";
import LyricInputTab from "@/components/LyricInputTab.vue";
import SongTimingTab from "@/components/SongTimingTab.vue";
import TimingAdjustmentTab from "@/components/TimingAdjustmentTab.vue";
import TimingEditTab from "@/components/TimingEditTab.vue";
import SubmitTab from "@/components/SubmitTab.vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";
import { useMediaStore } from "@/stores/media";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { useHelpStore } from "@/stores/help";
import { useThemeStore } from "@/stores/theme";
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
  },
  setup() {
    return {
      mediaStore: useMediaStore(),
      lyricsStore: useLyricsStore(),
      timingsStore: useTimingsStore(),
      helpStore: useHelpStore(),
      themeStore: useThemeStore(),
      ...useTabRoute(),
    };
  },
  data() {
    return {
      DONATE_URL,
      isSubmitting: false,
      isConfirmingStartOver: false,
    };
  },

  computed: {
    isMobile,
    themeButton(): { icon: string; label: string } {
      return THEME_BUTTONS[this.themeStore.preference];
    },
    themeTitle(): string {
      return `${this.themeButton.label} — click to change`;
    },
  },
  methods: {
    confirmStartOver() {
      this.isConfirmingStartOver = true;
    },
    async startOver() {
      this.timingsStore.clear();
      this.lyricsStore.clear();
      await this.mediaStore.clearSession();
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
