import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Buefy from "buefy";
import KeyCaptureInput from "@/components/KeyCaptureInput.vue";

function mountInput(keyLabel = "Space") {
  return mount(KeyCaptureInput, {
    props: { label: "Start key", keyLabel },
    global: { plugins: [Buefy] },
    attachTo: document.body,
  });
}

async function listen(wrapper: ReturnType<typeof mountInput>) {
  await wrapper.find("button").trigger("click");
  return wrapper.find("button");
}

describe("KeyCaptureInput", () => {
  it("shows the bound key's label", () => {
    const wrapper = mountInput("A");
    expect(wrapper.find("button").text()).toBe("A");
  });

  it("asks for a key once clicked", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    expect(button.text()).toBe("Press a key");
  });

  it("binds the pressed key by its position, labelled by what it types", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    // On AZERTY, the key where QWERTY has Q types A.
    await button.trigger("keydown", { code: "KeyQ", key: "a" });

    expect(wrapper.emitted("bind")).toEqual([["KeyQ", "A"]]);
    expect(button.text()).toBe("Space");
  });

  it("binds a key named the same on every layout without a label", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "Enter", key: "Enter" });

    expect(wrapper.emitted("bind")).toEqual([["Enter", undefined]]);
  });

  it("keeps the press from reaching the window's timing handler", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);
    let reachedWindow = false;
    const onWindowKeyDown = () => (reachedWindow = true);
    window.addEventListener("keydown", onWindowKeyDown);

    await button.trigger("keydown", { code: "KeyQ", key: "a" });

    window.removeEventListener("keydown", onWindowKeyDown);
    expect(reachedWindow).toBe(false);
  });

  it("gives up focus once bound, so the next timing tap doesn't press the button", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);
    (button.element as HTMLButtonElement).focus();

    await button.trigger("keydown", { code: "KeyQ", key: "a" });

    expect(document.activeElement).not.toBe(button.element);
  });

  it("cancels on Esc without binding", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "Escape", key: "Escape" });

    expect(wrapper.emitted("bind")).toBeUndefined();
    expect(button.text()).toBe("Space");
  });

  it("waits through a modifier held to type the key", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "ShiftLeft", key: "Shift" });

    expect(wrapper.emitted("bind")).toBeUndefined();
    expect(button.text()).toBe("Press a key");
  });

  it("rejects a key that can't be bound, and keeps listening", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "ContextMenu", key: "ContextMenu" });

    expect(wrapper.emitted("bind")).toBeUndefined();
    expect(wrapper.find(".help").text()).toContain("Context Menu can't be used");
    expect(button.text()).toBe("Press a key");
  });

  it("ignores key presses until clicked", async () => {
    const wrapper = mountInput();

    await wrapper.find("button").trigger("keydown", { code: "KeyQ", key: "a" });

    expect(wrapper.emitted("bind")).toBeUndefined();
  });

  it("stops listening when it loses focus", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("blur");

    expect(button.text()).toBe("Space");
  });
});
