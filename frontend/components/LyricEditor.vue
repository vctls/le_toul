<template>
  <textarea
    class="textarea is-flex-grow-1 lyric-editor-textarea"
    :value="modelValue"
    @input="onLyricInput"
    @paste="onPaste"
    ref="lyricInput"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    autocomplete="off"
  ></textarea>
  <confirm-modal
    v-model="isConfirmingPaste"
    title="Paste over timed lyrics?"
    type="is-danger"
    icon="circle-exclamation"
    confirm-label="Paste anyway"
    @confirm="confirmPaste"
    @update:model-value="onPasteModalToggle"
  >
    <p>
      This paste removes {{ pendingPaste?.lost }} timing{{ pendingPaste?.lost === 1 ? "" : "s" }}.
    </p>
  </confirm-modal>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import ConfirmModal from "@/components/ConfirmModal.vue";
import { useTimingsStore } from "@/stores/timings";

import {
  getCurrentWord,
  slashifiedPosition,
  slashifyAllOccurences,
  convertSpacesToUnderscores,
} from "@/lib/lyrics";

type PendingPaste = { start: number; end: number; text: string; lost: number };

export default defineComponent({
  components: { ConfirmModal },
  emits: ["update:modelValue"],
  props: {
    modelValue: { type: String, default: "" },
    magicSlashes: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      scrollTop: 0,
      visibilityObserver: null as IntersectionObserver | null,
      replacing: false,
      isConfirmingPaste: false,
      pendingPaste: null as PendingPaste | null,
    };
  },
  mounted() {
    const input = this.textarea();
    input.addEventListener("scroll", this.rememberScroll);
    if (typeof IntersectionObserver === "undefined") return;
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        input.scrollTop = this.scrollTop;
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
    rememberScroll() {
      const input = this.textarea();
      // Hiding the tab zeroes scrollTop. Ignore that so the saved offset survives.
      if (input.clientHeight > 0) {
        this.scrollTop = input.scrollTop;
      }
    },
    onLyricInput(e: Event) {
      // TODO: Also update on slash removal
      // TODO: update on pasted text and bulk-removed text
      const input = e.target as HTMLTextAreaElement;
      if (this.magicSlashes && !this.replacing && this.isSlashEntry(e)) {
        const text = input.value;
        const cursor = input.selectionStart;
        const word = getCurrentWord(text, cursor);
        const newValue = slashifyAllOccurences(text, word.replaceAll("/", ""), word);
        this.replaceUndoably(input, newValue);
        const newCursor = slashifiedPosition(text, newValue, cursor);
        input.setSelectionRange(newCursor, newCursor);
      }
      this.$emit("update:modelValue", input.value);
    },
    /**
     * Holds back a paste that would remove timings until the user confirms it.
     */
    onPaste(e: ClipboardEvent) {
      const pasted = e.clipboardData?.getData("text/plain");
      if (!pasted) return;
      const input = this.textarea();
      const { selectionStart: start, selectionEnd: end, value } = input;
      // The textarea normalizes line breaks as it inserts, so the count must too.
      const text = pasted.replace(/\r\n?/g, "\n");
      const lost = useTimingsStore().timingsLostBy(value.slice(0, start) + text + value.slice(end));
      if (lost === 0) return;
      e.preventDefault();
      this.pendingPaste = { start, end, text, lost };
      this.isConfirmingPaste = true;
    },
    confirmPaste() {
      const paste = this.pendingPaste;
      if (!paste) return;
      const input = this.textarea();
      const { value } = input;
      this.replaceUndoably(
        input,
        value.slice(0, paste.start) + paste.text + value.slice(paste.end),
      );
      const cursor = paste.start + paste.text.length;
      input.setSelectionRange(cursor, cursor);
      this.$emit("update:modelValue", input.value);
    },
    onPasteModalToggle(open: boolean) {
      if (open) return;
      // The modal took the focus, and the user was typing here.
      this.$nextTick(() => this.textarea().focus());
    },
    isSlashEntry(e: Event) {
      // Return true if event is a user typing a slash
      return e instanceof InputEvent && e.inputType == "insertText" && e.data == "/";
    },
    convertSpaces() {
      const input = this.textarea();
      const { selectionStart, selectionEnd } = input;
      this.replaceUndoably(input, convertSpacesToUnderscores(input.value));
      input.setSelectionRange(selectionStart, selectionEnd);
      this.$emit("update:modelValue", input.value);
    },
    /**
     * Replaces the textarea's text through the editing API so that native undo reverts it.
     * Only the span that differs is replaced, so the undo step stays small.
     */
    replaceUndoably(input: HTMLTextAreaElement, newValue: string) {
      const oldValue = input.value;
      let start = 0;
      while (start < oldValue.length && oldValue[start] == newValue[start]) start++;
      if (start == oldValue.length && start == newValue.length) return;
      let oldEnd = oldValue.length;
      let newEnd = newValue.length;
      while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] == newValue[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const scrollTop = input.scrollTop;
      // execCommand acts on the focused element, and a toolbar button click takes the focus.
      input.focus();
      input.setSelectionRange(start, oldEnd);
      // insertText fires a synchronous input event, which must not slashify again.
      this.replacing = true;
      const inserted = document.execCommand("insertText", false, newValue.slice(start, newEnd));
      this.replacing = false;
      if (!inserted) {
        input.value = newValue;
      }
      input.scrollTop = scrollTop;
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
