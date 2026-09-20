<template>
  <div
    ref="wavesurfer-container"
    :class="['wavesurfer-container', { 'hide-waveform': !showWaveform }]"
    @wheel="onWheel"
  ></div>
</template>

<script lang="ts">
// A Vue wrapper for a WaveSurfer instance
import { defineComponent, markRaw, PropType } from "vue";
import WaveSurfer from "wavesurfer.js";
import type { GenericPlugin } from "wavesurfer.js/dist/base-plugin";
import RegionsPlugin, { Region, RegionParams } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import { onSchemeChange } from "@/lib/colorScheme";

// WaveSurfer paints to a canvas, so custom properties have to be resolved to literal colors rather than inherited.
function schemeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

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
      type: Array as PropType<RegionParams[]>,
      default: () => [],
    },
    // This is where the view was scrolled to, in seconds. It is applied once, when the waveform
    // is laid out.
    initialScroll: {
      type: Number,
      default: 0,
    },
    waveColor: {
      type: String,
      required: false,
    },
    showWaveform: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      wavesurfer: null as WaveSurfer | null,
      // Not reactive: Vue would hand back proxies of the regions the plugin holds,
      // and the raw instances its own events carry would no longer compare equal to them.
      regionsPlugin: markRaw(RegionsPlugin.create()),
      isVisible: false,
      _observer: null as IntersectionObserver | null,
      _resizeObserver: null as ResizeObserver | null,
      _zoomAnchor: null as { time: number; cursorX: number } | null,
      _unsubscribeScheme: null as (() => void) | null,
      _savedScrollLeft: 0,
      _initialScrollApplied: false,
      // Set when a drag/resize updates a region.
      // The drag has already moved the region's DOM to its final position, so when the resulting timings round-trip
      // back through the `regions` prop we skip the expensive teardown-and-rebuild of every region for that one update.
      _skipNextRegionsUpdate: false,
    };
  },
  mounted() {
    // Create an observer for the wavesurfer container
    this._observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = this.isVisible;
        this.isVisible = entry.isIntersecting;

        // If becoming visible and we have regions, redraw them
        if (!wasVisible && this.isVisible) {
          // A hidden container has no scroll box, so a restore can only land once it is laid out.
          this.$nextTick(() => {
            this.applyInitialScroll();
            if (this.regions.length > 0) {
              this.updateRegions(this.regions);
            }
          });
        }
      },
      {
        threshold: 0,
      },
    );

    // Start observing the container
    this._observer.observe(this.$refs["wavesurfer-container"] as HTMLElement);

    // Hiding the container (display: none) drops its scroll box, so the browser resets the scroll offset.
    // Nothing re-asserts it while playback is paused, so do it whenever the container is laid out again.
    this._resizeObserver = new ResizeObserver(() => this.restoreScroll());
    this._resizeObserver.observe(this.$refs["wavesurfer-container"] as HTMLElement);

    this.wavesurfer = WaveSurfer.create({
      container: this.$refs["wavesurfer-container"] as HTMLElement,
      cursorColor: this.cursorColor,
      cursorWidth: this.cursorWidth,
      mediaControls: this.mediaControls,
      ...this.schemeColors(),
      barWidth: 3,
      barHeight: 1,
      barGap: 2,
      height: 200,
      minPxPerSec: this.minPxPerSec,
      normalize: false,
      plugins: [this.regionsPlugin as unknown as GenericPlugin],
    });
    if (this.audioData) this.wavesurfer.loadBlob(this.audioData);

    this.scrollElement()?.addEventListener("scroll", this.rememberScroll);

    this.wavesurfer.on("click", (x: number) => {
      const time = x * (this.wavesurfer?.getDuration() ?? 0);
      this.$emit("seeking", time);
    });

    this.wavesurfer.on("error", (err: Error) => {
      console.error("Wavesurfer error", err);
    });

    // Regions added before the audio is decoded have no duration to lay themselves out against,
    // and the plugin defers saving them until it has one, past the reach of clearRegions().
    // Landing straight on this tab (a #adjust deep link or reload) is the case that hits it.
    this.wavesurfer.on("ready", () => {
      this.updateRegions(this.regions);
      this.applyInitialScroll();
    });

    this.regionsPlugin.on("region-updated", (region: Region) => {
      // The DOM is already at its final position.
      // Skip the rebuild triggered when these timings round-trip back through the `regions` prop.
      this._skipNextRegionsUpdate = true;
      this.$emit("region-updated", region);
    });

    this.regionsPlugin.on("regions-updated", (regions: Region[]) => {
      this._skipNextRegionsUpdate = true;
      this.$emit("regions-updated", regions);
    });

    this._unsubscribeScheme = onSchemeChange(this.applySchemeColors);
  },
  watch: {
    audioData(newAudioData: Blob) {
      if (this.wavesurfer) {
        console.log("loading new audio data", newAudioData);
        this.wavesurfer.loadBlob(newAudioData);
      }
    },
    minPxPerSec(value: number) {
      if (this.wavesurfer) {
        this.wavesurfer.zoom(value);
        this.$nextTick(() => {
          const scrollEl = this.scrollElement();
          if (scrollEl) {
            if (this._zoomAnchor) {
              scrollEl.scrollLeft = this._zoomAnchor.time * value - this._zoomAnchor.cursorX;
              this._zoomAnchor = null;
            }
            scrollEl.dispatchEvent(new Event("scroll"));
          }
        });
      }
    },
    regions: {
      handler: function (newRegions) {
        // A drag just moved this region in place, so the prop change is only the store value catching up.
        // The DOM is already correct, so skip the teardown-and-rebuild of every region for this one update.
        if (this._skipNextRegionsUpdate) {
          this._skipNextRegionsUpdate = false;
          // The drag already moved the region, so there is no new position left to apply.
          // It can also give an untimed segment a start, which changes the region color,
          // and nothing has repainted that yet.
          this.syncRegionColors(newRegions);
          return;
        }
        // Add regions after audio is decoded or they won't render right
        if (this.isReady()) {
          this.updateRegions(newRegions);
        }
      },
      deep: true,
    },
  },
  emits: ["seeking", "region-updated", "regions-updated", "zoom-change", "scroll-change"],
  methods: {
    schemeColors() {
      return {
        waveColor: this.waveColor ?? schemeColor("--waveform-wave", "rgba(0, 0, 0, 0.1)"),
        progressColor: schemeColor("--bulma-link-on-scheme", "#7957d5"),
      };
    },
    applySchemeColors() {
      this.wavesurfer?.setOptions(this.schemeColors());
    },
    onWheel(event: WheelEvent) {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const scrollEl = this.scrollElement();
      if (scrollEl) {
        const cursorX = event.clientX - scrollEl.getBoundingClientRect().left;
        const time = (scrollEl.scrollLeft + cursorX) / this.minPxPerSec;
        this._zoomAnchor = { time, cursorX };
      }
      // Scrolling up zooms in, matching maps and image viewers.
      this.$emit("zoom-change", -Math.sign(event.deltaY) * 10);
    },
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
    // The stretch of the track currently scrolled into view, in seconds.
    visibleTimeRange(): { start: number; end: number } | null {
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl?.scrollWidth || !duration) return null;
      const { scrollWidth, scrollLeft, clientWidth } = scrollEl;
      // Measured off the laid-out waveform rather than minPxPerSec, which the zoom only asks for.
      const pxPerSec = scrollWidth / duration;
      const endPx = Math.min(scrollWidth, scrollLeft + clientWidth);
      // A playhead landing outside the viewport makes wavesurfer re-center the waveform, and on an
      // exact edge float rounding decides that either way. Both ends are held a half pixel inside,
      // except where the viewport is against the track's own end and the arithmetic is exact.
      return {
        start: scrollLeft <= 0 ? 0 : (scrollLeft + 0.5) / pxPerSec,
        end: endPx >= scrollWidth ? duration : (endPx - 0.5) / pxPerSec,
      };
    },
    clearSelection() {
      this.regionsPlugin.clearSelection();
    },
    setTime(time: number) {
      if (this.wavesurfer) {
        this.wavesurfer.setTime(time);
      }
    },
    isReady() {
      return this.wavesurfer && this.wavesurfer.getDecodedData();
    },
    scrollElement(): HTMLElement | null {
      return (this.wavesurfer?.getWrapper()?.parentElement as HTMLElement) ?? null;
    },
    rememberScroll() {
      const scrollEl = this.scrollElement();
      // While the container is hidden it has no scroll box, and the offset the browser reports is a meaningless zero.
      if (!scrollEl || scrollEl.clientWidth === 0) return;
      this._savedScrollLeft = scrollEl.scrollLeft;
      const start = this.scrollSeconds(scrollEl);
      if (start !== null) this.$emit("scroll-change", start);
    },
    /**
     * The left edge of the view in seconds, which survives a zoom change as a pixel offset would not.
     */
    scrollSeconds(scrollEl: HTMLElement): number | null {
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl.scrollWidth || !duration) return null;
      return (scrollEl.scrollLeft / scrollEl.scrollWidth) * duration;
    },
    applyInitialScroll() {
      if (this._initialScrollApplied || !this.initialScroll) return;
      const scrollEl = this.scrollElement();
      const duration = this.wavesurfer?.getDuration() ?? 0;
      if (!scrollEl || !scrollEl.scrollWidth || !scrollEl.clientWidth || !duration) return;
      this._initialScrollApplied = true;
      this._savedScrollLeft = (this.initialScroll / duration) * scrollEl.scrollWidth;
      scrollEl.scrollLeft = this._savedScrollLeft;
    },
    restoreScroll() {
      const scrollEl = this.scrollElement();
      if (!scrollEl || scrollEl.clientWidth === 0) return;
      scrollEl.scrollLeft = this._savedScrollLeft;
    },
    /**
     * Color is the only thing a drag can change besides position.
     * A drag can't alter the text, and no other region's fill depends on where this one landed.
     */
    syncRegionColors(regions: RegionParams[]) {
      const live = new Map(this.regionsPlugin.getRegions().map((region) => [region.id, region]));
      for (const params of regions) {
        const region = params.id ? live.get(params.id) : undefined;
        if (region && params.color && params.color !== region.color) {
          region.setOptions({ color: params.color });
        }
      }
    },
    updateRegions(regions: RegionParams[]) {
      if (!this.wavesurfer || !this.isVisible || !this.isReady()) return;

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
    this._resizeObserver?.disconnect();
    this._unsubscribeScheme?.();
    this.scrollElement()?.removeEventListener("scroll", this.rememberScroll);
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
