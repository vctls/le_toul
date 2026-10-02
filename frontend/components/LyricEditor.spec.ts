import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import LyricEditor from "@/components/LyricEditor.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { LYRIC_MARKERS } from "@/constants";

const { SEGMENT_START } = LYRIC_MARKERS;

let wrapper: VueWrapper | null = null;

// The editor as the Lyrics tab binds it, so a history step reaches the textarea.
const Host = defineComponent({
  setup() {
    const lyrics = useLyricsStore();
    return () =>
      h(LyricEditor, {
        ref: "editor",
        modelValue: lyrics.lyricText,
        "onUpdate:modelValue": (value: string) => lyrics.setLyrics(value),
      });
  },
});

function mountEditor(lyrics: string) {
  useLyricsStore().setLyrics(lyrics);
  wrapper = mount(Host, { attachTo: document.body });
  const editor = wrapper.findComponent(LyricEditor);
  return { editor, textarea: wrapper.find("textarea").element };
}

function timeWords(...starts: number[]) {
  const timings = useTimingsStore();
  starts.forEach((start, index) => timings.add(index, SEGMENT_START, start));
}

/**
 * Edits the textarea as the browser would: `beforeinput`, the change, then `input`.
 */
function edit(
  textarea: HTMLTextAreaElement,
  inputType: string,
  [start, end]: [number, number],
  inserted = "",
) {
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new InputEvent("beforeinput", { inputType, data: inserted }));
  const deleteStart = inputType === "deleteContentBackward" && start === end ? start - 1 : start;
  const value = textarea.value;
  textarea.value = value.slice(0, deleteStart) + inserted + value.slice(end);
  const cursor = deleteStart + inserted.length;
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new InputEvent("input", { inputType, data: inserted || null }));
}

function type(textarea: HTMLTextAreaElement, text: string) {
  for (const char of text) {
    const at = textarea.selectionStart;
    edit(textarea, "insertText", [at, at], char);
  }
}

function pressUndo(textarea: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  textarea.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("LyricEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("undoes a typed word as one step", async () => {
    const { textarea } = mountEditor("one");
    textarea.setSelectionRange(3, 3);

    type(textarea, "_two_three");
    expect(useLyricsStore().lyricText).toBe("one_two_three");

    pressUndo(textarea);
    await nextTick();
    expect(textarea.value).toBe("one_two_");
    pressUndo(textarea);
    await nextTick();
    expect(textarea.value).toBe("one_");
  });

  it("starts a new step after a pause", () => {
    vi.useFakeTimers();
    try {
      const { textarea } = mountEditor("");
      type(textarea, "on");
      vi.advanceTimersByTime(1500);
      type(textarea, "e");

      useHistoryStore().undo();
      expect(useLyricsStore().lyricText).toBe("on");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a paste its own step, and restores the selection on undo", async () => {
    const { textarea } = mountEditor("one_two_three");

    edit(textarea, "insertFromPaste", [4, 7], "pasted");
    expect(useHistoryStore().nextUndo).toMatchObject({ label: "Paste" });

    // The browser renders between the paste and the key press.
    await nextTick();
    pressUndo(textarea);
    await nextTick();
    await nextTick();
    expect(textarea.value).toBe("one_two_three");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 7]);
  });

  it("reports the timings a paste removes", () => {
    const { textarea } = mountEditor("one_two_three");
    timeWords(1, 2, 3);

    edit(textarea, "insertFromPaste", [4, 7], "and_a_half");

    expect(useHistoryStore().lastLoss).toMatchObject({ lost: 1 });
  });

  it("sends the browser's own undo to the history", async () => {
    const { textarea } = mountEditor("one");
    edit(textarea, "insertFromPaste", [3, 3], "_two");

    const event = new InputEvent("beforeinput", { inputType: "historyUndo", cancelable: true });
    textarea.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(useLyricsStore().lyricText).toBe("one");
  });

  it("redoes with Ctrl+Shift+Z", async () => {
    const { textarea } = mountEditor("one");
    edit(textarea, "insertFromPaste", [3, 3], "_two");
    pressUndo(textarea);

    expect(pressUndo(textarea, { shiftKey: true })).toBe(true);
    await nextTick();

    expect(useLyricsStore().lyricText).toBe("one_two");
  });

  it("undoes magic slashes before the slash that was typed", async () => {
    const { textarea } = mountEditor("hello_hello");
    textarea.setSelectionRange(3, 3);

    type(textarea, "/");
    expect(useLyricsStore().lyricText).toBe("hel/lo_hel/lo");

    useHistoryStore().undo();
    expect(useLyricsStore().lyricText).toBe("hel/lo_hello");
    useHistoryStore().undo();
    expect(useLyricsStore().lyricText).toBe("hello_hello");
  });

  it("undoes Add Underscores in one step", () => {
    const { editor } = mountEditor("one two three");

    editor.vm.convertSpaces();
    expect(useLyricsStore().lyricText).toBe("one_two_three");

    useHistoryStore().undo();
    expect(useLyricsStore().lyricText).toBe("one two three");
  });
});
