<template>
  <b-field
    horizontal
    :label="label"
    class="key-capture-input"
    :type="rejectedKey ? 'is-danger' : ''"
    :message="message"
  >
    <button
      type="button"
      class="button"
      :class="{ 'is-primary': isListening }"
      :aria-label="`${label}: ${keyLabel}`"
      :title="isListening ? '' : 'Click, then press the key to use'"
      @click="isListening = !isListening"
      @keydown="onKeyDown"
      @blur="stopListening"
    >
      {{ isListening ? "Press a key" : keyLabel }}
    </button>
  </b-field>
</template>

<script lang="ts">
// Picks a key by having the user press it, so its name never has to be known or typed.

import { defineComponent } from "vue";
import { BField } from "buefy";
import { bindingFromEvent, bindingLabel, keyLabel } from "@/lib/timingKeys";
import { historyStepFor } from "@/lib/history";

// Held to type a character, so they are part of pressing a key rather than a key of their own.
const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "OS"]);

function swallowEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
  }
}

export default defineComponent({
  components: { BField },
  props: {
    label: { type: String, required: true },
    // The bound key's name for display, from `keyLabel`.
    keyLabel: { type: String, required: true },
  },
  emits: ["bind"],
  data() {
    return {
      isListening: false,
      rejectedKey: null as string | null,
    };
  },
  computed: {
    message(): string {
      if (this.rejectedKey) {
        return `${this.rejectedKey} can't be used. Press another key, or Esc to cancel.`;
      }
      return this.isListening ? "Esc cancels." : "";
    },
  },
  methods: {
    stopListening() {
      this.isListening = false;
      this.rejectedKey = null;
    },
    onKeyDown(event: KeyboardEvent) {
      if (!this.isListening) {
        return;
      }
      // The press is the key being picked, not a shortcut.
      event.preventDefault();
      event.stopPropagation();
      if (MODIFIERS.has(event.key)) {
        return;
      }
      if (event.key === "Escape") {
        // Buefy closes a modal on the keyup, and this Escape only meant to cancel the picking.
        window.addEventListener("keyup", swallowEscape, { capture: true, once: true });
      } else {
        const binding = bindingFromEvent(event);
        if (!binding) {
          this.rejectedKey = event.key === "Dead" ? "An accent key" : keyLabel(event.key);
          return;
        }
        // Undo and redo come first, so the binding would never fire.
        if (historyStepFor(event)) {
          this.rejectedKey = bindingLabel(binding);
          return;
        }
        this.$emit("bind", binding);
      }
      this.stopListening();
    },
  },
});
</script>

<style scoped>
/* Qualified with .field to win the specificity tie against Bulma's own .field:not(:last-child),
whose margin would set a row with a note under it apart from the others. */
.field.key-capture-input {
  margin-bottom: 0;
}

/* The label takes the room left by the key, so the keys line up in a column. */
.key-capture-input :deep(.field-label) {
  flex-grow: 1;
  text-align: left;
}

.key-capture-input :deep(.field-body) {
  flex-grow: 0;
}

.key-capture-input .button {
  min-width: 7rem;
}
</style>
