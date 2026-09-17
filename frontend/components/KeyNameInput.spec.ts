import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Buefy from "buefy";
import KeyNameInput from "@/components/KeyNameInput.vue";

function mountInput(modelValue = "Space") {
  return mount(KeyNameInput, {
    props: { label: "Start key", modelValue },
    global: { plugins: [Buefy] },
  });
}

describe("KeyNameInput", () => {
  it("shows the bound key name", () => {
    const wrapper = mountInput("Enter");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Enter");
  });

  it("emits a typed key name", async () => {
    const wrapper = mountInput();
    await wrapper.find("input").setValue("KeyZ");

    expect(wrapper.emitted("update:modelValue")).toEqual([["KeyZ"]]);
  });

  it("normalizes the casing", async () => {
    const wrapper = mountInput();
    await wrapper.find("input").setValue("arrowup");

    expect(wrapper.emitted("update:modelValue")).toEqual([["ArrowUp"]]);
  });

  it("flags a name no key has without emitting", async () => {
    const wrapper = mountInput();
    await wrapper.find("input").setValue("Spacebar");

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find("input").classes()).toContain("is-danger");
    expect(wrapper.find(".help").text()).toContain("isn't a key name");
  });

  it("restores the bound key when the box loses focus", async () => {
    const wrapper = mountInput("Enter");
    await wrapper.find("input").setValue("nonsense");
    await wrapper.find("input").trigger("blur");

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Enter");
  });
});
