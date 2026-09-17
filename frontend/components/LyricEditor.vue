<template>
  <textarea
    class="textarea is-flex-grow-1 lyric-editor-textarea"
    :value="modelValue"
    @input="onLyricInput"
    ref="lyricInput"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    autocomplete="off"
  ></textarea>
</template>

<script lang="ts">
import { defineComponent } from "vue";

// import { getCurrentWord } from "@/lib/lyrics";

import { getCurrentWord, slashifyAllOccurences, convertSpacesToUnderscores } from "@/lib/lyrics";

export default defineComponent({
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
      // Hiding the tab zeroes scrollTop; ignore that so the saved offset survives.
      if (input.clientHeight > 0) {
        this.scrollTop = input.scrollTop;
      }
    },
    onLyricInput(e: Event) {
      // TODO: Also update on slash removal
      // TODO: update on pasted text and bulk-removed text
      const target = e.target as HTMLTextAreaElement;
      this.$emit("update:modelValue", target.value);
      if (this.magicSlashes && this.isSlashEntry(e)) {
        const input = target;
        const currentPosition = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        const currentText = input.value;
        const currentWord = getCurrentWord(currentText, currentPosition);
        const newValue = slashifyAllOccurences(
          this.modelValue,
          currentWord.replaceAll("/", ""),
          currentWord,
        );
        this.$emit("update:modelValue", newValue);
        // Normally the cursor goes to the end of the text when we update the value,
        // so we set it back to where it was
        this.$nextTick(() => {
          input.setSelectionRange(currentPosition, selectionEnd);
        });
      }
    },
    isSlashEntry(e: Event) {
      // Return true if event is a user typing a slash
      return e instanceof InputEvent && e.inputType == "insertText" && e.data == "/";
    },
    convertSpaces() {
      // Convert spaces to underscores
      const input = this.textarea();
      const currentPosition = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      const newValue = convertSpacesToUnderscores(this.modelValue);
      this.$emit("update:modelValue", newValue);
      this.$nextTick(() => {
        input.setSelectionRange(currentPosition, selectionEnd);
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
