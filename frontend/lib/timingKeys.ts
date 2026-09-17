// The keys a user taps to mark the start and end of a timing. Stored as
// KeyboardEvent.code names; the timings store still speaks legacy keyCode numbers, so
// SongTimingTab translates at the boundary.

export interface TimingKeys {
  start: string;
  end: string;
}

export const DEFAULT_TIMING_KEYS: TimingKeys = { start: "Space", end: "Enter" };

function suffixed(prefix: string, suffixes: string): string[] {
  return [...suffixes].map((suffix) => prefix + suffix);
}

const LETTERS = suffixed("Key", "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const DIGITS = suffixed("Digit", "0123456789");
const NUMPAD_DIGITS = suffixed("Numpad", "0123456789");
const FUNCTION_KEYS = Array.from({ length: 12 }, (_unused, i) => `F${i + 1}`);

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

// Accepts any casing, so a hand-typed "space" still lands on a real code.
export function normalizeKeyName(value: string): string | undefined {
  const wanted = value.trim().toLowerCase();
  return KEY_NAMES.find((name) => name.toLowerCase() === wanted);
}

export function eventMatchesKey(eventCode: string, boundKey: string): boolean {
  if (eventCode === boundKey) {
    return true;
  }
  return EQUIVALENTS.some((group) => group.includes(eventCode) && group.includes(boundKey));
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
