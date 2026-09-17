import { describe, it, expect } from "vitest";
import {
  KEY_NAMES,
  DEFAULT_TIMING_KEYS,
  isKeyName,
  normalizeKeyName,
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
  });
});

describe("normalizeKeyName", () => {
  it("is case- and space-insensitive", () => {
    expect(normalizeKeyName("  space ")).toBe("Space");
    expect(normalizeKeyName("keya")).toBe("KeyA");
    expect(normalizeKeyName("ARROWUP")).toBe("ArrowUp");
  });

  it("returns undefined for a name no key has", () => {
    expect(normalizeKeyName("Spacebar")).toBeUndefined();
    expect(normalizeKeyName("")).toBeUndefined();
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
