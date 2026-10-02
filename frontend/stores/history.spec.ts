import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useHistoryStore } from "./history";
import { useLyricsStore } from "./lyrics";
import { useTimingsStore } from "./timings";
import { LYRIC_MARKERS } from "@/constants";
import { DEFAULT_VOICE_ID } from "@/lib/voices";
import { TimedSegment } from "@/lib/timedSegments";

const twoLines = (): TimedSegment[] => [
  { text: "one\n", start: 1, end: 2 },
  { text: "two", start: 3, end: 4 },
];

const threeWords = (): TimedSegment[] => [
  { text: "one_", start: 1, end: 1.5 },
  { text: "two_", start: 2, end: 2.5 },
  { text: "three", start: 3, end: 3.5 },
];

function load(lyricText: string, segments: TimedSegment[]) {
  const timings = useTimingsStore();
  const lyrics = useLyricsStore();
  const history = useHistoryStore();
  lyrics.setLyrics(lyricText);
  timings.setAllSegments({ [DEFAULT_VOICE_ID]: segments });
  return { timings, lyrics, history };
}

const moved = (segments: TimedSegment[], index: number, fields: Partial<TimedSegment>) =>
  segments.map((segment, i) => (i === index ? { ...segment, ...fields } : { ...segment }));

function pasteLyrics(text: string) {
  useHistoryStore().record(
    { label: "Paste", tab: "lyrics" },
    () => useLyricsStore().setLyrics(text),
    { warnLoss: true },
  );
}

