<template>
  <b-tab-item
    value="edit"
    icon="pen-to-square"
    label="Edit"
    :disabled="!isEnabled"
    :visible="advancedStore.isAdvanced"
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
        at the end of a syllable ends its word, and <code>page</code> starts a new page. A time row
        followed directly by another one is a blank line that keeps its place on the page.
      </p>
      <p>
        The time rows around a line hold when it appears and disappears, and <code>-</code> leaves
        that to the app. A time that cuts into the line's syllables is moved back to them on Apply,
        and the Submit tab's <b>Use Line Display Times</b> turns them off in the video.
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
    <div class="editor">
      <div class="gutter" aria-hidden="true">
        <div class="gutter-rows" :style="{ transform: `translateY(${-scrollTop}px)` }">
          <div v-for="row in rowCount" :key="row" :class="{ 'is-error': row === errorRow }">
            {{ row }}
          </div>
        </div>
      </div>
      <textarea
        ref="textarea"
        v-model="draft"
        class="textarea timing-editor-textarea"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        autocomplete="off"
        @scroll="scrollTop = ($event.target as HTMLTextAreaElement).scrollTop"
      />
    </div>
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
import { defineComponent, markRaw } from "vue";
import { BButton, BMessage } from "buefy";
import HelpSection from "@/components/HelpSection.vue";
import VoiceSelector from "@/components/VoiceSelector.vue";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { useAdvancedStore } from "@/stores/advanced";
import { useLyricsStore } from "@/stores/lyrics";
import {
  TimingsTextError,
  keepReviewFlags,
  parseVoiceTimingsText,
  writeVoiceTimingsText,
} from "@/lib/timingsText";
import { joinLyrics } from "@/lib/timing";
import { VoiceId } from "@/lib/voices";

export default defineComponent({
  components: { BButton, BMessage, HelpSection, VoiceSelector },
  setup() {
    const timingsStore = useTimingsStore();
    const lyricsStore = useLyricsStore();
    return {
      timingsStore,
      lyricsStore,
      advancedStore: useAdvancedStore(),
      historyStore: useHistoryStore(),
    };
  },
  data() {
    return {
      draft: "",
      error: "",
      errorRow: undefined as number | undefined,
      warnings: [] as string[],
      scrollTop: 0,
      resizeObserver: markRaw({ observer: null as ResizeObserver | null }),
    };
  },
  mounted() {
    // Hiding the tab resets the textarea's scroll without a scroll event, which would leave the gutter behind.
    // Showing it again resizes it, so the resize restores the gutter's position.
    const textarea = this.$refs.textarea as HTMLTextAreaElement;
    this.resizeObserver.observer = new ResizeObserver(() => {
      if (textarea.clientHeight > 0) {
        textarea.scrollTop = this.scrollTop;
        this.scrollTop = textarea.scrollTop;
      }
    });
    this.resizeObserver.observer.observe(textarea);
  },
  beforeUnmount() {
    this.resizeObserver.observer?.disconnect();
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
    rowCount(): number {
      return this.draft.split("\n").length;
    },
  },
  watch: {
    activeVoice() {
      this.error = "";
      this.errorRow = undefined;
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
        const edited = joinLyrics(parsed);
        // A spacer lives in the lyrics like a word, so changing one changes the lyrics too.
        const lyricsChanged =
          edited !== joinLyrics(this.lyricsStore.segmentsForVoice(this.activeVoice));
        // Only a voice that owns the whole lyric blob can have words written back to it.
        // Putting an edit back through the `[tag]` lines of a multi-voice blob is not implemented.
        if (lyricsChanged && this.lyricsStore.voices.length > 1) {
          this.error =
            "This tab can only change timings while the song has more than one voice. Edit the words and blank lines in the Lyrics tab.";
          return;
        }

        this.historyStore.record({ label: "Edit", tab: "edit" }, () => {
          this.timingsStore.resetSegments(
            keepReviewFlags(this.timingsStore.activeSegments, parsed),
          );
          if (lyricsChanged) {
            this.lyricsStore.setLyrics(edited);
          }
        });
        // A rewrite that only drops comments leaves `current` as it was, so its watcher won't fire.
        this.draft = this.current;
        this.error = "";
        this.errorRow = undefined;
        this.warnings = warnings;
      } catch (e) {
        this.error = "Could not apply timings: " + (e as Error).message;
        this.errorRow = e instanceof TimingsTextError ? e.row : undefined;
      }
    },
    reload() {
      this.draft = this.current;
      this.error = "";
      this.errorRow = undefined;
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

.editor {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-bottom: 0.75rem;
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

/* The gutter's font, line height and top padding match the textarea's, so each number sits on
   its row. The textarea doesn't wrap, so a row is always one line tall. */
.gutter,
.timing-editor-textarea {
  font-family: var(--bulma-family-code), monospace;
  font-size: var(--bulma-size-normal);
  line-height: 1.6;
}

.gutter {
  overflow: hidden;
  padding: var(--bulma-control-padding-horizontal) 0.5em;
  border: var(--bulma-control-border-width) solid var(--bulma-border);
  border-right: none;
  border-radius: var(--bulma-radius) 0 0 var(--bulma-radius);
  background-color: var(--bulma-background);
  color: var(--bulma-text-weak);
  text-align: right;
  user-select: none;
}

.gutter .is-error {
  color: var(--bulma-danger);
  font-weight: bold;
}

/* The editor class outranks Bulma's `.textarea:not([rows])` height limits. */
.editor .timing-editor-textarea {
  white-space: pre;
  flex: 1;
  min-width: 0;
  /* Bulma gives every control a fixed height, which blocks the flex stretch. */
  height: 100%;
  min-height: 0;
  max-height: none;
  resize: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
