<template>
  <b-field :label="label">
    <template #label>
      <span>{{ label }}</span>
      <b-tooltip v-if="tooltip" :label="tooltip" position="is-bottom" multilined>
        <b-icon class="tooltip-icon" icon="circle-question" size="is-small"></b-icon>
      </b-tooltip>
    </template>
    <b-upload
      :expanded="expanded"
      :model-value="selected"
      @update:model-value="onSelect"
      webkitdirectory
      multiple
      class="file-label"
    >
      <span class="file-cta">
        <b-icon class="file-icon" icon="folder-open"></b-icon>
        <span class="file-label">Choose Folder</span>
      </span>
      <span class="file-name">
        {{ folderName ?? "No folder chosen" }}
      </span>
    </b-upload>
  </b-field>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  emits: ["select"],
  props: {
    label: String,
    tooltip: String,
    expanded: Boolean,
  },
  data() {
    return {
      // Only ever holds a selection long enough to hand it on.
      // b-upload appends to the array it was given and only clears the native input when that array goes back to empty,
      // without which picking the same folder twice would do nothing.
      selected: [] as File[],
      folderName: null as string | null,
    };
  },
  methods: {
    onSelect(value: File | File[] | null) {
      const files = Array.isArray(value) ? [...value] : value ? [value] : [];
      this.selected = [];
      if (files.length === 0) {
        return;
      }
      this.folderName = files[0].webkitRelativePath?.split("/")[0] || null;
      this.$emit("select", files);
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
</style>
