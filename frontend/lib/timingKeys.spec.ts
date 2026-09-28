import { describe, it, expect } from "vitest";
import {
  KEY_NAMES,
  DEFAULT_TIMING_KEYS,
  isKeyName,
  keyLabel,
  keyLabelFromEvent,
  eventMatchesKey,
  formatKeyName,
} from "./timingKeys";

describe("isKeyName", () => {
  it("accepts KeyboardEvent.code names", () => {
    expect(isKeyName("Space")).toBe(true);
    expect(isKeyName("KeyQ")).toBe(true);
    expect(isKeyName("Numpad7")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isKeyName("Spacebar")).toBe(false);
    expect(isKeyName("space")).toBe(false);
    expect(isKeyName("")).toBe(false);
    expect(isKeyName(32)).toBe(false);
    expect(isKeyName(undefined)).toBe(false);
  });

  it("rejects bare modifiers", () => {
    expect(isKeyName("ShiftLeft")).toBe(false);
    expect(isKeyName("ControlLeft")).toBe(false);
  });

  it("covers the defaults", () => {
    expect(isKeyName(DEFAULT_TIMING_KEYS.start)).toBe(true);
    expect(isKeyName(DEFAULT_TIMING_KEYS.end)).toBe(true);
    expect(isKeyName(DEFAULT_TIMING_KEYS.redo)).toBe(true);
  });
});

describe("keyLabelFromEvent", () => {
  it("names a letter or punctuation key by what it types on an AZERTY layout", () => {
    expect(keyLabelFromEvent({ code: "KeyQ", key: "a" })).toBe("A");
    expect(keyLabelFromEvent({ code: "Semicolon", key: "m" })).toBe("M");
    expect(keyLabelFromEvent({ code: "Quote", key: "ù" })).toBe("Ù");
    expect(keyLabelFromEvent({ code: "Digit1", key: "&" })).toBe("&");
  });

  it("gives no label to a dead key", () => {
    expect(keyLabelFromEvent({ code: "BracketLeft", key: "Dead" })).toBeUndefined();
  });

  it("gives no label to a key named the same on every layout", () => {
    expect(keyLabelFromEvent({ code: "Space", key: " " })).toBeUndefined();
    expect(keyLabelFromEvent({ code: "Numpad7", key: "7" })).toBeUndefined();
    expect(keyLabelFromEvent({ code: "Enter", key: "Enter" })).toBeUndefined();
  });
});

describe("keyLabel", () => {
  it("prefers the recorded label", () => {
    expect(keyLabel("KeyQ", { KeyQ: "A" })).toBe("A");
  });

  it("falls back to the readable code name", () => {
    expect(keyLabel("KeyQ", { KeyW: "Z" })).toBe("Q");
    expect(keyLabel("ArrowUp", {})).toBe("Arrow Up");
  });
});

describe("eventMatchesKey", () => {
  it("matches the bound key", () => {
    expect(eventMatchesKey("KeyA", "KeyA")).toBe(true);
    expect(eventMatchesKey("KeyA", "KeyB")).toBe(false);
  });

  it("treats the numpad Enter as Enter", () => {
    expect(eventMatchesKey("NumpadEnter", "Enter")).toBe(true);
    expect(eventMatchesKey("Enter", "NumpadEnter")).toBe(true);
  });

  it("does not conflate unrelated numpad keys", () => {
    expect(eventMatchesKey("Numpad0", "Digit0")).toBe(false);
  });
});

describe("formatKeyName", () => {
  it("drops the Key and Digit prefixes", () => {
    expect(formatKeyName("KeyA")).toBe("A");
    expect(formatKeyName("Digit4")).toBe("4");
  });

  it("splits the rest into words", () => {
    expect(formatKeyName("ArrowUp")).toBe("Arrow Up");
    expect(formatKeyName("Numpad0")).toBe("Numpad 0");
    expect(formatKeyName("NumpadEnter")).toBe("Numpad Enter");
  });

  it("leaves single words and function keys alone", () => {
    expect(formatKeyName("Space")).toBe("Space");
    expect(formatKeyName("Enter")).toBe("Enter");
    expect(formatKeyName("F12")).toBe("F12");
  });
});

describe("KEY_NAMES", () => {
  it("has no duplicates", () => {
    expect(new Set(KEY_NAMES).size).toBe(KEY_NAMES.length);
  });
});
