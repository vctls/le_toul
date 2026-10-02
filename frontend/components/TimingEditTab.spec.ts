import { describe, it, expect, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TimingEditTab from "@/components/TimingEditTab.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { useAdvancedStore } from "@/stores/advanced";
import { LYRIC_MARKERS } from "@/constants";
import { DISPLAY_PERIOD_WIDENED } from "@/lib/importWarnings";

const { SEGMENT_START, SEGMENT_END } = LYRIC_MARKERS;

const rows = (...values: string[]) => values.join("\n") + "\n";

function mountTab(lyrics = "hel/lo_world") {
  useLyricsStore().setLyrics(lyrics);
  useTimingsStore().resetTimings([
    [0.5, SEGMENT_START],
    [1, SEGMENT_START],
    [1.5, SEGMENT_START],
    [2, SEGMENT_END],
  ]);
  return shallowMount(TimingEditTab);
}

describe("TimingEditTab", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("shows the active voice's section of timings.txt", () => {
    const wrapper = mountTab();
    expect(wrapper.vm.draft).toBe(
      rows(
        "page",
        "",
        "-",
        '"hel"    00:00.50',
        '"lo "    00:01.00',
        '"world"  00:01.50  00:02.00',
        "-",
      ),
    );
  });

  it("applies edited times", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace("00:01.00", "00:01.20");
    wrapper.vm.apply();

    expect(wrapper.vm.error).toBe("");
    expect(useTimingsStore().activeSegments.map(({ start }) => start)).toEqual([0.5, 1.2, 1.5]);
    expect(wrapper.vm.draft).toBe(wrapper.vm.current);
  });

  it("keeps the review flags of the segments it leaves unchanged", () => {
    const wrapper = mountTab();
    const timings = useTimingsStore();
    timings.resetSegments([
      { text: "hel/", start: 0.5001, review: "moved" },
      { text: "lo_", start: 1, review: "moved" },
      { text: "world", start: 1.5, end: 2, review: "lost" },
    ]);
    wrapper.vm.draft = wrapper.vm.current.replace("00:01.00", "00:01.20");
    wrapper.vm.apply();

    expect(timings.activeSegments.map(({ review }) => review)).toEqual([
      "moved",
      undefined,
      "lost",
    ]);
  });

  it("names the row of an error, and keeps the timings", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace("00:01.00", "00:00.20");
    wrapper.vm.apply();

    expect(wrapper.vm.error).toBe(
      "Could not apply timings: Row 5: Timecodes must not go backwards: 00:00.50 is followed by 00:00.20.",
    );
    expect(useTimingsStore().activeSegments[1].start).toBe(1);
  });

  it("numbers the rows, and marks the row of an error", async () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace("00:01.00", "00:00.20");
    wrapper.vm.apply();
    await wrapper.vm.$nextTick();

    const numbers = wrapper.findAll(".gutter-rows > div");
    expect(numbers.map((n) => n.text())).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(wrapper.findAll(".gutter .is-error").map((n) => n.text())).toEqual(["5"]);
  });

  it("rejects the rows of a whole timings file", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = 'voice "Voice 1"\n' + wrapper.vm.draft;
    wrapper.vm.apply();

    expect(wrapper.vm.error).toContain("Row 1: This row belongs to the whole timings file");
  });

  it("lists what the parser changed", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace(/^-$/m, "00:01.00");
    wrapper.vm.apply();

    expect(wrapper.vm.warnings).toEqual([DISPLAY_PERIOD_WIDENED]);
    expect(useTimingsStore().activeSegments[0].displayStart).toBe(0.5);
  });

  it("writes changed words back to the lyrics of a single voice", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace('"world"', '"there"');
    wrapper.vm.apply();

    expect(wrapper.vm.error).toBe("");
    expect(useLyricsStore().lyricText).toBe("hel/lo_there");
  });

  it("leaves the words alone when the song has several voices", () => {
    const wrapper = mountTab("[Anna]\nhel/lo_world\n[Ben]\nother_words");
    wrapper.vm.draft = wrapper.vm.draft.replace('"world"', '"there"');
    wrapper.vm.apply();

    expect(wrapper.vm.error).toContain("Edit the words and blank lines in the Lyrics tab.");
    expect(useLyricsStore().lyricText).toContain("hel/lo_world");
  });

  it("writes a new spacer back to the lyrics, keeping the timings", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace("page\n\n", "page\n\n-\n-\n\n");
    wrapper.vm.apply();

    expect(wrapper.vm.error).toBe("");
    expect(useLyricsStore().lyricText).toBe("/\nhel/lo_world");
    expect(useTimingsStore().activeSegments[0]).toEqual({
      text: "hel/",
      start: 0.5,
      spacersBefore: 1,
    });
  });

  it("refuses a new spacer when the song has several voices", () => {
    const wrapper = mountTab("[Anna]\nhel/lo_world\n[Ben]\nother_words");
    wrapper.vm.draft = wrapper.vm.draft.replace("page\n\n", "page\n\n-\n-\n\n");
    wrapper.vm.apply();

    expect(wrapper.vm.error).toContain("blank lines");
    expect(useTimingsStore().activeSegments[0].spacersBefore).toBeUndefined();
  });

  it("is only visible in advanced mode", async () => {
    const wrapper = mountTab();
    expect(wrapper.attributes("visible")).toBe("false");

    useAdvancedStore().isAdvanced = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes("visible")).toBe("true");
  });
});
