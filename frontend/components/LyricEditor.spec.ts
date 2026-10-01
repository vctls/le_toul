import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Buefy from "buefy";
import LyricEditor from "@/components/LyricEditor.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { LYRIC_MARKERS } from "@/constants";

const { SEGMENT_START } = LYRIC_MARKERS;

let wrapper: VueWrapper<InstanceType<typeof LyricEditor>> | null = null;

function mountEditor(lyrics: string) {
  useLyricsStore().setLyrics(lyrics);
  wrapper = mount(LyricEditor, {
    props: {
      modelValue: lyrics,
      "onUpdate:modelValue": (value: string) => wrapper?.setProps({ modelValue: value }),
    },
    global: { plugins: [Buefy] },
    attachTo: document.body,
  });
  return wrapper;
}

function timeWords(...starts: number[]) {
  const timings = useTimingsStore();
  starts.forEach((start, index) => timings.add(index, SEGMENT_START, start));
}

/**
 * Pastes `text` over the selection, as the browser would unless the paste is cancelled.
 */
function paste(textarea: HTMLTextAreaElement, text: string, start: number, end = start) {
  textarea.setSelectionRange(start, end);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  textarea.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("LyricEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    // happy-dom has no editing commands, so the editor falls back to setting the value.
    document.execCommand = vi.fn(() => false);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("lets a paste through when the lyrics have no timings", () => {
    const textarea = mountEditor("one_two_three").find("textarea").element;

    expect(paste(textarea, "four_five", 0, 13)).toBe(false);
  });

  it("lets a paste through when it keeps every timing", () => {
    const textarea = mountEditor("one_two_three").find("textarea").element;
    timeWords(1, 2, 3);

    expect(paste(textarea, "too", 4, 7)).toBe(false);
  });

  it("asks before a paste that removes timings, and cancelling keeps the lyrics", async () => {
    const editor = mountEditor("one_two_three");
    const textarea = editor.find("textarea").element;
    timeWords(1, 2, 3);

    expect(paste(textarea, "and_a_half", 4, 7)).toBe(true);
    await editor.vm.$nextTick();
    expect(document.body.textContent).toContain("This paste removes 1 timing.");

    const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    cancel!.click();
    await editor.vm.$nextTick();

    expect(textarea.value).toBe("one_two_three");
    expect(editor.emitted("update:modelValue")).toBeUndefined();
  });

  it("pastes once confirmed", async () => {
    const editor = mountEditor("one_two_three");
    const textarea = editor.find("textarea").element;
    timeWords(1, 2, 3);

    paste(textarea, "and_a_half", 4, 7);
    await editor.vm.$nextTick();
    const confirm = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Paste anyway",
    );
    confirm!.click();
    await editor.vm.$nextTick();

    expect(textarea.value).toBe("one_and_a_half_three");
    expect(textarea.selectionStart).toBe(14);
    expect(editor.emitted("update:modelValue")!.at(-1)).toEqual(["one_and_a_half_three"]);
  });

  it("counts against the lyrics with Windows line breaks normalized", async () => {
    const editor = mountEditor("one\ntwo");
    const textarea = editor.find("textarea").element;
    timeWords(1, 2);

    expect(paste(textarea, "one\r\ntwo", 0, 7)).toBe(false);
  });
});
