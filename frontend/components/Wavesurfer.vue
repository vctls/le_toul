<template>
  <div ref="wavesurfer-container" :class="['wavesurfer-container', { 'hide-waveform': !showWaveform }]"></div>
</template>

<script lang="ts">
// A Vue wrapper for a WaveSurfer instance
import { defineComponent } from "vue";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  Region,
  RegionsPluginEvents,
} from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";

export default defineComponent({
  props: {
    audioData: {
      type: Blob,
      required: false,
    },
    cursorColor: {
      type: String,
      default: "pink",
    },
    cursorWidth: {
      type: Number,
      default: 1,
    },
    mediaControls: {
      type: Boolean,
      default: false,
    },
    minPxPerSec: {
      type: Number,
      default: 50,
    },
    regions: {
      type: Array,
      default: () => [],
    },
    waveColor: {
      type: String,
      default: "rgba(0, 0, 0, 0.1)",
    },
    showWaveform: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      wavesurfer: null as WaveSurfer | null,
      regionsPlugin: RegionsPlugin.create(),
      isVisible: false,
      _observer: null as IntersectionObserver | null,
    };
  },
  mounted() {
    // Create an observer for the wavesurfer container
    this._observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = this.isVisible;
        this.isVisible = entry.isIntersecting;

        // If becoming visible and we have regions, redraw them
        if (!wasVisible && this.isVisible && this.regions.length > 0) {
          console.log("Wavesurfer became visible, updating regions");
          this.$nextTick(() => {
            this.updateRegions(this.regions);
          });
        }
      },
      {
        threshold: 0,
      }
    );

    // Start observing the container
    this._observer.observe(this.$refs["wavesurfer-container"] as HTMLElement);

    this.wavesurfer = WaveSurfer.create({
      container: this.$refs["wavesurfer-container"] as HTMLElement,
      cursorColor: this.cursorColor,
      cursorWidth: this.cursorWidth,
      mediaControls: this.mediaControls,
      waveColor: this.waveColor,
      progressColor: "purple",
      barWidth: 3,
      barHeight: 1,
      barGap: 2,
      height: 200,
      minPxPerSec: this.minPxPerSec,
      //   responsive: true,
      normalize: false,
      plugins: [this.regionsPlugin],
    });
    this.wavesurfer.loadBlob(this.audioData);

    this.wavesurfer.on("click", (x: number, y: number) => {
      const time = x * this.wavesurfer.getDuration();
      this.$emit("seeking", time);
    });

    this.wavesurfer.on("error", (err: Error) => {
      console.error("Wavesurfer error", err);
    });

    this.regionsPlugin.on("region-updated", (region: Region) => {
      this.$emit("region-updated", region);
    });

  },
  watch: {
    audioData(newAudioData: Blob) {
      if (this.wavesurfer) {
        console.log("loading new audio data", newAudioData);
        this.wavesurfer.loadBlob(newAudioData);
      }
    },
    regions: {
      handler: function (newRegions) {
        // Add regions after audio is decoded or they won't render right
        if (this.isReady()) {
          this.updateRegions(newRegions);
        }
      },
      deep: true
    },
  },
  methods: {
    play() {
      if (this.wavesurfer) {
        this.wavesurfer.play();
      }
    },
    pause() {
      if (this.wavesurfer) {
        this.wavesurfer.pause();
      }
    },
    setTime(time: number) {
      if (this.wavesurfer) {
        this.wavesurfer.setTime(time);
      }
    },
    getCurrentTime() {
      if (this.wavesurfer) {
        return this.wavesurfer.getCurrentTime();
      }
      return 0;
    },
    isReady() {
      return this.wavesurfer && this.wavesurfer.getDecodedData();
    },
    updateRegions(regions: Region[]) {
      if (!this.wavesurfer || !this.isVisible) return;

      // Clear regions first
      this.regionsPlugin.clearRegions();

      // Wait for next tick to ensure DOM is updated
      this.$nextTick(() => {
        if (this.isVisible && this.wavesurfer) {
          for (const region of regions) {
            try {
              this.regionsPlugin.addRegion(region);
            } catch (e) {
              console.error("Failed to add region", e);
            }
          }
        }
      });
    },
  },
  beforeUnmount() {
    this._observer?.disconnect();
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
    }
  },
});
</script>

<style>
.wavesurfer-container.hide-waveform ::part(canvases),
.wavesurfer-container.hide-waveform ::part(progress) {
  visibility: hidden;
}
</style>