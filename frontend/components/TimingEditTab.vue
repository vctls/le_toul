<template>
  <b-tab-item
    value="edit"
    icon="pen-to-square"
    label="Edit"
    :disabled="!isEnabled"
    class="timing-edit-tab"
  >
    <div class="title-row">
      <h2 class="title">Edit Timings</h2>
      <voice-selector />
    </div>
    <help-section>
      <p>
        This is the active voice's part of <code>timings.txt</code>. Each line of lyrics sits
        between two time rows, and each row in between is a syllable: its text in quotes, when it
        starts, then when it ends. A syllable with no end lasts until the next one starts. A space
        at the end of a syllable ends its word, and <code>page</code> starts a new page.
      </p>
      <p v-if="advancedStore.isAdvanced">
        The time rows around a line hold when it appears and disappears, and <code>-</code> leaves
        that to the app. The video doesn't use them yet.
      </p>
      <p>
        Edit the times to fine-tune them, or copy times from one place and paste them elsewhere to
        reuse the exact same timing. Comments that start with <code>#</code> are dropped on Apply.
      </p>
      <p>
        Press <b>Apply</b> to use your edits, or <b>Reload</b> to discard them and show the current
        timings again.
      </p>
    </help-section>
    <b-field class="editor-field">
      <b-input
        :model-value="draft ?? ''"
        @update:model-value="
          (v: string | number | undefined) => {
            draft = v == null ? '' : String(v);
          }
        "
        type="textarea"
        custom-class="timing-editor-textarea"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        autocomplete="off"
      />
    </b-field>
    <p v-if="error" class="has-text-danger">{{ error }}</p>
    <b-message
      v-if="warnings.length"
      class="apply-warnings"
      type="is-warning"
      size="is-small"
      title="Some parts were changed on Apply"
      closable
      @close="warnings = []"
    >
      <ul>
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
    </b-message>
    <div class="buttons">
      <b-button type="is-primary" @click="apply" :disabled="!hasChanges">Apply</b-button>
      <b-button @click="reload" :disabled="!hasChanges">Reload</b-button>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { BButton, BField, BInput, BMessage } from "buefy";
import HelpSection from "@/components/HelpSection.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useTimingsStore } from "@/stores/timings";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import { parseVoiceTimingsText, writeVoiceTimingsText } from "@/lib/timingsText";
import { VoiceId } from "@/lib/voices";

/**
 * This is the lyric text a list of segments spells out.
 * It is used to compare an edit against the current lyrics.
 */
const join = (segments: { text: string }[]) => segments.map((segment) => segment.text).join("");

export default defineComponent({
  components: { BButton, BField, BInput, BMessage, HelpSection, VoiceSelector },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    return { timingsStore, lyricsStore, advancedStore: useAdvancedStore() };
  },
  data() {
    return {
      draft: "",
      error: "",
      warnings: [] as string[],
    };
  },
  computed: {
    activeVoice(): VoiceId {
      return this.timingsStore.activeVoice;
    },
    isEnabled(): boolean {
      return this.timingsStore.length > 0;
    },
    current(): string {
      return writeVoiceTimingsText(this.timingsStore.activeSegments);
    },
    hasChanges(): boolean {
      return this.draft !== this.current;
    },
  },
  watch: {
    activeVoice() {
      this.error = "";
      this.warnings = [];
    },
    current: {
      immediate: true,
      handler(value: string) {
        this.draft = value;
      },
    },
  },
  methods: {
    apply() {
      this.warnings = [];
      try {
        const { segments: parsed, warnings } = parseVoiceTimingsText(this.draft);
        const edited = join(parsed);
        const wordsChanged = edited !== join(this.lyricsStore.segmentsForVoice(this.activeVoice));
        // Only a voice that owns the whole lyric blob can have words written back to it.
        // Putting an edit back through the `[tag]` lines of a multi-voice blob is not implemented.
        if (wordsChanged && this.lyricsStore.voices.length > 1) {
          this.error =
            "This tab can only change timings while the song has more than one voice. Edit the words in the Lyrics tab.";
          return;
        }

        this.timingsStore.resetSegments(parsed);
        if (wordsChanged) {
          this.lyricsStore.setLyrics(edited);
        }
        // A rewrite that only drops comments leaves `current` as it was, so its watcher won't fire.
        this.draft = this.current;
        this.error = "";
        this.warnings = warnings;
      } catch (e) {
        this.error = "Could not apply timings: " + (e as Error).message;
      }
    },
    reload() {
      this.draft = this.current;
      this.error = "";
      this.warnings = [];
    },
  },
});
</script>

<style scoped>
.timing-edit-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.timing-edit-tab :deep(.editor-field),
.timing-edit-tab :deep(.editor-field .control) {
  display: flex;
  flex: 1;
  min-height: 0;
}

.title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: var(--bulma-block-spacing);
}

/* Bulma only spaces a title that is :not(:last-child), and the voice selector beside it
   is v-if'd away for single-voice songs. The row owns the spacing instead. */
.title-row .title {
  margin-bottom: 0;
}

.apply-warnings ul {
  list-style: disc;
  padding-left: 1.25em;
}

.timing-edit-tab :deep(.timing-editor-textarea) {
  font-family: var(--bulma-family-code), monospace;
  white-space: pre;
  line-height: 1.6;
  flex: 1;
  /* Bulma gives every control a fixed height, which blocks the flex stretch. */
  height: 100%;
  max-height: none;
}
</style>
