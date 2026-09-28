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
      :class="{ 'is-small': isMobile, 'is-primary': isListening }"
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
// Picks a key by having the user press it, so its code name never has to be known or typed.

import { defineComponent } from "vue";
import { BField } from "buefy";
import { isMobile } from "@/lib/device";
import { formatKeyName, isKeyName, keyLabelFromEvent } from "@/lib/timingKeys";

// Held to type a character, so they are part of pressing a key rather than a key of their own.
const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "OS"]);

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
    isMobile,
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
      // The tab catches timing keys on window, and this press is not a timing.
      event.preventDefault();
      event.stopPropagation();
      if (MODIFIERS.has(event.key)) {
        return;
      }
      if (event.code !== "Escape") {
        if (!isKeyName(event.code)) {
          this.rejectedKey =
            event.key.length === 1 ? event.key : formatKeyName(event.code || event.key);
          return;
        }
        this.$emit("bind", event.code, keyLabelFromEvent(event));
      }
      // A focused button answers Space and Enter itself, so it would swallow the next timing tap.
      (event.currentTarget as HTMLElement | null)?.blur();
      this.stopListening();
    },
  },
});
</script>

<style scoped>
/* These sit in a flex row with its own gap, so Bulma's spacing between stacked fields only
pushes the non-last one out of line.
Qualified with .field to win the specificity tie against Bulma's own .field:not(:last-child). */
.field.key-capture-input {
  margin-bottom: 0;
  position: relative;
}

/* The message comes and goes while a key is picked, and would shift the whole row each time. */
.key-capture-input :deep(.help) {
  position: absolute;
  top: 100%;
  white-space: nowrap;
}

.key-capture-input :deep(.field-label) {
  white-space: nowrap;
  flex-grow: 0;
  margin-right: 0.75rem;
}

.key-capture-input .button {
  min-width: 7rem;
}
</style>
