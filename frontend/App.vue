<template>
  <div class="wrapper">
    <b-navbar shadow :mobile-burger="false">
      <template #brand>
        <b-navbar-item tag="span">
          <span class="title">The Tüül</span>
        </b-navbar-item>
        <b-navbar-item>
          <span class="subtitle mb-0">
            &nbsp;(For Making Decent Karaoke Videos From Any Song in About 10
            Minutes)</span></b-navbar-item>
      </template>
      <template #end>
        <b-navbar-item>
          <div class="buttons">
            <b-button type="is-text" @click="confirmStartOver" title="Discard the saved session and start fresh">
              <b-icon icon="arrow-rotate-left" size="is-large" title="Start Over"></b-icon>
            </b-button>
            <b-button v-if="DONATE_URL" tag="a" :href="DONATE_URL" type="is-text" target="_blank">
              <b-icon icon="circle-dollar-to-slot" size="is-large" title="Buy Me A Coffee">
              </b-icon></b-button>
            <b-button tag="a" href="https://github.com/incidentist/the_tuul" type="is-text">
              <b-icon pack="fab" icon="github" size="is-large" title="GitHub">
              </b-icon></b-button>
          </div>
        </b-navbar-item>
      </template>
    </b-navbar>
    <b-tabs expanded :vertical="!isMobile" type="is-boxed" class="main-tabs">
      <help-tab></help-tab>
      <song-info-tab @options-change="onOptionsChange" :music-separation-model="musicSeparationModel"></song-info-tab>
      <lyric-input-tab></lyric-input-tab>
      <song-timing-tab></song-timing-tab>
      <timing-adjustment-tab />
      <submit-tab :music-separation-model="musicSeparationModel"></submit-tab>
    </b-tabs>
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
import SubmitTab from "@/components/SubmitTab.vue";
import {
  BACKING_VOCALS_SEPARATOR_MODEL,
  useMediaStore,
} from "@/stores/media";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
// import mountedHarness from "@/mountedHarness";
import { storeToRefs } from "pinia";

export default defineComponent({
  // mixins: [mountedHarness],
  components: {
    HelpTab,
    SongInfoTab,
    LyricInputTab,
    SongTimingTab,
    TimingAdjustmentTab,
    SubmitTab,
  },
  data() {
    return {
      DONATE_URL,
      musicSeparationModel: BACKING_VOCALS_SEPARATOR_MODEL,
      isSubmitting: false,
    };
  },

  computed: {
    isMobile,
  },
  methods: {
    onOptionsChange(newOptions) {
      for (const key in newOptions) {
        if (Object.hasOwnProperty.call(newOptions, key)) {
          const newValue = newOptions[key];
          this[key] = newValue;
        }
      }
    },

    confirmStartOver() {
      const mediaStore = useMediaStore();
      const lyricsStore = useLyricsStore();
      const timingsStore = useTimingsStore();
      this.$buefy.dialog.confirm({
        title: "Start over?",
        message:
          "This will discard the current song, lyrics, and timings. Settings will be kept. Continue?",
        confirmText: "Start over",
        type: "is-danger",
        hasIcon: true,
        onConfirm: async () => {
          timingsStore.clear();
          lyricsStore.clear();
          await mediaStore.clearSession();
        },
      });
    },
  },
});
</script>

<style scoped>
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
