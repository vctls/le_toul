import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMING_KEYS,
  bindingFromEvent,
  bindingLabel,
  eventKey,
  findBinding,
  sameBinding,
  isKeyName,
  keyFromEvent,
  keyLabel,
} from "./timingKeys";

describe("isKeyName", () => {
  it("accepts lowercase characters and the names of keys that type none", () => {
    expect(isKeyName("q")).toBe(true);
    expect(isKeyName("é")).toBe(true);
    expect(isKeyName(",")).toBe(true);
    expect(isKeyName("Space")).toBe(true);
    expect(isKeyName("ArrowLeft")).toBe(true);
    expect(isKeyName("F12")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isKeyName("Q")).toBe(false);
    expect(isKeyName(" ")).toBe(false);
    expect(isKeyName("KeyQ")).toBe(false);
    expect(isKeyName("Shift")).toBe(false);
    expect(isKeyName("")).toBe(false);
    expect(isKeyName(32)).toBe(false);
    expect(isKeyName(undefined)).toBe(false);
  });

  it("covers the defaults", () => {
    expect(Object.values(DEFAULT_TIMING_KEYS).every(({ key }) => isKeyName(key))).toBe(true);
  });
});

describe("keyFromEvent", () => {
  it("binds a key by what it types, whatever the layout puts there", () => {
    // On AZERTY, the key where QWERTY has Q types A.
    expect(keyFromEvent({ key: "a" })).toBe("a");
    expect(keyFromEvent({ key: "ù" })).toBe("ù");
  });

  it("lowercases letters, so Shift and Caps Lock make no difference", () => {
    expect(keyFromEvent({ key: "T" })).toBe("t");
  });

  it("names the space bar and keys that type nothing", () => {
    expect(keyFromEvent({ key: " " })).toBe("Space");
    expect(keyFromEvent({ key: "Enter" })).toBe("Enter");
    expect(keyFromEvent({ key: "ArrowUp" })).toBe("ArrowUp");
  });

  it("refuses modifiers, dead keys and Escape", () => {
    expect(keyFromEvent({ key: "Shift" })).toBeUndefined();
    expect(keyFromEvent({ key: "Dead" })).toBeUndefined();
    expect(keyFromEvent({ key: "Escape" })).toBeUndefined();
  });
});

describe("findBinding", () => {
  const bindings = {
    play: { key: "Space" },
    mode: { key: "t", code: "KeyT" },
    back: { key: ",", code: "Comma" },
    rus: { key: "ф", code: "KeyA" },
  };
  const actions = ["play", "mode", "back", "rus"] as const;
  const press = (key: string, code: string, shiftKey = false) =>
    findBinding({ key, code, shiftKey }, bindings, actions);

  it("finds the action by what the key types", () => {
    expect(press(" ", "Space")).toBe("play");
    expect(press("T", "KeyT", true)).toBe("mode");
    // Bépo types T where QWERTY has J.
    expect(press("t", "KeyJ")).toBe("mode");
  });

  it("keeps a Latin layout to letters, so another letter in the place does nothing", () => {
    // Bépo types è where QWERTY has T.
    expect(press("è", "KeyT")).toBeUndefined();
  });

  it("leaves a character Shift types to its own binding", () => {
    expect(press("<", "Comma", true)).toBeUndefined();
  });

  it("prefers a binding with Shift while Shift is held", () => {
    const review = { next: { key: "n" }, previous: { key: "n", shift: true } };
    const actions = ["next", "previous"] as const;
    expect(findBinding({ key: "N", code: "KeyN", shiftKey: true }, review, actions)).toBe(
      "previous",
    );
    expect(findBinding({ key: "n", code: "KeyN", shiftKey: false }, review, actions)).toBe("next");
  });

  it("answers Shift with a binding without it, and never answers a Shift binding without it", () => {
    const only = { far: { key: "ArrowLeft", shift: true }, mode: { key: "t" } };
    const actions = ["far", "mode"] as const;
    expect(findBinding({ key: "T", code: "KeyT", shiftKey: true }, only, actions)).toBe("mode");
    expect(
      findBinding({ key: "ArrowLeft", code: "ArrowLeft", shiftKey: false }, only, actions),
    ).toBeUndefined();
  });

  it("goes by the key's place between a Latin and a non-Latin layout", () => {
    // A Russian layout types е where QWERTY has T.
    expect(press("е", "KeyT")).toBe("mode");
    expect(press("a", "KeyA")).toBe("rus");
  });

  it("lets what the key types win over another binding's place", () => {
    const shared = { a: { key: "<", code: "IntlBackslash" }, b: { key: ",", code: "Comma" } };
    expect(findBinding({ key: "<", code: "Comma", shiftKey: true }, shared, ["b", "a"])).toBe("a");
  });
});

