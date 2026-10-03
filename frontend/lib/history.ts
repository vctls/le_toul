import { TimedSegment } from "@/lib/timedSegments";
import { VoiceId } from "@/lib/voices";
import { TabId } from "@/lib/tabRoute";

type SegmentsByVoice = Record<VoiceId, TimedSegment[]>;

// What turns one list of segments into another: the new length, and the segments that differ.
// A tap changes a segment or two, so this keeps a long history small.
export type SegmentsPatch = {
  length: number;
  changes: Record<number, TimedSegment>;
};

// A voice set to `null` has no segments in the state the patch leads to.
export type VoicesPatch = Record<VoiceId, SegmentsPatch | null>;

export type TextPatch = { start: number; removed: string; inserted: string };

// Everything an undo or a redo restores.
export type HistoryState = {
  lyricText: string;
  segments: SegmentsByVoice;
  baseline: SegmentsByVoice;
};

export type StatePatch = {
  lyrics?: TextPatch;
  segments?: VoicesPatch;
  baseline?: VoicesPatch;
};

export type EntryMeta = {
  label: string;
  tab: TabId;
  // The lyric selection before and after the change, for lyric edits only.
  selection?: { before: [number, number]; after: [number, number] };
};

export type HistoryEntry = EntryMeta & StatePatch;

export const TAB_LABELS: Partial<Record<TabId, string>> = {
  song: "Files",
  lyrics: "Lyrics",
  timing: "Timing (legacy)",
  adjust: "Timing",
  edit: "Edit",
};

/**
 * A form of the segments that compares equal whenever their values do.
 * Rebuilt segments list their fields in another order, and a field set to undefined counts as absent.
 */
export function serializeSegments(segments: TimedSegment[]): string {
  return JSON.stringify(
    segments.map((segment) =>
      Object.entries(segment)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/**
 * The patch that turns `from` into `to`.
 */
export function diffSegments(from: TimedSegment[], to: TimedSegment[]): SegmentsPatch {
  const changes: Record<number, TimedSegment> = {};
  to.forEach((segment, index) => {
    if (index >= from.length || serializeSegments([segment]) !== serializeSegments([from[index]])) {
      changes[index] = { ...segment };
    }
  });
  return { length: to.length, changes };
}

export function applyPatch(segments: TimedSegment[], patch: SegmentsPatch): TimedSegment[] {
  return Array.from({ length: patch.length }, (_, index) => ({
    ...(patch.changes[index] ?? segments[index]),
  }));
}

/**
 * The patch that turns `from` into `to`, or undefined if they are equal.
 */
export function diffVoices(from: SegmentsByVoice, to: SegmentsByVoice): VoicesPatch | undefined {
  const patch: VoicesPatch = {};
  for (const voice of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!(voice in to)) {
      patch[voice] = null;
    } else if (
      !(voice in from) ||
      serializeSegments(from[voice]) !== serializeSegments(to[voice])
    ) {
      patch[voice] = diffSegments(from[voice] ?? [], to[voice]);
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function applyVoicesPatch(byVoice: SegmentsByVoice, patch: VoicesPatch): SegmentsByVoice {
  const result: SegmentsByVoice = { ...byVoice };
  for (const [voice, voicePatch] of Object.entries(patch)) {
    if (voicePatch === null) {
      delete result[voice];
    } else {
      result[voice] = applyPatch(byVoice[voice] ?? [], voicePatch);
    }
  }
  return result;
}

/**
 * The patch that turns `from` into `to`: the one span that differs once the common prefix and
 * suffix are trimmed. Undefined if they are equal.
 */
export function diffText(from: string, to: string): TextPatch | undefined {
  if (from === to) return undefined;
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let fromEnd = from.length;
  let toEnd = to.length;
  while (fromEnd > start && toEnd > start && from[fromEnd - 1] === to[toEnd - 1]) {
    fromEnd--;
    toEnd--;
  }
  return { start, removed: from.slice(start, fromEnd), inserted: to.slice(start, toEnd) };
}

export function applyTextPatch(text: string, patch: TextPatch): string {
  return (
    text.slice(0, patch.start) + patch.inserted + text.slice(patch.start + patch.removed.length)
  );
}

export function diffStates(from: HistoryState, to: HistoryState): StatePatch {
  const patch: StatePatch = {};
  const lyrics = diffText(from.lyricText, to.lyricText);
  const segments = diffVoices(from.segments, to.segments);
  const baseline = diffVoices(from.baseline, to.baseline);
  if (lyrics) patch.lyrics = lyrics;
  if (segments) patch.segments = segments;
  if (baseline) patch.baseline = baseline;
  return patch;
}

export function applyStatePatch(state: HistoryState, patch: StatePatch): HistoryState {
  return {
    lyricText: patch.lyrics ? applyTextPatch(state.lyricText, patch.lyrics) : state.lyricText,
    segments: patch.segments ? applyVoicesPatch(state.segments, patch.segments) : state.segments,
    baseline: patch.baseline ? applyVoicesPatch(state.baseline, patch.baseline) : state.baseline,
  };
}

export function isEmptyPatch(patch: StatePatch): boolean {
  return !patch.lyrics && !patch.segments && !patch.baseline;
}

/**
 * A short fingerprint of the state, so the history can tell whether it still applies without
 * keeping a copy of the lyrics and every segment.
 */
export function hashState(state: HistoryState): string {
  const byVoice = (segments: SegmentsByVoice) =>
    Object.keys(segments)
      .sort()
      .map((voice) => [voice, serializeSegments(segments[voice])]);
  return cyrb53(
    JSON.stringify([state.lyricText, byVoice(state.segments), byVoice(state.baseline)]),
  ).toString(36);
}

/**
 * A fast 53-bit string hash (cyrb53, public domain).
 */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const SHORTCUT_MODIFIER = IS_MAC ? "Cmd" : "Ctrl";
export const UNDO_SHORTCUT = `${SHORTCUT_MODIFIER}+Z`;
export const REDO_SHORTCUT = `${SHORTCUT_MODIFIER}+Shift+Z`;

/**
 * The history step a shortcut asks for.
 * Ctrl+Z undoes, and Ctrl+Shift+Z or Ctrl+Y redo, with Cmd in place of Ctrl on macOS.
 */
export function historyStepFor(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(IS_MAC ? event.metaKey : event.ctrlKey) || event.altKey) return null;
  // The key is read by its character rather than its position, so that Z follows the layout.
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

/**
 * A history button's tooltip, such as "Undo Paste (Ctrl+Z)".
 */
export function historyTitle(step: "undo" | "redo", next: EntryMeta | null): string {
  const action = step === "undo" ? "Undo" : "Redo";
  const shortcut = step === "undo" ? UNDO_SHORTCUT : REDO_SHORTCUT;
  return next ? `${action} ${next.label} (${shortcut})` : `${action} (${shortcut})`;
}
