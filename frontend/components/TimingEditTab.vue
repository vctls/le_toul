<template>
  <b-tab-item icon="pen-to-square" label="Edit" :disabled="!isEnabled" class="timing-edit-tab">
    <div class="title-row">
      <h2 class="title">Edit Timings</h2>
      <voice-selector />
    </div>
    <div class="content">
      <p>
        Each <code>&lt;MM:SS.cc&gt;</code> tag marks when the following syllable starts; a
        bare tag with nothing after it marks a release before a pause. Edit the numbers to
        fine-tune timing, or copy a block of tags from one place and paste it elsewhere to
        reuse the exact same timing.
      </p>
      <p>
        Press <b>Apply</b> to use your edits, or <b>Reload</b> to discard them and show the
        current timings again.
      </p>
    </div>
    <b-field>
      <b-input v-model="draft" type="textarea" custom-class="timing-editor-textarea" :rows="16" />
    </b-field>
    <p v-if="error" class="has-text-danger">{{ error }}</p>
    <div class="buttons">
      <b-button type="is-primary" @click="apply" :disabled="!hasChanges">Apply</b-button>
      <b-button @click="reload" :disabled="!hasChanges">Reload</b-button>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { BButton, BField, BInput } from "buefy";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useTimingsStore } from "@/stores/timings";
import { useLyricsStore } from "@/stores/lyrics";
import { serializeTimings, parseTimings } from "@/lib/timingFormat";
import { validateTimings } from "@/lib/timingValidation";
import { VoiceId } from "@/lib/voices";

export default defineComponent({
  components: { BButton, BField, BInput, VoiceSelector },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    return { timingsStore, lyricsStore };
  },
  data() {
    return {
      draft: "",
      error: "",
    };
  },
  computed: {
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    // The readable projection of the active voice's stored timings. Recomputes whenever
    // the timings, lyrics, or active voice change; the watcher below reloads the draft,
    // so switching voices shows that voice's timings.
    current(): string {
      return serializeTimings(this.lyricsStore.lyricTextForVoice(this.activeVoice), this.timingsStore.rawTimings);
    },
    hasChanges(): boolean {
      return this.draft !== this.current;
    },
  },
  watch: {
    // Load (and reload) the editable buffer whenever the underlying timings change.
    current: {
      immediate: true,
      handler(value: string) {
        this.draft = value;
      },
    },
  },
  methods: {
    apply() {
      try {
        const parsed = parseTimings(this.draft);
        const validation = validateTimings(parsed);
        if (!validation.valid) {
          this.error = validation.message ?? "These timings are not valid.";
          return;
        }
        this.timingsStore.resetTimings(parsed);
        this.error = "";
        // resetTimings updates `current`, whose watcher re-normalizes `draft`.
      } catch (e) {
        this.error = "Could not apply timings: " + (e as Error).message;
      }
    },
    reload() {
      this.draft = this.current;
      this.error = "";
    },
  },
});
</script>

<style scoped>
.timing-edit-tab {
  display: flex;
  flex-direction: column;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.timing-edit-tab :deep(.timing-editor-textarea) {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  white-space: pre;
  line-height: 1.6;
}
</style>
