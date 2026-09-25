<template>
  <b-field :label="label">
    <template #label>
      <span>{{ label }}</span>
      <b-tooltip v-if="tooltip" :label="tooltip" position="is-bottom" multilined>
        <b-icon class="tooltip-icon" icon="circle-question" size="is-small"></b-icon>
      </b-tooltip>
    </template>
    <b-upload
      ref="upload"
      :expanded="expanded"
      :model-value="file ?? undefined"
      @update:model-value="onSelect"
      class="file-label"
      :accept="acceptAttribute"
    >
      <span class="file-cta">
        <b-icon class="file-icon" icon="upload"></b-icon>
        <span class="file-label">Choose File</span>
      </span>
      <span class="file-name">
        {{ file?.name || "No file chosen" }}
      </span>
    </b-upload>
    <p class="control">
      <b-button type="is-danger is-light" @click="file = null" v-if="file" icon-left="trash-can">
      </b-button>
    </p>
  </b-field>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";

export default defineComponent({
  emits: ["update:modelValue"],
  props: {
    label: String,
    tooltip: String,
    expanded: Boolean,
    modelValue: { type: File as unknown as PropType<File | null>, default: null },
    // Extensions or MIME types to filter the file picker with,
    // either as a list of entries or as a ready-made accept string.
    accept: [String, Array],
  },
  computed: {
    acceptAttribute(): string | undefined {
      if (!this.accept) {
        return undefined;
      }
      return Array.isArray(this.accept) ? this.accept.join(",") : this.accept;
    },
    file: {
      get() {
        return this.modelValue;
      },
      set(newValue: File | null) {
        this.$emit("update:modelValue", newValue);
      },
    },
  },
  methods: {
    /**
     * Clears the native input after every pick,
     * so picking the same file again still fires a change when the parent declined the first one.
     */
    onSelect(value: File | File[] | null) {
      this.file = Array.isArray(value) ? (value[0] ?? null) : value;
      (this.$refs.upload as { clearInput?: () => void } | undefined)?.clearInput?.();
    },
  },
});
</script>

<style scoped>
.tooltip-icon {
  margin-left: 0.25rem;
}

/* Bulma only grows the name box inside a .file wrapper, which b-upload doesn't render. */
.upload.is-expanded .file-name {
  flex: 1;
  max-width: none;
}

/* Dropping Bulma's 16em cap above also drops the only bound on the control's max-content
width, which a flex parent takes as the width it may not shrink below. A long file name then
pushes the delete button out of a narrow column instead of ellipsising. */
.upload.is-expanded,
.upload.is-expanded .file-name {
  min-width: 0;
}
</style>
