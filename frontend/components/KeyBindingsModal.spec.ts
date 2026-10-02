import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Buefy from "buefy";
import KeyBindingsModal from "@/components/KeyBindingsModal.vue";
import KeyCaptureInput from "@/components/KeyCaptureInput.vue";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_TIMING_KEYS, TIMING_ACTIONS } from "@/lib/timingKeys";

function mountModal() {
  return mount(KeyBindingsModal, {
    props: { modelValue: true },
    global: {
      plugins: [Buefy],
      stubs: { "b-modal": { template: "<div><slot /></div>" } },
    },
  });
}

function picker(wrapper: ReturnType<typeof mountModal>, label: string) {
  const found = wrapper
    .findAllComponents(KeyCaptureInput)
    .find((input) => input.props("label") === label);
  if (!found) throw new Error(`No picker labelled ${label}`);
  return found;
}

function resetButton(wrapper: ReturnType<typeof mountModal>) {
  const found = wrapper.findAll("button").find((b) => b.text() === "Reset all to defaults");
  if (!found) throw new Error("No reset button");
  return found;
}

describe("KeyBindingsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("has a picker for every action", () => {
    const wrapper = mountModal();
    expect(wrapper.findAllComponents(KeyCaptureInput)).toHaveLength(TIMING_ACTIONS.length);
    expect(picker(wrapper, "Step back").props("keyLabel")).toBe("←");
  });

  it("binds the picked key, swapping with the action that held it", async () => {
    const wrapper = mountModal();

    picker(wrapper, "Switch between Tap and Adjust").vm.$emit("bind", { key: "n", code: "KeyN" });
    await wrapper.vm.$nextTick();

    expect(useSettingsStore().timingKeys).toMatchObject({
      switchMode: { key: "n" },
      nextReview: { key: "t" },
    });
    expect(picker(wrapper, "Next syllable to review").props("keyLabel")).toBe("T");
  });

  it("says what a key does instead in Tap mode", async () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("In Tap mode, Space starts a syllable instead.");

    useSettingsStore().setTimingKey("playPause", { key: "p", code: "KeyP" });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("In Tap mode, P");
  });

  it("resets every key to its default", async () => {
    const wrapper = mountModal();
    expect(resetButton(wrapper).attributes("disabled")).toBeDefined();

    useSettingsStore().setTimingKey("zoomIn", { key: "a", code: "KeyQ" });
    await wrapper.vm.$nextTick();
    await resetButton(wrapper).trigger("click");

    expect(useSettingsStore().timingKeys).toEqual(DEFAULT_TIMING_KEYS);
    expect(resetButton(wrapper).attributes("disabled")).toBeDefined();
  });
});
