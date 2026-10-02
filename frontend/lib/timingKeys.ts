// The keys that drive the Timing tab: the tap keys, the playback and view keys, and the mode
// and review shortcuts.
// A shortcut named T answers to whichever key types T on the user's layout.
// The timings store still speaks legacy keyCode numbers, so SongTimingTab translates at the boundary.

export interface KeyBinding {
  // What the key types, as KeyboardEvent.key gives it: a lowercase character, or the name of a key
  // that types none, such as "Enter" or "ArrowLeft". Space is stored as "Space".
  key: string;
  // Where a character key sits, as KeyboardEvent.code gives it,
  // for when a non-Latin layout changes what it types.
  code?: string;
  // Whether Shift is part of the shortcut. A character Shift types, such as <, is its own key
  // instead.
  shift?: boolean;
  ctrl?: boolean;
}

export interface TimingKeys {
  start: KeyBinding;
  end: KeyBinding;
  redo: KeyBinding;
  playPause: KeyBinding;
  replay: KeyBinding;
  seekBack: KeyBinding;
  seekForward: KeyBinding;
  seekBackFar: KeyBinding;
  seekForwardFar: KeyBinding;
  zoomIn: KeyBinding;
  zoomOut: KeyBinding;
  viewStart: KeyBinding;
  viewEnd: KeyBinding;
  songStart: KeyBinding;
  songEnd: KeyBinding;
  switchMode: KeyBinding;
  nextReview: KeyBinding;
  previousReview: KeyBinding;
  markChecked: KeyBinding;
}

export type TimingAction = keyof TimingKeys;
export type TapAction = "start" | "end" | "redo";

export const DEFAULT_TIMING_KEYS: Readonly<TimingKeys> = {
  start: { key: "Space" },
  end: { key: "Enter" },
  redo: { key: "Backspace" },
  playPause: { key: "Space" },
  replay: { key: "Enter" },
  seekBack: { key: "ArrowLeft" },
  seekForward: { key: "ArrowRight" },
  seekBackFar: { key: "ArrowLeft", shift: true },
  seekForwardFar: { key: "ArrowRight", shift: true },
  zoomIn: { key: "ArrowUp" },
  zoomOut: { key: "ArrowDown" },
  viewStart: { key: "Home" },
  viewEnd: { key: "End" },
  songStart: { key: "Home", ctrl: true },
  songEnd: { key: "End", ctrl: true },
  switchMode: { key: "t", code: "KeyT" },
  nextReview: { key: "n", code: "KeyN" },
  previousReview: { key: "n", code: "KeyN", shift: true },
  markChecked: { key: "c", code: "KeyC" },
};

// The tap keys come first, as they take precedence in Tap mode.
export const TIMING_ACTIONS = Object.keys(DEFAULT_TIMING_KEYS) as readonly TimingAction[];

const TAP_ACTIONS = new Set<TimingAction>(["start", "end", "redo"] satisfies TapAction[]);

/**
 * Whether the action is one of the tap keys.
 * A tap key may share its key with another action, as Space starts a syllable in Tap mode and
 * plays elsewhere. Two tap keys can't, nor two other actions, as one of them would be unreachable.
 */
export function isTapAction(action: TimingAction): action is TapAction {
  return TAP_ACTIONS.has(action);
}

const FUNCTION_KEYS = Array.from({ length: 12 }, (_unused, i) => `F${i + 1}`);

// The keys that type no character and can still be bound.
// Modifiers are left out on purpose: a bare Shift or Control press is swallowed by too
// much else to be a reliable tap.
const NAMED_KEYS = new Set([
  "Space",
  "Enter",
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
  ...FUNCTION_KEYS,
]);

function isCharacter(value: string): boolean {
  return [...value].length === 1 && value.trim() !== "";
}

/**
 * Whether the key types a character, which Shift or another layout can change, so that its
 * binding keeps where it sits too.
 */
export function isCharacterKey(key: string): boolean {
  return !NAMED_KEYS.has(key);
}

function isNonLatinLetter(key: string | undefined): boolean {
  return !!key && /^\p{L}$/u.test(key) && !/^\p{Script=Latin}$/u.test(key);
}

