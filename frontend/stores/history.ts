import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { useLyricsStore } from "./lyrics";
import { useTimingsStore } from "./timings";
import {
  EntryMeta,
  HistoryEntry,
  HistoryState,
  applyStatePatch,
  diffStates,
  hashState,
  isEmptyPatch,
} from "@/lib/history";
import { TimedSegment, lostTimings } from "@/lib/timedSegments";
import { VoiceId } from "@/lib/voices";
import { TabId } from "@/lib/tabRoute";
import { loadJsonFromStorage } from "@/lib/persistence";

const STORAGE_KEY = "history";
// The per-voice Adjust history that this one replaced.
const LEGACY_STORAGE_KEY = "timings._history";
const ENTRY_LIMIT = 1000;
// An entry for a whole-song paste holds every segment, so the entry count alone could exceed the
// localStorage quota.
const SIZE_LIMIT = 1_000_000;

type Step = "undo" | "redo";

type StoredHistory = { undo: HistoryEntry[]; redo: HistoryEntry[]; head: string | null };

type TypingGroup = { meta: EntryMeta; before: HistoryState };

// A tab that steps the history its own way while it is shown.
type TabStepper = { tab: TabId; canStep(step: Step): boolean; step(step: Step): void };

function copyByVoice(byVoice: Record<VoiceId, TimedSegment[]>): Record<VoiceId, TimedSegment[]> {
  return Object.fromEntries(
    Object.entries(byVoice).map(([voice, segments]) => [
      voice,
      segments.map((segment) => ({ ...segment })),
    ]),
  );
}

function allSegments(byVoice: Record<VoiceId, TimedSegment[]>): TimedSegment[] {
  return Object.values(byVoice).flat();
}

/**
 * One linear history of the lyrics and the timings, for every tab and voice.
 * An entry is the patch that takes one change back, so undoing it restores the lyrics, the segments
 * and the reconciliation baseline together, without reconciling again.
 */