describe("History", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  describe("timing edits", () => {
    test("undo and redo a syllable edit", () => {
      const { timings, history } = load("one\ntwo", twoLines());

      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }));
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);

      history.undo();
      expect(timings.activeSegments).toEqual(twoLines());
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(true);

      history.redo();
      expect(timings.activeSegments[1].start).toBe(2.5);
      expect(history.canRedo).toBe(false);
    });

    test("undo and redo a display period edit", () => {
      const { timings, history } = load("one\ntwo", twoLines());

      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { displayStart: 0.5 }));
      history.undo();
      expect(timings.activeSegments[0].displayStart).toBeUndefined();

      history.redo();
      expect(timings.activeSegments[0].displayStart).toBe(0.5);
    });

    test("undoing a syllable drag restores the display bound it pushed", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { displayStart: 0.8 }));

      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { start: 0.5 }));
      expect(timings.activeSegments[0].displayStart).toBe(0.5);

      history.undo();
      expect(timings.activeSegments[0]).toMatchObject({ start: 1, displayStart: 0.8 });
    });

    test("an edit that changes nothing is not recorded", () => {
      const { timings, history } = load("one\ntwo", twoLines());

      timings.applyAdjustEdit(timings.activeSegments);

      expect(history.canUndo).toBe(false);
    });

    test("a new edit clears the redo stack", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }));
      history.undo();

      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 3.5 }));

      expect(history.canRedo).toBe(false);
    });

    test("undoes a run of edits one at a time", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      const first = moved(twoLines(), 0, { start: 0.5 });
      const second = moved(first, 1, { end: 3.5 });
      timings.applyVoiceEdits(DEFAULT_VOICE_ID, [first, second]);

      history.undo();
      expect(timings.activeSegments).toEqual(first);
      history.undo();
      expect(timings.activeSegments).toEqual(twoLines());
      history.redo();
      expect(timings.activeSegments).toEqual(first);
    });

    test("names the next step", () => {
      const { timings, history } = load("one\ntwo", twoLines());

      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }), "Drag");

      expect(history.nextUndo).toMatchObject({ label: "Drag", tab: "adjust" });
      history.undo();
      expect(history.nextRedo).toMatchObject({ label: "Drag", tab: "adjust" });
    });
  });

  describe("voices", () => {
    const loadTwoVoices = () => {
      const timings = useTimingsStore();
      useLyricsStore().setLyrics("[Anna] hello\n[Ben] world");
      timings.setAllSegments({
        Anna: [{ text: "hello", start: 1 }],
        Ben: [{ text: "world", start: 5 }],
      });
      return { timings, history: useHistoryStore() };
    };

    test("one history covers every voice, and an undo shows the voice it changes", () => {
      const { timings, history } = loadTwoVoices();
      timings.setActiveVoice("Anna");
      timings.applyAdjustEdit([{ text: "hello", start: 1.5 }]);
      timings.setActiveVoice("Ben");
      timings.applyAdjustEdit([{ text: "world", start: 5.5 }]);

      history.undo();
      expect(timings.segmentsByVoice.Ben[0].start).toBe(5);

      history.undo();
      expect(timings.segmentsByVoice.Anna[0].start).toBe(1);
      expect(timings.activeVoice).toBe("Anna");
    });
  });

  describe("lyric edits", () => {
    test("undoing a lyric edit restores the lyrics, the segments and the baseline", () => {
      const { timings, lyrics, history } = load("one_two_three", threeWords());

      pasteLyrics("one_new_words_three");
      expect(timings.activeSegments[1]).toEqual({ text: "new_", start: 2, review: "moved" });

      history.undo();
      expect(lyrics.lyricText).toBe("one_two_three");
      expect(timings.activeSegments).toEqual(threeWords());
      expect(timings._baselineByVoice[DEFAULT_VOICE_ID]).toEqual(threeWords());
    });

    test("timings a paste removed come back, even after a timing edit", () => {
      const { timings, history } = load("one_two_three", threeWords());
      pasteLyrics("one_new_words_three");
      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { start: 0.5 }));

      history.undo();
      history.undo();

      expect(timings.activeSegments).toEqual(threeWords());
    });

    test("a lyric edit keeps the timing history", () => {
      const { timings, history } = load("one_two_three", threeWords());
      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { start: 0.5 }));
      pasteLyrics("one_two_three_four");

      history.undo();
      history.undo();

      expect(timings.activeSegments).toEqual(threeWords());
    });

    test("reports the timings a paste removed", () => {
      const { timings, history } = load("one_two_three", threeWords());

      pasteLyrics("xa_ya_za_three");

      expect(history.lastLoss).toMatchObject({ lost: 1, moved: 2, entry: { label: "Paste" } });
      expect(timings.activeSegments.at(-1)).toEqual({ text: "three", start: 3, end: 3.5 });
    });

    test("reports the timings a paste moved to replaced words", () => {
      const { history } = load("one_two_three", threeWords());

      pasteLyrics("one_too_three");

      expect(history.lastLoss).toMatchObject({ lost: 0, moved: 1 });
    });

    test("doesn't count deleted words", () => {
      const { history } = load("one_two_three", threeWords());

      pasteLyrics("one_three");

      expect(history.lastLoss).toBeNull();
    });

    test("only counts the segments that an edit newly flagged", () => {
      const { history } = load("one\ntwo\nthree", [
        { text: "one\n", start: 1 },
        { text: "two\n", start: 2 },
        { text: "three", start: 3 },
      ]);
      pasteLyrics("one\nnew_words\nthree");
      expect(history.lastLoss).toMatchObject({ lost: 0, moved: 1 });
      history.lastLoss = null;

      pasteLyrics("one\nnew_words\nthree\nfour");

      expect(history.lastLoss).toBeNull();
    });

    test("clearing flags without moving a timing can be undone", () => {
      const { timings, history } = load("one_two_three", threeWords());
      pasteLyrics("one_too_three");
      const checked = timings.activeSegments.map(({ review: _review, ...segment }) => segment);

      timings.applyAdjustEdit(checked, "Mark as checked");
      expect(timings.activeSegments[1].review).toBeUndefined();
      history.undo();

      expect(timings.activeSegments[1].review).toBe("moved");
    });

    test("reports nothing for a paste that keeps every timing", () => {
      const { history } = load("one_two_three", threeWords());

      pasteLyrics("one_two_three_four");

      expect(history.lastLoss).toBeNull();
    });

    test("the reconciliation watchers leave an undo alone", async () => {
      const { timings, history } = load("one_two_three", threeWords());
      timings.setupVoiceReconciliation();
      timings.setupSegmentReconciliation();
      pasteLyrics("one_new_words_three");
      await nextTick();
      const reconcile = vi.spyOn(timings, "reconcileSegments");

      history.undo();
      await nextTick();

      expect(reconcile).not.toHaveBeenCalled();
      expect(timings.activeSegments).toEqual(threeWords());
    });

    test("reconciling a recorded lyric edit again changes nothing", async () => {
      const { timings } = load("[Anna] one_two_three", threeWords());
      pasteLyrics("[Bea] one_new_words_three");
      const after = JSON.stringify(timings._segmentsByVoice);

      timings.reconcileVoices();
      timings.reconcileSegments();

      expect(JSON.stringify(timings._segmentsByVoice)).toBe(after);
    });

    test("typing that continues joins one entry", () => {
      const { lyrics, history } = load("one", [{ text: "one", start: 1 }]);
      const type = (text: string, continues: boolean) =>
        history.recordTyping(
          { label: "Typing", tab: "lyrics", selection: { before: [0, 0], after: [0, 0] } },
          () => lyrics.setLyrics(text),
          continues,
        );

      type("one_", false);
      type("one_t", true);
      type("one_tw", true);
      expect(history.canUndo).toBe(true);
      type("one_two_", false);
      history.closeGroup();

      history.undo();
      expect(lyrics.lyricText).toBe("one_tw");
      history.undo();
      expect(lyrics.lyricText).toBe("one");
    });
  });

  describe("writes outside the history", () => {
    test("a lyric write that isn't recorded drops the history", async () => {
      const { timings, lyrics, history } = load("one\ntwo", twoLines());
      timings.setupSegmentReconciliation();
      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      lyrics.setLyrics("one\ntwo_three");
      await nextTick();

      expect(history.canUndo).toBe(false);
      history.undo();
      expect(warn).toHaveBeenCalled();
      expect(timings.activeSegments.map(({ text }) => text)).toEqual(["one\n", "two_", "three"]);
    });

    test("a timing write that isn't recorded drops the history", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }));

      timings.add(1, LYRIC_MARKERS.SEGMENT_END, 3.8);

      expect(history.canUndo).toBe(false);
    });

    test("clear forgets everything", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 }));

      history.clear();

      expect(history.canUndo).toBe(false);
      expect(JSON.parse(localStorage.getItem("history")!).undo).toEqual([]);
    });
  });

  describe("persistence", () => {
    test("the history survives a reload", async () => {
      const { timings } = load("one_two_three", threeWords());
      timings.setupPersistence();
      pasteLyrics("one_new_words_three");
      timings.applyAdjustEdit(moved(timings.activeSegments, 0, { start: 0.5 }));
      await nextTick();

      setActivePinia(createPinia());
      const reloaded = useHistoryStore();
      expect(reloaded.canUndo).toBe(true);

      reloaded.undo();
      reloaded.undo();
      expect(useTimingsStore().activeSegments).toEqual(threeWords());
      expect(useLyricsStore().lyricText).toBe("one_two_three");
    });

    test("removes the old per-voice history", () => {
      localStorage.setItem("timings._history", "{}");

      useHistoryStore();

      expect(localStorage.getItem("timings._history")).toBeNull();
    });

    test("the undo stack stops growing at 1000 entries", () => {
      const { timings, history } = load("one\ntwo", twoLines());
      for (let i = 1; i <= 1005; i++) {
        timings.applyAdjustEdit(moved(timings.activeSegments, 1, { start: 2.5 + i / 1000 }));
      }

      let undone = 0;
      while (history.canUndo) {
        history.undo();
        undone++;
      }

      expect(undone).toBe(1000);
      expect(timings.activeSegments[1].start).toBeCloseTo(2.505);
    }, 20_000);

    test("drops the oldest entries to stay under the size limit", () => {
      // Few long words reach the size limit without hashing thousands of segments per paste.
      const words = Array.from({ length: 600 }, (_, i) => `word${i}`.padEnd(90, "x")).join("_");
      const { history } = load(words, []);
      for (let i = 0; i < 40; i++) {
        pasteLyrics(i % 2 === 0 ? "" : words);
      }

      expect(localStorage.getItem("history")!.length).toBeLessThanOrEqual(1_000_000);
      expect(history.undoStack.length).toBeLessThan(40);
      expect(history.canUndo).toBe(true);
    });
  });
});
