<template>
  <b-tooltip
    ref="tooltip"
    :label="label"
    position="is-bottom"
    append-to-body
    multilined
    content-class="viewport-tooltip"
    @open="onOpen"
    @close="isOpen = false"
  >
    <slot />
  </b-tooltip>
</template>

<script lang="ts">
import { defineComponent } from "vue";

// Keep in sync with the max-width in the styles below.
const VIEWPORT_MARGIN = 8;

export default defineComponent({
  props: {
    label: { type: String, required: true },
  },
  data() {
    return { isOpen: false };
  },
  watch: {
    label() {
      if (this.isOpen) this.$nextTick(this.clamp);
    },
  },
  methods: {
    onOpen() {
      this.isOpen = true;
      this.$nextTick(this.clamp);
    },
    /**
     * Shifts the tooltip sideways so it stays inside the window,
     * and shifts its arrow back so it still points at the trigger.
     */
    clamp() {
      const content = (this.$refs.tooltip as { $refs: { content?: HTMLElement } }).$refs.content;
      if (!content) return;
      content.style.setProperty("--tooltip-shift", "0px");
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
  },
});
</script>

<style>
/* The content is appended to the body, out of reach of scoped styles.
Bulma sets the multiline width per size class, so overriding it takes a selector naming the size too. */
.b-tooltip.is-multiline.is-medium .tooltip-content.viewport-tooltip {
  width: max-content;
  max-width: min(240px, 100vw - 16px);
  transform: translateX(calc(-50% + var(--tooltip-shift, 0px)));
}

.b-tooltip.is-bottom .tooltip-content.viewport-tooltip::before {
  transform: translateX(calc(-50% - var(--tooltip-shift, 0px)));
}

/* Buefy drops the appended wrapper to z-index: -1 as soon as the tooltip starts closing,
so the fade-out would play behind the page.
Once hidden, the wrapper is zero-sized and its content is display:none, so it covers nothing. */
body > div:has(> .b-tooltip > .tooltip-content.viewport-tooltip) {
  z-index: 99 !important;
}
</style>
