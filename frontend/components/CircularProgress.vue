<template>
  <svg
    class="circular-progress"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(clampedValue * 100)"
    :aria-label="label"
  >
    <circle class="circular-progress-track" cx="16" cy="16" :r="radius" :stroke-width="strokeWidth" fill="none" />
    <circle
      class="circular-progress-value"
      cx="16"
      cy="16"
      :r="radius"
      :stroke-width="strokeWidth"
      fill="none"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="circumference * (1 - clampedValue)"
    />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

const RADIUS = 13;

export default defineComponent({
  props: {
    // Fraction done, from 0 to 1
    value: { type: Number, default: 0 },
    // Rendered width and height, in CSS units
    size: { type: String, default: "1.25em" },
    strokeWidth: { type: Number, default: 5 },
    label: { type: String, default: "Progress" },
  },
  computed: {
    radius() {
      return RADIUS;
    },
    circumference() {
      return 2 * Math.PI * RADIUS;
    },
    clampedValue(): number {
      return Math.min(Math.max(this.value ?? 0, 0), 1);
    },
  },
});
</script>

<style scoped>
.circular-progress {
  /* The arc starts at 3 o'clock without this. */
  transform: rotate(-90deg);
  vertical-align: middle;
  flex-shrink: 0;
}

.circular-progress-track {
  stroke: currentColor;
  opacity: 0.25;
}

.circular-progress-value {
  stroke: currentColor;
  transition: stroke-dashoffset 0.3s linear;
}
</style>
