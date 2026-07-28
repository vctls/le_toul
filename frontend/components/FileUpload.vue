<template>
  <b-field :label="label">
    <b-upload v-model="file" class="file-label" :accept="acceptAttribute">
      <span class="file-cta">
        <b-icon class="file-icon" icon="upload"></b-icon>
        <span class="file-label">Choose File</span>
      </span>
      <span class="file-name">
        {{ file?.name || "No file chosen" }}
      </span>
    </b-upload>
    <p class="control">
      <b-button
        type="is-danger is-light"
        @click="file = null"
        v-if="file"
        icon-left="trash-can"
      >
      </b-button></p
  ></b-field>
</template>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({
  props: {
    label: String,
    modelValue: File,
    // Extensions or MIME types to filter the file picker with, either as a list
    // of entries or as a ready-made accept string.
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
      set(newValue) {
        this.$emit("update:modelValue", newValue);
      },
    },
  },
});
</script>