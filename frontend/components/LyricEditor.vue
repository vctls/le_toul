<template>
  <div ref="host" class="textarea is-flex-grow-1 code-editor lyric-editor"></div>
</template>

<script lang="ts">
import { defineComponent, shallowRef } from "vue";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate, keymap } from "@codemirror/view";
import { defaultKeymap, insertNewline } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { useHistoryStore } from "@/stores/history";
import { EntryMeta, historyStepFor } from "@/lib/history";
import { lyricMarkup } from "@/lib/lyricMarkup";
import {
  findAndReplace,
  isShown,
  minimalChange,
  programmatic,
  restoreScrollWhenShown,
} from "@/lib/codeEditor";

import {
  getCurrentWord,
  slashifiedPosition,
  slashifyAllOccurences,
  convertSpacesToUnderscores,
} from "@/lib/lyrics";

type Selection = [number, number];
type LastStep = ReturnType<typeof useHistoryStore>["lastStep"];

/**
 * Whether an edit is typing, which joins the edits before it as one undo step.
 */
function isTypingEvent(userEvent: string): boolean {
  return (
    userEvent === "input" ||
    userEvent.startsWith("input.type") ||
    userEvent === "delete.backward" ||
    userEvent === "delete.forward"
  );
}

// A pause this long in milliseconds starts a new undo step.
const TYPING_PAUSE = 1000;
// Typing one of these ends the undo step, so a word is undone at a time.
const SEPARATOR = /[\s_/]/;

