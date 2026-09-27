import { describe, it, expect, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TimingEditTab from "@/components/TimingEditTab.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { LYRIC_MARKERS } from "@/constants";
import { DISPLAY_PERIOD_WIDENED } from "@/lib/timingsText";

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

  it("names the row of an error, and keeps the timings", () => {
    const wrapper = mountTab();
    wrapper.vm.draft = wrapper.vm.draft.replace("00:01.00", "00:00.20");
    wrapper.vm.apply();

    expect(wrapper.vm.error).toBe(
      "Could not apply timings: Row 5: Timecodes must not go backwards: 00:00.50 is followed by 00:00.20.",
    );
    expect(useTimingsStore().activeSegments[1].start).toBe(1);
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

    expect(wrapper.vm.error).toContain("Edit the words in the Lyrics tab.");
    expect(useLyricsStore().lyricText).toContain("hel/lo_world");
  });
});