describe("bindingFromEvent with Ctrl", () => {
  it("records Ctrl", () => {
    expect(bindingFromEvent({ key: "Home", code: "Home", shiftKey: false, ctrlKey: true })).toEqual(
      { key: "Home", ctrl: true },
    );
  });

  it("doesn't take AltGr for Ctrl", () => {
    const altGraph = (state: string) => state === "AltGraph";
    expect(
      bindingFromEvent({
        key: "€",
        code: "KeyE",
        shiftKey: false,
        ctrlKey: true,
        getModifierState: altGraph,
      }),
    ).toEqual({ key: "€", code: "KeyE" });
  });
});

describe("findBinding with Ctrl", () => {
  const bindings = { check: { key: "c", code: "KeyC" }, song: { key: "Home", ctrl: true } };
  const actions = ["check", "song"] as const;
  const press = (key: string, code: string, ctrlKey: boolean) =>
    findBinding({ key, code, shiftKey: false, ctrlKey }, bindings, actions);

  it("leaves Ctrl with a key bound without it to the browser", () => {
    expect(press("c", "KeyC", true)).toBeUndefined();
    expect(press("c", "KeyC", false)).toBe("check");
  });

  it("answers a binding with Ctrl only while Ctrl is held", () => {
    expect(press("Home", "Home", true)).toBe("song");
    expect(press("Home", "Home", false)).toBeUndefined();
  });
});

describe("bindingFromEvent", () => {
  it("keeps where a character key sits", () => {
    expect(bindingFromEvent({ key: "a", code: "KeyQ", shiftKey: false })).toEqual({
      key: "a",
      code: "KeyQ",
    });
  });

  it("records Shift on a letter or a key that types nothing", () => {
    expect(bindingFromEvent({ key: "N", code: "KeyN", shiftKey: true })).toEqual({
      key: "n",
      code: "KeyN",
      shift: true,
    });
    expect(bindingFromEvent({ key: "ArrowLeft", code: "ArrowLeft", shiftKey: true })).toEqual({
      key: "ArrowLeft",
      shift: true,
    });
  });

  it("leaves Shift out when it already shows in the character", () => {
    expect(bindingFromEvent({ key: "<", code: "Comma", shiftKey: true })).toEqual({
      key: "<",
      code: "Comma",
    });
  });

  it("doesn't take Caps Lock for Shift", () => {
    expect(bindingFromEvent({ key: "T", code: "KeyT", shiftKey: false })).toEqual({
      key: "t",
      code: "KeyT",
    });
  });
});

describe("sameBinding", () => {
  it("tells a key with Shift from the key alone", () => {
    expect(sameBinding({ key: "n" }, { key: "n", code: "KeyN" })).toBe(true);
    expect(sameBinding({ key: "n" }, { key: "n", shift: true })).toBe(false);
  });
});

describe("bindingLabel", () => {
  it("names the modifiers that are part of the binding", () => {
    expect(bindingLabel({ key: "ArrowLeft", shift: true })).toBe("Shift+←");
    expect(bindingLabel({ key: "n", ctrl: true, shift: true })).toBe("Ctrl+Shift+N");
    expect(bindingLabel({ key: "n" })).toBe("N");
  });
});

describe("eventKey", () => {
  it("gives the key a press of the binding reports", () => {
    expect(eventKey("Space")).toBe(" ");
    expect(eventKey("Enter")).toBe("Enter");
    expect(eventKey("t")).toBe("t");
  });
});

describe("keyLabel", () => {
  it("capitalizes characters", () => {
    expect(keyLabel("a")).toBe("A");
    expect(keyLabel("é")).toBe("É");
    expect(keyLabel(",")).toBe(",");
  });

  it("draws the arrow keys as arrows", () => {
    expect(keyLabel("ArrowUp")).toBe("↑");
    expect(keyLabel("ArrowLeft")).toBe("←");
  });

  it("splits the other names into words", () => {
    expect(keyLabel("PageUp")).toBe("Page Up");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("F12")).toBe("F12");
  });
});
