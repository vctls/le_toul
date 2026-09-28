// The keys a user taps while timing a song: the two timing markers and the redo-screen shortcut.
// Stored as KeyboardEvent.code names, which name a key by its position on a US QWERTY keyboard.
// Matching on the position keeps a tap reliable whatever Shift, Caps Lock or a dead key would make
// the key type. What a key is called on the user's own layout is kept apart, as its label.
// The timings store still speaks legacy keyCode numbers, so SongTimingTab translates at the boundary.

export interface TimingKeys {
  start: string;
  end: string;
  redo: string;
}

export const DEFAULT_TIMING_KEYS: TimingKeys = {
  start: "Space",
  end: "Enter",
  redo: "Backspace",
};

function suffixed(prefix: string, suffixes: string): string[] {
  return [...suffixes].map((suffix) => prefix + suffix);
}

const LETTERS = suffixed("Key", "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const DIGITS = suffixed("Digit", "0123456789");
const NUMPAD_DIGITS = suffixed("Numpad", "0123456789");
const FUNCTION_KEYS = Array.from({ length: 12 }, (_unused, i) => `F${i + 1}`);
const PUNCTUATION = [
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  // The extra key beside the left Shift on ISO keyboards, which types < on AZERTY.
  "IntlBackslash",
];

// The keys whose character depends on the layout, so that their code name can mislead.
// The code name of every other key is also what it's called on any layout.
const LAYOUT_DEPENDENT = new Set([...LETTERS, ...DIGITS, ...PUNCTUATION]);

// Modifiers are left out on purpose: a bare Shift or Control press is swallowed by too
// much else to be a reliable tap.
export const KEY_NAMES: readonly string[] = [
  "Space",
  "Enter",
  "NumpadEnter",
  "Tab",
  "Backspace",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  ...LETTERS,
  ...DIGITS,
  ...PUNCTUATION,
  ...FUNCTION_KEYS,
  ...NUMPAD_DIGITS,
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
];

const KEY_NAME_SET = new Set<string>(KEY_NAMES);

// Keys a keyboard offers twice, where binding one should answer to both.
const EQUIVALENTS: string[][] = [["Enter", "NumpadEnter"]];

export function isKeyName(value: unknown): value is string {
  return typeof value === "string" && KEY_NAME_SET.has(value);
}

export function eventMatchesKey(eventCode: string, boundKey: string): boolean {
  if (eventCode === boundKey) {
    return true;
  }
  return EQUIVALENTS.some((group) => group.includes(eventCode) && group.includes(boundKey));
}

/**
 * What a pressed key is called on the user's layout, if its code name could mislead.
 * A dead key types nothing by itself, so it gets no label.
 */
export function keyLabelFromEvent(event: Pick<KeyboardEvent, "code" | "key">): string | undefined {
  if (!LAYOUT_DEPENDENT.has(event.code) || [...event.key].length !== 1) {
    return undefined;
  }
  return event.key.toUpperCase();
}

/**
 * A key's name for prose and buttons: its label from the user's layout when one was recorded,
 * and a readable form of its code name otherwise.
 */
export function keyLabel(name: string, labels: Readonly<Record<string, string>>): string {
  return labels[name] ?? formatKeyName(name);
}

// For prose and button labels, where "KeyA" and "Numpad0" read badly.
export function formatKeyName(name: string): string {
  if (/^Key[A-Z]$/.test(name)) {
    return name.slice(3);
  }
  if (/^Digit\d$/.test(name)) {
    return name.slice(5);
  }
  return name.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}
