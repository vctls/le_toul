<template>
  <b-tooltip
    ref="tooltip"
    :label="label"
    :position="placement"
    :always="always"
    :active="isTriggerVisible"
    append-to-body
    multilined
    :content-class="wide ? 'viewport-tooltip is-wide' : 'viewport-tooltip'"
    @open="onOpen"
    @close="isOpen = false"
  >
    <slot />
  </b-tooltip>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type Placement = "is-top" | "is-bottom" | "is-left" | "is-right";

type BuefyTooltip = {
  $el: HTMLElement;
  $refs: { content?: HTMLElement; trigger?: HTMLElement };
  dynamicPosition?: Placement;
  updateAppendToBody(): void;
};

// Keep in sync with the max-width in the styles below.
const VIEWPORT_MARGIN = 8;

/**
 * A tooltip appended to the body, so no scrolling or clipped container crops it.
 * It moves to another side when the requested one has no room, and stays inside the window.
 */
export default defineComponent({
  props: {
    label: { type: String, required: true },
    position: { type: String as PropType<Placement>, default: "is-bottom" },
    wide: Boolean,
    always: Boolean,
  },
  data() {
    return {
      isOpen: false,
      isTriggerVisible: true,
      placement: this.position,
      placeRun: 0,
      scrollFrame: 0,
      observer: null as IntersectionObserver | null,
    };
  },
  computed: {
    isShown(): boolean {
      return this.isOpen || this.always;
    },
  },
  watch: {
    label() {
      if (this.isShown) this.place();
    },
    position() {
      if (this.isShown) this.place();
    },
    isShown(isShown: boolean) {
      this.followScroll(isShown);
    },
  },
  mounted() {
    if (this.isShown) this.followScroll(true);
    const trigger = this.tooltip().$refs.trigger;
    // A trigger hidden or scrolled out of view would leave its appended tooltip floating alone.
    if (trigger && "IntersectionObserver" in window) {
      this.observer = new IntersectionObserver(([entry]) => {
        this.isTriggerVisible = entry.isIntersecting;
        if (this.isTriggerVisible && this.isShown) this.place();
      });
      this.observer.observe(trigger);
    }
  },
  beforeUnmount() {
    this.observer?.disconnect();
    window.removeEventListener("scroll", this.onScroll, { capture: true });
    cancelAnimationFrame(this.scrollFrame);
  },
  methods: {
    tooltip() {
      return this.$refs.tooltip as unknown as BuefyTooltip;
    },
    onOpen() {
      this.isOpen = true;
    },
    /**
     * Places the tooltip, and keeps placing it on scroll while it is shown.
     * The appended tooltip sits at page coordinates, so a scrolled container would leave it behind.
     */
    followScroll(isShown: boolean) {
      if (isShown) {
        window.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
        this.place();
      } else {
        window.removeEventListener("scroll", this.onScroll, { capture: true });
      }
    },
    onScroll() {
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.place();
      });
    },
    /**
     * Tries the requested side, then below, then above, and keeps the first that fits the window.
     * When none fits, it keeps the first of them that is above or below.
     */
    async place() {
      const run = ++this.placeRun;
      const candidates = [...new Set<Placement>([this.position, "is-bottom", "is-top"])];
      let fallback: Placement | null = null;
      for (const candidate of candidates) {
        await this.applyPlacement(candidate);
        if (run !== this.placeRun) return;
        if (this.fits()) return;
        if (!fallback && (candidate === "is-top" || candidate === "is-bottom")) {
          fallback = candidate;
        }
      }
      if (fallback && fallback !== this.placement) await this.applyPlacement(fallback);
    },
    /**
     * Moves the tooltip to the given side, then shifts it sideways into the window.
     */
    async applyPlacement(placement: Placement) {
      this.placement = placement;
      await this.$nextTick();
      const tooltip = this.tooltip();
      // Buefy copies its classes to the appended copy before it updates its own position.
      tooltip.dynamicPosition = placement;
      // Buefy clears the copy's classes while iterating over them, which skips every other one.
      const copy = tooltip.$refs.content?.parentElement;
      if (copy && copy !== tooltip.$el) copy.className = "";
      tooltip.updateAppendToBody();
      this.clamp();
    },
    /**
     * Shifts a tooltip above or below its trigger so it stays inside the window,
     * and shifts its arrow back so it still points at the trigger.
     */
    clamp() {
      const content = this.tooltip().$refs.content;
      if (!content) return;
      content.style.setProperty("--tooltip-shift", "0px");
      if (this.placement !== "is-top" && this.placement !== "is-bottom") return;
      const { left, right } = content.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      let shift = 0;
      if (left < VIEWPORT_MARGIN) {
        shift = VIEWPORT_MARGIN - left;
      } else if (right > viewportWidth - VIEWPORT_MARGIN) {
        shift = viewportWidth - VIEWPORT_MARGIN - right;
      }
      content.style.setProperty("--tooltip-shift", `${shift}px`);
    },
    fits() {
      const content = this.tooltip().$refs.content;
      if (!content) return true;
      const { left, right, top, bottom } = content.getBoundingClientRect();
      const { clientWidth, clientHeight } = document.documentElement;
      return left >= 0 && top >= 0 && right <= clientWidth && bottom <= clientHeight;
    },
  },
});
</script>

<style>
/* The content is appended to the body, out of reach of scoped styles.
Bulma sets the multiline width per size class, so overriding it takes a selector naming the size too. */
.b-tooltip.is-multiline.is-medium .tooltip-content.viewport-tooltip {
  width: max-content;
  max-width: min(240px, 100vw - 16px);
}

.b-tooltip.is-multiline.is-medium .tooltip-content.viewport-tooltip.is-wide {
  max-width: min(24rem, 100vw - 16px);
}

.b-tooltip:is(.is-top, .is-bottom) .tooltip-content.viewport-tooltip {
  transform: translateX(calc(-50% + var(--tooltip-shift, 0px)));
}

.b-tooltip:is(.is-top, .is-bottom) .tooltip-content.viewport-tooltip::before {
  transform: translateX(calc(-50% - var(--tooltip-shift, 0px)));
}

/* Buefy drops the appended wrapper to z-index: -1 as soon as the tooltip starts closing,
so the fade-out would play behind the page.
Once hidden, the wrapper is zero-sized and its content is display:none, so it covers nothing. */
body > div:has(> .b-tooltip > .tooltip-content.viewport-tooltip) {
  z-index: 99 !important;
}
</style>