export const useHistoryStore = defineStore("history", () => {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  const stored = loadJsonFromStorage<StoredHistory | null>(STORAGE_KEY, null);

  // The stacks are replaced rather than mutated, so the entries don't need to be deeply reactive.
  const undoStack = shallowRef<HistoryEntry[]>(stored?.undo ?? []);
  const redoStack = shallowRef<HistoryEntry[]>(stored?.redo ?? []);
  // The hash of the state after the history's last write.
  // Any other write makes the current state differ, and the stacks no longer apply to it.
  const head = ref<string | null>(stored?.head ?? null);
  let group: TypingGroup | null = null;
  const isTyping = ref(false);

  // The last step taken, and the last edit that removed timings, for the UI to report.
  const lastStep = shallowRef<{ entry: HistoryEntry; step: Step } | null>(null);
  const lastLoss = shallowRef<{ entry: HistoryEntry; lost: number } | null>(null);
  const tabStepper = shallowRef<TabStepper | null>(null);

  function liveState(): HistoryState {
    const timings = useTimingsStore();
    return {
      lyricText: useLyricsStore().lyricText,
      segments: timings._segmentsByVoice,
      baseline: timings._baselineByVoice,
    };
  }

  /**
   * A copy of the state, since some writers mutate the segments in place.
   */
  function snapshot(): HistoryState {
    const state = liveState();
    return {
      lyricText: state.lyricText,
      segments: copyByVoice(state.segments),
      baseline: copyByVoice(state.baseline),
    };
  }

  const currentHash = computed(() => hashState(liveState()));
  const isCurrent = computed(() => head.value === currentHash.value);

  const canUndo = computed(() => isTyping.value || (isCurrent.value && undoStack.value.length > 0));
  const canRedo = computed(() => !isTyping.value && isCurrent.value && redoStack.value.length > 0);
  const nextUndo = computed(() => (isTyping.value ? group!.meta : undoStack.value.at(-1)) ?? null);
  const nextRedo = computed(() => redoStack.value.at(-1) ?? null);

  function save() {
    let undo = undoStack.value;
    let redo = redoStack.value;
    let json = JSON.stringify({ undo, redo, head: head.value });
    while (json.length > SIZE_LIMIT && (undo.length > 0 || redo.length > 0)) {
      if (undo.length > 0) {
        undo = undo.slice(1);
      } else {
        redo = redo.slice(1);
      }
      json = JSON.stringify({ undo, redo, head: head.value });
    }
    undoStack.value = undo;
    redoStack.value = redo;
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      console.error("Failed to save the undo history to localStorage", e);
    }
  }

  /**
   * Drop the stacks if a write that wasn't recorded has changed the state since the last one that
   * was. Restoring a patch onto a state it wasn't computed from would corrupt the lyrics.
   */
  function ensureCurrent() {
    if (isCurrent.value) return;
    if (undoStack.value.length > 0 || redoStack.value.length > 0) {
      console.warn("The lyrics or timings changed outside the undo history, which is dropped.");
    }
    undoStack.value = [];
    redoStack.value = [];
    head.value = currentHash.value;
  }

  /**
   * Run a write, and carry the timings across any lyric change it made at once, so the entry
   * holds what the reconciliation changed.
   */
  function applyWrite(write: () => void) {
    const lyrics = useLyricsStore();
    const textBefore = lyrics.lyricText;
    const voicesBefore = lyrics.voices.join("\n");
    write();
    if (lyrics.lyricText !== textBefore) {
      useTimingsStore().reconcileLyricEdit(lyrics.voices.join("\n") !== voicesBefore);
    }
  }

  function push(meta: EntryMeta, before: HistoryState, warnLoss = false) {
    const after = liveState();
    const patch = diffStates(after, before);
    if (isEmptyPatch(patch)) return;
    const entry: HistoryEntry = { ...meta, ...patch };
    undoStack.value = [...undoStack.value.slice(-(ENTRY_LIMIT - 1)), entry];
    redoStack.value = [];
    head.value = hashState(after);
    save();
    if (warnLoss) {
      const lost = lostTimings(allSegments(before.segments), allSegments(after.segments));
      if (lost > 0) {
        lastLoss.value = { entry, lost };
      }
    }
  }

  /**
   * Run a write and record it as one entry.
   * `warnLoss` reports the timings it removed, for edits that aren't expected to remove any.
   */
  function record(meta: EntryMeta, write: () => void, { warnLoss = false } = {}) {
    closeGroup();
    ensureCurrent();
    const before = snapshot();
    applyWrite(write);
    push(meta, before, warnLoss);
  }

  /**
   * Run a typing write, which joins the open group of typing when `continues` is set.
   * The group becomes one entry when it closes.
   */
  function recordTyping(meta: EntryMeta, write: () => void, continues: boolean) {
    if (group && continues) {
      group.meta = {
        ...group.meta,
        selection: meta.selection && {
          before: group.meta.selection?.before ?? meta.selection.before,
          after: meta.selection.after,
        },
      };
    } else {
      closeGroup();
      ensureCurrent();
      group = { meta, before: snapshot() };
      isTyping.value = true;
    }
    applyWrite(write);
  }

  function closeGroup() {
    if (!group) return;
    const { meta, before } = group;
    group = null;
    isTyping.value = false;
    push(meta, before);
  }

  function step(step: Step): HistoryEntry | null {
    closeGroup();
    ensureCurrent();
    const [from, to] = step === "undo" ? [undoStack, redoStack] : [redoStack, undoStack];
    const entry = from.value.at(-1);
    if (!entry) return null;
    from.value = from.value.slice(0, -1);

    const current = snapshot();
    const restored = applyStatePatch(current, entry);
    const timings = useTimingsStore();
    timings.restoreHistoryState(restored.lyricText, restored.segments, restored.baseline);
    const { label, tab, selection } = entry;
    to.value = [...to.value, { label, tab, selection, ...diffStates(restored, current) }];
    head.value = hashState(restored);
    save();

    // The Adjust tab shows one voice, so a change to another one would be invisible.
    const touched = Object.keys(entry.segments ?? {});
    if (touched.length > 0 && !touched.includes(timings.activeVoice)) {
      const shown = touched.find((voice) => useLyricsStore().voices.includes(voice));
      if (shown) timings.setActiveVoice(shown);
    }
    lastStep.value = { entry, step };
    return entry;
  }

  function undo() {
    return step("undo");
  }

  function redo() {
    return step("redo");
  }

  function setTabStepper(stepper: TabStepper | null) {
    tabStepper.value = stepper;
  }

  function clear() {
    group = null;
    isTyping.value = false;
    undoStack.value = [];
    redoStack.value = [];
    head.value = null;
    save();
  }

  /**
   * Close the typing group before the page goes away, so the saved history matches the lyrics.
   */
  function setupPersistence() {
    window.addEventListener("pagehide", closeGroup);
  }

  return {
    undoStack,
    redoStack,
    head,
    isTyping,
    lastStep,
    lastLoss,
    tabStepper,
    canUndo,
    canRedo,
    nextUndo,
    nextRedo,
    record,
    recordTyping,
    closeGroup,
    undo,
    redo,
    clear,
    setTabStepper,
    setupPersistence,
  };
});
