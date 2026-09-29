import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TapButtons from "@/components/TapButtons.vue";

const props = { startLabel: "Space", endLabel: "Enter", redoLabel: "Backspace" };

describe("TapButtons", () => {
  it("taps as soon as a button is pressed, not when it is let go", async () => {
    const wrapper = mount(TapButtons, { props });
    const [end, redo, playPause, start] = wrapper.findAll("button");
    await start.trigger("pointerdown");
    await end.trigger("pointerdown");
    await redo.trigger("pointerdown");
    await playPause.trigger("pointerdown");
    expect(Object.keys(wrapper.emitted())).toEqual(
      expect.arrayContaining(["start", "end", "redo", "play-pause"]),
    );

    await start.trigger("click", { detail: 1 });
    expect(wrapper.emitted("start")).toHaveLength(1);
  });

  it("acts on a click from a keyboard or assistive technology", async () => {
    const wrapper = mount(TapButtons, { props });
    await wrapper.findAll("button")[3].trigger("click", { detail: 0 });
    expect(wrapper.emitted("start")).toHaveLength(1);
  });

  it("shows the keys only when asked", async () => {
    const wrapper = mount(TapButtons, { props });
    expect(wrapper.find("kbd").exists()).toBe(false);
    await wrapper.setProps({ showKeys: true });
    expect(wrapper.findAll("kbd").map((kbd) => kbd.text())).toEqual([
      "Enter",
      "Backspace",
      "Space",
    ]);
  });

  it("offers to pause while playing, and to play while paused", async () => {
    const wrapper = mount(TapButtons, { props });
    expect(wrapper.findAll("button")[2].attributes("aria-label")).toBe("Play");
    await wrapper.setProps({ playing: true });
    expect(wrapper.findAll("button")[2].attributes("aria-label")).toBe("Pause");
  });
});
