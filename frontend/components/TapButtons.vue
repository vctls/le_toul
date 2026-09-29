<template>
  <div
    class="tap-buttons"
    :class="{ 'is-floating': floating }"
    role="group"
    aria-label="Timing buttons"
  >
    <button
      v-if="timingButtons"
      type="button"
      class="button tap-button"
      @pointerdown.prevent="$emit('end')"
      @click="onClick($event, 'end')"
    >
      <span>End</span>
      <kbd v-if="showKeys">{{ endLabel }}</kbd>
    </button>
    <div class="tap-buttons-middle">
      <button
        v-if="timingButtons"
        type="button"
        class="button tap-button is-small-tap"
        title="Go back a line"
        @pointerdown.prevent="$emit('redo')"
        @click="onClick($event, 'redo')"
      >
        <span>Redo</span>
        <kbd v-if="showKeys">{{ redoLabel }}</kbd>
      </button>
      <button
        type="button"
        class="button tap-button is-small-tap"
        :aria-label="playing ? 'Pause' : 'Play'"
        @pointerdown.prevent="$emit('play-pause')"
        @click="onClick($event, 'play-pause')"
      >
        <b-icon :icon="playing ? 'pause' : 'play'" />
      </button>
    </div>
    <button
      v-if="timingButtons"
      type="button"
      class="button tap-button is-primary"
      @pointerdown.prevent="$emit('start')"
      @click="onClick($event, 'start')"
    >
      <span>Start</span>
      <kbd v-if="showKeys">{{ startLabel }}</kbd>
    </button>
  </div>
</template>

<script lang="ts">
// Buttons that stand in for the timing keys, for touchscreens without a keyboard.

import { defineComponent } from "vue";
import { BIcon } from "buefy";

type TapButton = "start" | "end" | "redo" | "play-pause";

export default defineComponent({
  components: { BIcon },
  props: {
    startLabel: { type: String, required: true },
    endLabel: { type: String, required: true },
    redoLabel: { type: String, required: true },
    playing: { type: Boolean, default: false },
    // Whether to show the key each button stands for, for devices that have a keyboard.
    showKeys: { type: Boolean, default: false },
    // Without the timing buttons, only Play/Pause is left, for Adjust mode.
    timingButtons: { type: Boolean, default: true },
    // Float over the waveform, with End and Start in the bottom corners under the thumbs.
    floating: { type: Boolean, default: false },
  },
  emits: ["start", "end", "redo", "play-pause"],
  methods: {
    /**
     * A tap has to land when the finger does, so the buttons act on pointerdown. A click with no
     * pointer behind it comes from a keyboard or assistive technology, and acts too.
     */
    onClick(event: MouseEvent, button: TapButton) {
      if (event.detail === 0) this.$emit(button);
    },
  },
});
</script>

<style scoped>
/* Stuck to the bottom, so the buttons stay under the thumbs when the tab scrolls on a small
screen. With room to spare, it sits under the waveform, which gives up the height. */
.tap-buttons {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding-block: 0.5rem;
  background: var(--bulma-scheme-main);
}

.tap-buttons-middle {
  display: flex;
  gap: 0.5rem;
}

/* Tapped fast and often, so they are big, and a quick second tap mustn't zoom the page. */
.tap-button {
  flex: 1 1 0;
  max-width: 14rem;
  height: auto;
  min-height: 4rem;
  flex-direction: column;
  gap: 0.1rem;
  touch-action: manipulation;
  user-select: none;
}

.tap-button.is-small-tap {
  flex: 0 1 6rem;
  min-width: 4rem;
}

.tap-button kbd {
  font-size: 0.7rem;
  opacity: 0.8;
}

/* Over the waveform, only the buttons take touches, and the waveform shows through them. */
.tap-buttons.is-floating {
  position: fixed;
  inset: auto 0 0;
  justify-content: space-between;
  align-items: flex-end;
  padding: 0.75rem;
  background: none;
  pointer-events: none;
}

.is-floating .tap-button {
  flex: 0 0 9rem;
  min-height: 5rem;
  pointer-events: auto;
  background: color-mix(in srgb, var(--bulma-scheme-main) 55%, transparent);
  backdrop-filter: blur(3px);
}

.is-floating .tap-button.is-primary {
  background: color-mix(in srgb, var(--bulma-primary) 75%, transparent);
}

.is-floating .tap-button.is-small-tap {
  flex: 0 0 4.5rem;
  min-height: 3.5rem;
}

/* With Play/Pause alone, it keeps to the middle. */
.is-floating .tap-buttons-middle:only-child {
  margin-inline: auto;
}
</style>