export function isKeyName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (NAMED_KEYS.has(value) || (isCharacter(value) && value === value.toLowerCase()))
  );
}

/**
 * The binding a key press stands for, or undefined for a key that can't be bound, such as a
 * modifier or a dead key.
 * Letters are lowercased, so Shift and Caps Lock don't change which shortcut a letter is.
 */
export function keyFromEvent(event: Pick<KeyboardEvent, "key">): string | undefined {
  if (event.key === " ") {
    return "Space";
  }
  if (NAMED_KEYS.has(event.key)) {
    return event.key;
  }
  return isCharacter(event.key) ? event.key.toLowerCase() : undefined;
}

type PressedKey = Pick<KeyboardEvent, "key" | "code" | "shiftKey"> &
  Partial<Pick<KeyboardEvent, "ctrlKey" | "getModifierState">>;

/**
 * Whether Ctrl is held as a modifier.
 * AltGr reports as Ctrl and Alt on Windows, and is how some layouts type a character.
 */
export function isCtrlHeld(event: PressedKey): boolean {
  return !!event.ctrlKey && !(event.getModifierState?.("AltGraph") ?? false);
}

/**
 * The binding a press in a key picker stands for, or undefined for a key that can't be bound.
 */
export function bindingFromEvent(event: PressedKey): KeyBinding | undefined {
  const key = keyFromEvent(event);
  if (!key) return undefined;
  const binding: KeyBinding =
    isCharacterKey(key) && event.code ? { key, code: event.code } : { key };
  // Shift is recorded only where it doesn't already show in the character, as on a letter or an
  // arrow key.
  const hasCase = event.key.toLowerCase() !== event.key.toUpperCase();
  if (event.shiftKey && (!isCharacterKey(key) || hasCase)) binding.shift = true;
  if (isCtrlHeld(event)) binding.ctrl = true;
  return binding;
}

export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return a.key === b.key && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl;
}

/**
 * Which of the actions the press is bound to.
 * A binding answers only with Ctrl held if it has Ctrl, and only without it otherwise, so Ctrl+C
 * stays the browser's copy while C has a binding.
 * A binding without Shift answers with Shift held too, unless one with Shift claims the key.
 * What the key types decides first. Where the key sits decides only when the press or the binding
 * is a non-Latin letter, as the T key types е on a Russian layout. A Latin layout such as Bépo still
 * goes by letter.
 */
export function findBinding<A extends string>(
  event: PressedKey,
  bindings: Readonly<Record<A, KeyBinding>>,
  actions: readonly A[],
): A | undefined {
  const pressed = keyFromEvent(event);
  const ctrl = isCtrlHeld(event);
  const withCtrl = actions.filter((action) => !!bindings[action].ctrl === ctrl);
  const candidates = event.shiftKey
    ? [
        ...withCtrl.filter((action) => bindings[action].shift),
        ...withCtrl.filter((action) => !bindings[action].shift),
      ]
    : withCtrl.filter((action) => !bindings[action].shift);
  return (
    candidates.find((action) => bindings[action].key === pressed) ??
    candidates.find((action) => {
      const { key, code } = bindings[action];
      return (
        code !== undefined &&
        code === event.code &&
        (isNonLatinLetter(pressed) || isNonLatinLetter(key))
      );
    })
  );
}

/**
 * The KeyboardEvent.key of a press of the bound key, for buttons that stand in for it.
 */
export function eventKey(binding: string): string {
  return binding === "Space" ? " " : binding;
}

const ARROWS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/**
 * A binding's name for prose and buttons, with its modifiers.
 */
export function bindingLabel({ key, shift, ctrl }: KeyBinding): string {
  return `${ctrl ? "Ctrl+" : ""}${shift ? "Shift+" : ""}${keyLabel(key)}`;
}

/**
 * A key's name for prose and buttons, where "a" and "PageUp" read badly.
 */
export function keyLabel(binding: string): string {
  if (binding in ARROWS) {
    return ARROWS[binding];
  }
  if (isCharacter(binding)) {
    return binding.toUpperCase();
  }
  return binding.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}