const EDIT_LABELS: Record<string, string> = {
  "input.paste": "Paste",
  "input.drop": "Drop",
  "delete.cut": "Cut",
  "move.drop": "Drag",
  "input.replace": "Replace",
  "input.replace.all": "Replace all",
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
    return { history: useHistoryStore(), view: shallowRef<EditorView | null>(null) };
  },
  data() {
    return {
      stopRestoringScroll: null as (() => void) | null,
      // Where the last typing left the cursor, to tell whether the next edit continues it.
      typing: null as { cursor: number; at: number; ended: boolean } | null,
      // Whether an undo moved the selection while the tab was hidden, so it must be scrolled to.
      pendingReveal: false,
    };
  },
  watch: {
    modelValue(value: string) {
      const view = this.editor();
      const current = view.state.doc.toString();
      if (value === current) return;
      view.dispatch({
        changes: minimalChange(current, value),
        annotations: programmatic.of(true),
      });
    },
    "history.lastStep"(last: LastStep) {
      const selection = last?.entry.selection;
      if (!last || !selection) return;
      this.typing = null;
      const [anchor, head] = last.step === "undo" ? selection.before : selection.after;
      // The editor's text only changes once Vue renders.
      this.$nextTick(() => {
        const view = this.editor();
        const shown = isShown(view);
        view.dispatch({ selection: { anchor, head }, scrollIntoView: shown });
        if (shown) {
          view.focus();
        } else {
          this.pendingReveal = true;
        }
      });
    },
  },
  mounted() {
    const view = new EditorView({
      parent: this.$refs.host as HTMLElement,
      state: EditorState.create({
        doc: this.modelValue,
        extensions: [
          Prec.highest(
            EditorView.domEventHandlers({
              beforeinput: (e) => this.onBeforeInput(e),
              keydown: (e) => this.onKeyDown(e),
              blur: () => this.onBlur(),
            }),
          ),
          findAndReplace(),
          // Enter only breaks the line, without copying the indentation.
          keymap.of([{ key: "Enter", run: insertNewline }, ...defaultKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Lyrics",
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
          EditorView.updateListener.of((update) => this.onUpdate(update)),
          lyricMarkup,
        ],
      }),
    });
    this.view = view;
    this.stopRestoringScroll = restoreScrollWhenShown(view, () => {
      if (!this.pendingReveal) return false;
      this.pendingReveal = false;
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main) });
      return true;
    });
  },
  beforeUnmount() {
    this.stopRestoringScroll?.();
    this.view?.destroy();
  },
  methods: {
    editor(): EditorView {
      return this.view!;
    },
    selection(): Selection {
      const { from, to } = this.editor().state.selection.main;
      return [from, to];
    },
    /**
     * Sends the browser's own undo, from its Edit menu, context menu or shake to undo, to the
     * history.
     */
    onBeforeInput(e: InputEvent): boolean {
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return false;
      e.preventDefault();
      this.history[e.inputType === "historyUndo" ? "undo" : "redo"]();
      return true;
    },
    onKeyDown(e: KeyboardEvent): boolean {
      const step = historyStepFor(e);
      if (!step) return false;
      e.preventDefault();
      this.history[step]();
      return true;
    },
    onBlur(): boolean {
      this.history.closeGroup();
      this.typing = null;
      return false;
    },
    onUpdate(update: ViewUpdate) {
      const transaction = update.transactions.find((tr) => tr.docChanged);
      if (!transaction || transaction.annotation(programmatic)) return;
      const value = update.state.doc.toString();
      const { from, to } = update.startState.selection.main;
      const before: Selection = [from, to];
      const after = this.selection();
      const userEvent = transaction.annotation(Transaction.userEvent) ?? "";
      const meta: EntryMeta = { label: "Typing", tab: "lyrics", selection: { before, after } };
      const write = () => this.$emit("update:modelValue", value);
      let typed = "";
      transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        typed += inserted.toString();
      });

      const isComposing = userEvent.startsWith("input.type.compose");
      if (isComposing || (isTypingEvent(userEvent) && before[0] === before[1])) {
        const now = Date.now();
        const last = this.typing;
        const continues =
          isComposing ||
          (last !== null &&
            !last.ended &&
            last.cursor === before[0] &&
            now - last.at < TYPING_PAUSE);
        this.history.recordTyping(meta, write, continues);
        this.typing = { cursor: after[0], at: now, ended: SEPARATOR.test(typed) };
      } else {
        this.typing = null;
        // A paste or a replacement can take a whole block of timed lyrics with it, unlike typing.
        this.history.record({ ...meta, label: EDIT_LABELS[userEvent] ?? "Typing" }, write, {
          warnLoss: true,
        });
      }

      if (this.magicSlashes && userEvent === "input.type" && typed === "/") {
        const cursor = after[0];
        const word = getCurrentWord(value, cursor);
        const newValue = slashifyAllOccurences(value, word.replaceAll("/", ""), word);
        const newCursor = slashifiedPosition(value, newValue, cursor);
        this.replace(newValue, "Magic slashes", [newCursor, newCursor]);
      }
    },
    convertSpaces() {
      const text = this.editor().state.doc.toString();
      this.replace(convertSpacesToUnderscores(text), "Add underscores", this.selection());
    },
    openSearch() {
      openSearchPanel(this.editor());
    },
    /**
     * Replaces the whole text as one undo step, and leaves `selection` selected.
     */
    replace(newValue: string, label: string, [anchor, head]: Selection) {
      const view = this.editor();
      const current = view.state.doc.toString();
      if (newValue === current) return;
      const meta: EntryMeta = {
        label,
        tab: "lyrics",
        selection: { before: this.selection(), after: [anchor, head] },
      };
      this.typing = null;
      this.history.record(meta, () => {
        view.dispatch({
          changes: minimalChange(current, newValue),
          selection: { anchor, head },
          annotations: programmatic.of(true),
        });
        this.$emit("update:modelValue", newValue);
      });
    },
  },
});
</script>

<style scoped>
.lyric-editor {
  font-family: var(--bulma-family-primary);
  line-height: 1.5;
}

.lyric-editor :deep(.cm-markup-separator) {
  color: var(--bulma-text-weak);
}

.lyric-editor :deep(.cm-markup-voice-tag) {
  color: var(--bulma-link-text);
  font-weight: var(--bulma-weight-semibold);
}

/* A rule through the middle of each blank line shows where one screen ends. */
.lyric-editor :deep(.cm-markup-screen-break) {
  background: linear-gradient(var(--bulma-border-weak), var(--bulma-border-weak)) center / 100% 1px
    no-repeat;
}
</style>
