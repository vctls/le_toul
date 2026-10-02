<template>
  <textarea
    class="textarea is-flex-grow-1 lyric-editor-textarea"
    :value="modelValue"
    @beforeinput="onBeforeInput"
    @input="onLyricInput"
    @keydown="onKeyDown"
    @blur="onBlur"
    ref="lyricInput"
    aria-label="Lyrics"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    autocomplete="off"
  ></textarea>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useHistoryStore } from "@/stores/history";
import { EntryMeta, historyStepFor } from "@/lib/history";

import {
  getCurrentWord,
  slashifiedPosition,
  slashifyAllOccurences,
  convertSpacesToUnderscores,
} from "@/lib/lyrics";

type Selection = [number, number];
type LastStep = ReturnType<typeof useHistoryStore>["lastStep"];

// Typing of these kinds joins the edits before it as one undo step.
const TYPING_INPUT_TYPES = new Set([
  "insertText",
  "insertLineBreak",
  "insertCompositionText",
  "deleteContentBackward",
  "deleteContentForward",
]);
// A pause this long in milliseconds starts a new undo step.
const TYPING_PAUSE = 1000;
// Typing one of these ends the undo step, so a word is undone at a time.
const SEPARATOR = /[\s_/]/;

const EDIT_LABELS: Record<string, string> = {
  insertFromPaste: "Paste",
  insertFromDrop: "Drop",
  deleteByCut: "Cut",
  deleteByDrag: "Drag",
};

export default defineComponent({
  emits: ["update:modelValue"],
  props: {
    modelValue: { type: String, default: "" },
    magicSlashes: {
      type: Boolean,
      default: true,
    },
  },
  setup() {
    return { history: useHistoryStore() };
  },
  data() {
    return {
      scrollTop: 0,
      visibilityObserver: null as IntersectionObserver | null,
      // The selection when the edit being made started, read before the browser changes it.
      selectionBefore: null as Selection | null,
      // Where the last typing left the cursor, to tell whether the next edit continues it.
      typing: null as { cursor: number; at: number; ended: boolean } | null,
      // A selection an undo restored while the tab was hidden.
      pendingSelection: null as Selection | null,
    };
  },
  watch: {
    "history.lastStep"(last: LastStep) {
      const selection = last?.entry.selection;
      if (!last || !selection) return;
      this.typing = null;
      const [start, end] = last.step === "undo" ? selection.before : selection.after;
      // The textarea's value only changes once Vue renders.
      this.$nextTick(() => {
        const input = this.textarea();
        // A hidden tab's textarea has no offset parent.
        if (input.offsetParent !== null) {
          input.focus();
          input.setSelectionRange(start, end);
        } else {
          this.pendingSelection = [start, end];
        }
      });
    },
  },
  mounted() {
    const input = this.textarea();
    input.addEventListener("scroll", this.rememberScroll);
    if (typeof IntersectionObserver === "undefined") return;
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        input.scrollTop = this.scrollTop;
        if (this.pendingSelection) {
          input.setSelectionRange(...this.pendingSelection);
          this.pendingSelection = null;
        }
      }
    });
    this.visibilityObserver.observe(input);
  },
  beforeUnmount() {
    this.textarea().removeEventListener("scroll", this.rememberScroll);
    this.visibilityObserver?.disconnect();
  },
  methods: {
    textarea(): HTMLTextAreaElement {
      return this.$refs.lyricInput as HTMLTextAreaElement;
    },
    selection(): Selection {
      const input = this.textarea();
      return [input.selectionStart, input.selectionEnd];
    },
    rememberScroll() {
      const input = this.textarea();
      // Hiding the tab zeroes scrollTop. Ignore that so the saved offset survives.
      if (input.clientHeight > 0) {
        this.scrollTop = input.scrollTop;
      }
    },
    /**
     * Sends the browser's own undo, from its Edit menu, context menu or shake to undo, to the
     * history.
     */
    onBeforeInput(e: InputEvent) {
      if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
        e.preventDefault();
        this.history[e.inputType === "historyUndo" ? "undo" : "redo"]();
        return;
      }
      this.selectionBefore = this.selection();
    },
    onKeyDown(e: KeyboardEvent) {
      const step = historyStepFor(e);
      if (!step) return;
      e.preventDefault();
      this.history[step]();
    },
    onBlur() {
      this.history.closeGroup();
      this.typing = null;
    },
    onLyricInput(e: Event) {
      // TODO: Also update on slash removal
      // TODO: update on pasted text and bulk-removed text
      const input = e.target as HTMLTextAreaElement;
      const value = input.value;
      const after = this.selection();
      const before = this.selectionBefore ?? after;
      this.selectionBefore = null;
      const inputType = e instanceof InputEvent ? e.inputType : "";
      const isComposing = e instanceof InputEvent && e.isComposing;
      const meta: EntryMeta = { label: "Typing", tab: "lyrics", selection: { before, after } };
      const write = () => this.$emit("update:modelValue", value);

      if (isComposing || (TYPING_INPUT_TYPES.has(inputType) && before[0] === before[1])) {
        const now = Date.now();
        const last = this.typing;
        const continues =
          isComposing ||
          (last !== null &&
            !last.ended &&
            last.cursor === before[0] &&
            now - last.at < TYPING_PAUSE);
        this.history.recordTyping(meta, write, continues);
        const typed = inputType === "insertLineBreak" ? "\n" : ((e as InputEvent).data ?? "");
        this.typing = { cursor: after[0], at: now, ended: SEPARATOR.test(typed) };
      } else {
        this.typing = null;
        // A paste or a cut can take a whole block of timed lyrics with it, unlike typing.
        this.history.record({ ...meta, label: EDIT_LABELS[inputType] ?? "Typing" }, write, {
          warnLoss: true,
        });
      }

      if (this.magicSlashes && this.isSlashEntry(e)) {
        const cursor = after[0];
        const word = getCurrentWord(value, cursor);
        const newValue = slashifyAllOccurences(value, word.replaceAll("/", ""), word);
        const newCursor = slashifiedPosition(value, newValue, cursor);
        this.replace(newValue, "Magic slashes", [newCursor, newCursor]);
      }
    },
    isSlashEntry(e: Event) {
      // Return true if event is a user typing a slash
      return e instanceof InputEvent && e.inputType == "insertText" && e.data == "/";
    },
    convertSpaces() {
      const selection = this.selection();
      this.replace(convertSpacesToUnderscores(this.textarea().value), "Add underscores", selection);
    },
    /**
     * Replaces the whole text as one undo step, and leaves `selection` selected.
     */
    replace(newValue: string, label: string, selection: Selection) {
      const input = this.textarea();
      if (newValue === input.value) return;
      const meta: EntryMeta = {
        label,
        tab: "lyrics",
        selection: { before: this.selection(), after: selection },
      };
      this.typing = null;
      this.history.record(meta, () => {
        const scrollTop = input.scrollTop;
        input.value = newValue;
        input.setSelectionRange(...selection);
        input.scrollTop = scrollTop;
        this.$emit("update:modelValue", newValue);
      });
    },
  },
});
</script>

<style scoped>
/* The element selector outweighs Bulma's own `.textarea:not([rows])` cap of 40em. */
textarea.lyric-editor-textarea {
  font-family: var(--bulma-family-primary);
  max-height: none;
}
</style>
