import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { EditorView } from "@codemirror/view";
import { SearchQuery, replaceAll, setSearchQuery } from "@codemirror/search";
import LyricEditor from "@/components/LyricEditor.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { LYRIC_MARKERS } from "@/constants";

const { SEGMENT_START } = LYRIC_MARKERS;

let wrapper: VueWrapper | null = null;

// The editor as the Lyrics tab binds it, so a history step reaches the editor.
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
  const view = EditorView.findFromDOM(wrapper.find(".cm-editor").element as HTMLElement)!;
  return { editor, view };
}

function timeWords(...starts: number[]) {
  const timings = useTimingsStore();
  starts.forEach((start, index) => timings.add(index, SEGMENT_START, start));
}

function text(view: EditorView): string {
  return view.state.doc.toString();
}

function selection(view: EditorView): [number, number] {
  const { from, to } = view.state.selection.main;
  return [from, to];
}

/**
 * Edits the text as CodeMirror does for user input: the selection, then the change, labeled
 * with its user event.
 */
function edit(view: EditorView, userEvent: string, [start, end]: [number, number], inserted = "") {
  view.dispatch({ selection: { anchor: start, head: end } });
  const from = userEvent === "delete.backward" && start === end ? start - 1 : start;
  view.dispatch({
    changes: { from, to: end, insert: inserted },
    selection: { anchor: from + inserted.length },
    userEvent,
  });
}

function type(view: EditorView, text: string) {
  for (const char of text) {
    const at = view.state.selection.main.head;
    edit(view, "input.type", [at, at], char);
  }
}

function pressUndo(view: EditorView, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  view.contentDOM.dispatchEvent(event);
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

  it("toggles the search panel, and reports each change", () => {
    const { editor, view } = mountEditor("Hello world");
    const toggle = () => (editor.vm as unknown as { toggleSearch(): void }).toggleSearch();

    toggle();
    expect(view.dom.querySelector(".cm-search")).not.toBeNull();
    toggle();
    expect(view.dom.querySelector(".cm-search")).toBeNull();
    expect(editor.emitted("search-toggle")).toEqual([[true], [false]]);
  });

  it("undoes a typed word as one step", async () => {
    const { view } = mountEditor("one");
    view.dispatch({ selection: { anchor: 3 } });

    type(view, "_two_three");
    expect(useLyricsStore().lyricText).toBe("one_two_three");

    pressUndo(view);
    await nextTick();
    expect(text(view)).toBe("one_two_");
    pressUndo(view);
    await nextTick();
    expect(text(view)).toBe("one_");
  });

  it("starts a new step after a pause", () => {
    vi.useFakeTimers();
    try {
      const { view } = mountEditor("");
      type(view, "on");
      vi.advanceTimersByTime(1500);
      type(view, "e");

      useHistoryStore().undo();
      expect(useLyricsStore().lyricText).toBe("on");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a paste its own step, and restores the selection on undo", async () => {
    const { view } = mountEditor("one_two_three");

    edit(view, "input.paste", [4, 7], "pasted");
    expect(useHistoryStore().nextUndo).toMatchObject({ label: "Paste" });

    // The browser renders between the paste and the key press.
    await nextTick();
    pressUndo(view);
    await nextTick();
    await nextTick();
    expect(text(view)).toBe("one_two_three");
    expect(selection(view)).toEqual([4, 7]);
  });

  it("reports the timings a paste removes", () => {
    const { view } = mountEditor("one_two_three");
    timeWords(1, 2, 3);

    edit(view, "input.paste", [4, 7], "and_a_half");

    expect(useHistoryStore().lastLoss).toMatchObject({ lost: 0, moved: 1 });
  });

  it("sends the browser's own undo to the history", async () => {
    const { view } = mountEditor("one");
    edit(view, "input.paste", [3, 3], "_two");

    const event = new InputEvent("beforeinput", { inputType: "historyUndo", cancelable: true });
    view.contentDOM.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(useLyricsStore().lyricText).toBe("one");
  });

  it("redoes with Ctrl+Shift+Z", async () => {
    const { view } = mountEditor("one");
    edit(view, "input.paste", [3, 3], "_two");
    pressUndo(view);

    expect(pressUndo(view, { shiftKey: true })).toBe(true);
    await nextTick();

    expect(useLyricsStore().lyricText).toBe("one_two");
  });

  it("undoes magic slashes before the slash that was typed", async () => {
    const { view } = mountEditor("hello_hello");
    view.dispatch({ selection: { anchor: 3 } });

    type(view, "/");
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

  it("undoes a replace-all in one step, and reports the timings it moves", async () => {
    const { view } = mountEditor("one_two_one_two");
    timeWords(1, 2, 3, 4);

    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "two", replace: "and_a_half" })),
    });
    replaceAll(view);
    expect(useLyricsStore().lyricText).toBe("one_and_a_half_one_and_a_half");
    expect(useHistoryStore().nextUndo).toMatchObject({ label: "Replace all" });
    expect(useHistoryStore().lastLoss).not.toBeNull();

    // The browser renders between the replacement and the undo.
    await nextTick();
    useHistoryStore().undo();
    await nextTick();
    expect(text(view)).toBe("one_two_one_two");
  });

  it("shows lyrics written elsewhere", async () => {
    const { view } = mountEditor("one");

    useLyricsStore().setLyrics("one_two");
    await nextTick();

    expect(text(view)).toBe("one_two");
    expect(useHistoryStore().nextUndo).toBeNull();
  });

  it("highlights the markup", () => {
    const { view } = mountEditor("[Ann]one_two/three\n\nfour");
    const content = view.contentDOM;

    expect(content.querySelector(".cm-markup-voice-tag")?.textContent).toBe("[Ann]");
    const separators = content.querySelectorAll(".cm-markup-separator");
    expect(Array.from(separators, (mark) => mark.textContent)).toEqual(["_", "/"]);
    expect(content.querySelectorAll(".cm-markup-screen-break")).toHaveLength(1);
  });
});
