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

  it("binds the pressed key by what it types, and where it sits", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    // On AZERTY, the key where QWERTY has Q types A.
    await button.trigger("keydown", { code: "KeyQ", key: "a" });

    expect(wrapper.emitted("bind")).toEqual([[{ key: "a", code: "KeyQ" }]]);
    expect(button.text()).toBe("Space");
  });

  it("binds Shift with the key it was held with", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "KeyN", key: "N", shiftKey: true });

    expect(wrapper.emitted("bind")).toEqual([[{ key: "n", code: "KeyN", shift: true }]]);
  });

  it("binds a key that types nothing by its name alone", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "Enter", key: "Enter" });

    expect(wrapper.emitted("bind")).toEqual([[{ key: "Enter" }]]);
  });

  it("rejects the undo shortcut, which would always win", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "KeyZ", key: "z", ctrlKey: true });

    expect(wrapper.emitted("bind")).toBeUndefined();
    expect(wrapper.find(".help").text()).toContain("Ctrl+Z can't be used");
  });

  it("rejects a dead key", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);

    await button.trigger("keydown", { code: "BracketLeft", key: "Dead" });

    expect(wrapper.emitted("bind")).toBeUndefined();
    expect(wrapper.find(".help").text()).toContain("An accent key can't be used");
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

  it("keeps the Escape that cancels from also closing a dialog", async () => {
    const wrapper = mountInput();
    const button = await listen(wrapper);
    let closed = false;
    const onKeyUp = () => (closed = true);
    document.addEventListener("keyup", onKeyUp);

    await button.trigger("keydown", { code: "Escape", key: "Escape" });
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));

    expect(closed).toBe(false);
    document.removeEventListener("keyup", onKeyUp);
  });
});
