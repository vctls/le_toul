<template>
  <div class="color-field">
    <b-colorpicker :model-value="modelValue" @update:model-value="onPick">
      <template #trigger>
        <b-button
          class="color-swatch"
          :style="{ backgroundColor: canonicalHex }"
          :aria-label="`Pick ${label}`"
        />
      </template>
    </b-colorpicker>
    <input
      class="input hex-input"
      :class="{ 'is-danger': !isValid }"
      type="text"
      spellcheck="false"
      autocomplete="off"
      :aria-label="`${label} hex code`"
      :value="displayedHex"
      @input="onHexInput"
      @blur="discardDraft"
      @keyup.enter="discardDraft"
    />
  </div>
</template>

<script lang="ts">
/* A color picker paired with an editable hex code box. */

import { defineComponent, PropType } from "vue";
import { BColorpicker, BButton } from "buefy";
import Color from "buefy/src/utils/color";

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export default defineComponent({
  components: { BColorpicker, BButton },
  props: {
    modelValue: { type: Object as PropType<Color>, required: true },
    // Used to label the picker and the hex box for screen readers.
    label: { type: String, required: true },
  },
  emits: ["update:modelValue"],
  data() {
    // Holds what the user has typed while the box has focus, so partially typed
    // (and therefore invalid) hex codes aren't overwritten mid-edit.
    return { draft: null as string | null };
  },
  computed: {
    canonicalHex(): string {
      return this.modelValue.toString("hex");
    },
    displayedHex(): string {
      return this.draft ?? this.canonicalHex;
    },
    isValid(): boolean {
      return this.draft === null || HEX_PATTERN.test(this.draft.trim());
    },
  },
  methods: {
    onPick(color: Color) {
      this.draft = null;
      this.$emit("update:modelValue", color);
    },
    onHexInput(event: Event) {
      const text = (event.target as HTMLInputElement).value;
      this.draft = text;
      if (HEX_PATTERN.test(text.trim())) {
        this.$emit("update:modelValue", Color.parse(text.trim()));
      }
    },
    // Drop anything unapplied so the box shows the color that's actually in effect.
    discardDraft() {
      this.draft = null;
    },
  },
});
</script>

<style scoped>
.color-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.color-swatch {
  width: 2.5em;
  height: 2.5em;
  border: 1px solid #dbdbdb;
}

.hex-input {
  width: 8em;
  font-family: monospace;
}
</style>
