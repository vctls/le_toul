<template>
  <confirm-modal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="replacement ? 'Replace the background?' : 'Remove the background?'"
    type="is-warning"
    icon="warning"
    :confirm-label="replacement ? 'Replace' : 'Remove'"
    cancel-label="Keep what I have"
    @confirm="$emit('confirm')"
  >
    <p v-if="replacement">
      The background you have now will be replaced by <strong>{{ replacement.name }}</strong
      >. Save it first if you want to keep it.
    </p>
    <p v-else>The background you have now will be removed. Save it first if you want to keep it.</p>
    <source-file-download-links class="mt-4" label="Current background: " :background="current" />
  </confirm-modal>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import SourceFileDownloadLinks from "@/components/SourceFileDownloadLinks.vue";

export default defineComponent({
  components: { ConfirmModal, SourceFileDownloadLinks },
  props: {
    modelValue: { type: Boolean, default: false },
    current: Blob,
    // The file that would take its place, or null to remove it.
    replacement: { type: File as unknown as PropType<File | null>, default: null },
  },
  emits: ["update:modelValue", "confirm"],
});
</script>
