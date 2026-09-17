<template>
  <b-field
    horizontal
    :label="label"
    class="key-name-input"
    :type="isInvalid ? 'is-danger' : ''"
    :message="isInvalid ? `${draft.trim()} isn't a key name` : ''"
  >
    <b-autocomplete
      :model-value="draft"
      :data="matches"
      :size="isMobile ? 'is-small' : ''"
      :aria-label="label"
      open-on-focus
      keep-first
      max-height="14rem"
      @update:model-value="onInput"
      @select="onSelect"
      @blur="onBlur"
    ></b-autocomplete>
  </b-field>
</template>

<script lang="ts">
// Picks one KeyboardEvent.code name. Free text so a key can be typed, but only a real
// code is ever emitted: anything else reverts when the field loses focus.

import { defineComponent } from "vue";
import { isMobile } from "@/lib/device";
import { KEY_NAMES, normalizeKeyName } from "@/lib/timingKeys";

export default defineComponent({
  props: {
    label: { type: String, required: true },
    modelValue: { type: String, required: true },
  },
  emits: ["update:modelValue"],
  data() {
    return { draft: this.modelValue };
  },
  watch: {
    modelValue(name: string) {
      this.draft = name;
    },
  },
  computed: {
    isMobile,
    isInvalid(): boolean {
      return this.draft.trim() !== "" && !normalizeKeyName(this.draft);
    },
    matches(): string[] {
      const typed = this.draft.trim().toLowerCase();
      return KEY_NAMES.filter((name) => name.toLowerCase().includes(typed));
    },
  },
  methods: {
    onInput(value: string | number) {
      this.draft = String(value);
      this.commit();
    },
    onSelect(value: string | null) {
      if (value) {
        this.draft = value;
        this.commit();
      }
    },
    onBlur() {
      this.draft = this.commit() ?? this.modelValue;
    },
    commit(): string | undefined {
      const name = normalizeKeyName(this.draft);
      if (name && name !== this.modelValue) {
        this.$emit("update:modelValue", name);
      }
      return name;
    },
  },
});
</script>

<style scoped>
.key-name-input {
  margin-bottom: 0;
}

.key-name-input :deep(.field-label) {
  white-space: nowrap;
  flex-grow: 0;
  margin-right: 0.75rem;
}
</style>
