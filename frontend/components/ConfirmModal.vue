<template>
  <b-modal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    has-modal-card
    trap-focus
    ariaRole="dialog"
    ariaModal
  >
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">{{ title }}</p>
      </header>
      <section class="modal-card-body">
        <div class="media">
          <div class="media-left" v-if="icon">
            <b-icon :icon="icon" :type="type" size="is-large" />
          </div>
          <div class="media-content">
            <slot />
          </div>
        </div>
      </section>
      <footer class="modal-card-foot">
        <div class="buttons is-right is-flex-grow-1">
          <b-button :label="cancelLabel" @click="close" />
          <b-button :label="confirmLabel" :type="type" @click="confirm" />
        </div>
      </footer>
    </div>
  </b-modal>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    confirmLabel: { type: String, default: "Confirm" },
    cancelLabel: { type: String, default: "Cancel" },
    // Colours the confirm button and the icon.
    type: { type: String, default: "is-primary" },
    icon: String,
  },
  emits: ["update:modelValue", "confirm"],
  methods: {
    close() {
      this.$emit("update:modelValue", false);
    },
    confirm() {
      this.close();
      this.$emit("confirm");
    },
  },
});
</script>
