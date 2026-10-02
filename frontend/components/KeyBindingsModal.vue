<template>
  <b-modal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    has-modal-card
    trap-focus
    ariaRole="dialog"
    ariaModal
    ariaLabel="Keyboard shortcuts"
  >
    <div class="modal-card key-bindings-modal">
      <header class="modal-card-head">
        <p class="modal-card-title">Keyboard shortcuts</p>
        <button type="button" class="delete" aria-label="Close" @click="close" />
      </header>
      <section class="modal-card-body">
        <p class="mb-4">
          These keys work in the Timing tab. Click a key, then press the one to use instead. On
          non-latin layouts, letter shortcuts work from their corresponding latin layout key.
        </p>
        <section v-for="group in GROUPS" :key="group.title" class="binding-group">
          <h3 class="title is-6">{{ group.title }}</h3>
          <div v-for="row in group.rows" :key="row.action" class="binding-row">
            <key-capture-input
              :label="row.label"
              :key-label="label(row.action)"
              @bind="(binding: KeyBinding) => settingsStore.setTimingKey(row.action, binding)"
            />
            <p v-if="note(row)" class="binding-note">{{ note(row) }}</p>
          </div>
        </section>
      </section>
      <footer class="modal-card-foot">
        <div class="buttons is-flex-grow-1 is-justify-content-space-between">
          <b-button
            label="Reset all to defaults"
            :disabled="isDefault"
            @click="settingsStore.resetTimingKeys()"
          />
          <b-button label="Close" type="is-primary" @click="close" />
        </div>
      </footer>
    </div>
  </b-modal>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import KeyCaptureInput from "@/components/KeyCaptureInput.vue";
import { useSettingsStore } from "@/stores/settings";
import {
  DEFAULT_TIMING_KEYS,
  KeyBinding,
  TIMING_ACTIONS,
  TapAction,
  TimingAction,
  bindingLabel,
  isTapAction,
  sameBinding,
} from "@/lib/timingKeys";

interface BindingRow {
  action: TimingAction;
  label: string;
}

const GROUPS: Array<{ title: string; rows: BindingRow[] }> = [
  {
    title: "Tap mode",
    rows: [
      { action: "start", label: "Start a syllable" },
      { action: "end", label: "End a syllable" },
      { action: "redo", label: "Go back a line" },
    ],
  },
  {
    title: "Every mode",
    rows: [
      { action: "playPause", label: "Play or pause" },
      { action: "replay", label: "Replay from the picked spot" },
      { action: "seekBack", label: "Step back" },
      { action: "seekForward", label: "Step forward" },
      { action: "seekBackFar", label: "Step back five times as far" },
      { action: "seekForwardFar", label: "Step forward five times as far" },
      { action: "zoomIn", label: "Zoom in" },
      { action: "zoomOut", label: "Zoom out" },
      { action: "viewStart", label: "Go to the start of the view" },
      { action: "viewEnd", label: "Go to the end of the view" },
      { action: "songStart", label: "Go to the start of the song" },
      { action: "songEnd", label: "Go to the end of the song" },
      { action: "switchMode", label: "Switch between Tap and Adjust" },
      { action: "nextReview", label: "Next syllable to review" },
      { action: "previousReview", label: "Previous syllable to review" },
      { action: "markChecked", label: "Mark as checked" },
    ],
  },
];

const TAP_EFFECTS: Record<TapAction, string> = {
  start: "starts a syllable",
  end: "ends a syllable",
  redo: "goes back a line",
};

export default defineComponent({
  components: { KeyCaptureInput },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup() {
    return { settingsStore: useSettingsStore(), GROUPS };
  },
  computed: {
    isDefault(): boolean {
      const keys = this.settingsStore.timingKeys;
      return TIMING_ACTIONS.every(
        (action) =>
          sameBinding(keys[action], DEFAULT_TIMING_KEYS[action]) &&
          keys[action].code === DEFAULT_TIMING_KEYS[action].code,
      );
    },
  },
  methods: {
    close() {
      this.$emit("update:modelValue", false);
    },
    label(action: TimingAction): string {
      return bindingLabel(this.settingsStore.timingKeys[action]);
    },
    /**
     * What the row's key does instead in Tap mode, when a tap key shares it.
     */
    note(row: BindingRow): string {
      const keys = this.settingsStore.timingKeys;
      const tap = isTapAction(row.action)
        ? undefined
        : TIMING_ACTIONS.filter(isTapAction).find((action) =>
            sameBinding(keys[row.action], keys[action]),
          );
      return tap ? `In Tap mode, ${this.label(row.action)} ${TAP_EFFECTS[tap]} instead.` : "";
    },
  },
});
</script>

<style scoped>
.binding-group + .binding-group {
  margin-top: 1.5rem;
}

.binding-group .title {
  margin-bottom: 0.75rem;
}

.binding-row + .binding-row {
  margin-top: 0.5rem;
}

.binding-note {
  font-size: var(--bulma-size-small);
  color: var(--bulma-text-weak);
}
</style>
