import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TapQueue from "@/components/TapQueue.vue";

const items = [
  { index: 4, text: "ka", isHead: true, joinsNext: true, endsLine: false, timing: "full" as const },
  {
    index: 5,
    text: "den",
    isHead: false,
    joinsNext: false,
    endsLine: true,
    timing: "full" as const,
  },
  {
    index: 6,
    text: "lu",
    isHead: false,
    joinsNext: false,
    endsLine: false,
    timing: "start" as const,
  },
  {
    index: 7,
    text: "so",
    isHead: false,
    joinsNext: false,
    endsLine: false,
    timing: "none" as const,
  },
];

describe("TapQueue", () => {
  it("picks the segment clicked", async () => {
    const wrapper = mount(TapQueue, { props: { items } });
    await wrapper.findAll(".queue-item")[2].trigger("click");
    expect(wrapper.emitted("pick")).toEqual([[6]]);
  });

  it("picks nothing on a line break", async () => {
    const wrapper = mount(TapQueue, { props: { items } });
    await wrapper.find(".queue-break").trigger("click");
    expect(wrapper.emitted("pick")).toBeUndefined();
  });

  it("marks the head and the syllables of one word", () => {
    const wrapper = mount(TapQueue, { props: { items } });
    const [first, second] = wrapper.findAll(".queue-item");
    expect(first.classes()).toEqual(expect.arrayContaining(["is-head", "joins-next"]));
    expect(second.classes()).toContain("joins-previous");
  });

  it("tints a timed segment, and checkers one timed by its start alone", () => {
    const wrapper = mount(TapQueue, { props: { items } });
    const [, den, lu, so] = wrapper.findAll(".queue-item");
    expect(den.classes()).toContain("is-timed");
    expect(lu.classes()).toContain("is-start-timed");
    expect(so.classes()).not.toContain("is-timed");
    expect(so.classes()).not.toContain("is-start-timed");
  });
});
