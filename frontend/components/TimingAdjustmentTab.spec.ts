import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import TimingAdjustmentTab from "@/components/TimingAdjustmentTab.vue";
import { useLyricsStore } from "@/stores/lyrics";
import { useMediaStore } from "@/stores/media";
import { useTimingsStore } from "@/stores/timings";
import { useHistoryStore } from "@/stores/history";
import { useSettingsStore } from "@/stores/settings";
import { useLegacyTimingStore } from "@/stores/legacyTiming";
import { useAdvancedStore } from "@/stores/advanced";
import { LYRIC_MARKERS } from "@/constants";
import { DEFAULT_VOICE_ID } from "@/lib/voices";
import { isDragging } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import type { MixFrame } from "@/lib/wavesurferPlugins/MixPlugin";

vi.mock("@/lib/wavesurferPlugins/OpenEndedRegionPlugin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wavesurferPlugins/OpenEndedRegionPlugin")>()),
  isDragging: vi.fn(() => false),
}));

const togglePlayPause = vi.fn();
const restartAt = vi.fn();
const seekBy = vi.fn();
const clearSelection = vi.fn();
const seekToViewEdge = vi.fn();
const seekToTrackEdge = vi.fn();
const setAudioPlayhead = vi.fn();
const selectSegment = vi.fn();
const anchorZoomOnPlayhead = vi.fn();
// The tab reads the playback clock through the adjuster.
const playback = { paused: true, time: 0 };
const pause = vi.fn(() => {
  playback.paused = true;
});

// Stands in for the TimingAdjuster the tab drives through its ref.
const timingAdjusterStub = {
  name: "TimingAdjuster",
  template: '<div class="timing-adjuster-stub" />',
  methods: {
    togglePlayPause,
    restartAt,
    seekBy,
    clearSelection,
    seekToViewEdge,
    seekToTrackEdge,
    pause,
    setAudioPlayhead,
    selectSegment,
    anchorZoomOnPlayhead,
    isPaused: () => playback.paused,
    currentTime: () => playback.time,
  },
};

// Mounted tabs keep a window keydown listener, so they must be torn down
// between tests or a stale tab answers the key press too.
const mountedTabs: Array<ReturnType<typeof shallowMount>> = [];

function mountTab() {
  const mediaStore = useMediaStore();
  const lyricsStore = useLyricsStore();
  const timingsStore = useTimingsStore();
  mediaStore.songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
  lyricsStore.setLyrics("hello world");
  timingsStore.resetTimings([
    [0.5, LYRIC_MARKERS.SEGMENT_START],
    [1.5, LYRIC_MARKERS.SEGMENT_END],
  ]);

  const wrapper = shallowMount(TimingAdjustmentTab, {
    global: {
      stubs: {
        // The stub drops the settings and the status, which only teleport on a narrow screen.
        teleport: false,
        TimingAdjuster: timingAdjusterStub,
        // The default stub drops its slot, and with it the controls inside.
        BField: { template: "<div><slot /></div>" },
        // The tab pushes the playhead into this one through a ref.
        SubtitleDisplay: {
          name: "SubtitleDisplay",
          template: "<div />",
          methods: { setPlayhead: () => {} },
        },
      },
    },
  });
  // The shortcuts only fire while the tab is on screen. happy-dom leaves offsetParent null,
  // so make the root element look displayed.
  Object.defineProperty(wrapper.vm.$el, "offsetParent", { value: document.body });
  mountedTabs.push(wrapper);
  return wrapper;
}

// What a US QWERTY keyboard reports for the key, unless the test gives another layout's key.
function qwertyKey(code: string): string {
  if (code === "Space") return " ";
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : code;
}

function pressKey(
  code: string,
  {
    target = document.body as HTMLElement,
    shiftKey = false,
    ctrlKey = false,
    key = qwertyKey(code),
  } = {},
) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code, key, shiftKey, ctrlKey, bubbles: true }),
  );
}

describe("TimingAdjustmentTab shortcuts", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    togglePlayPause.mockClear();
    restartAt.mockClear();
    seekBy.mockClear();
    clearSelection.mockClear();
    seekToViewEdge.mockClear();
    seekToTrackEdge.mockClear();
    pause.mockClear();
    setAudioPlayhead.mockClear();
    selectSegment.mockClear();
    anchorZoomOnPlayhead.mockClear();
    playback.paused = true;
    playback.time = 0;
  });

  afterEach(() => {
    while (mountedTabs.length) {
      mountedTabs.pop()?.unmount();
    }
  });

  it("renders the timing adjuster", () => {
    const wrapper = mountTab();
    expect(wrapper.find(".timing-adjuster-stub").exists()).toBe(true);
  });

  it("toggles playback on spacebar", () => {
    mountTab();
    pressKey("Space");
    expect(togglePlayPause).toHaveBeenCalledOnce();
  });

  it("restarts at the last seeked position on Enter", () => {
    const wrapper = mountTab();
    wrapper.vm.onSeek(12.5);
    // Playback running on past the seek must not move the replay point.
    wrapper.vm.onPlayheadUpdate(20);
    pressKey("Enter");
    expect(restartAt).toHaveBeenCalledWith(12.5);
  });

  it("restarts from the start of the song when nothing has been seeked", () => {
    mountTab();
    pressKey("Enter");
    expect(restartAt).toHaveBeenCalledWith(0);
  });

  it("leaves Enter alone when a button has focus", () => {
    mountTab();
    const button = document.createElement("button");
    document.body.appendChild(button);
    pressKey("Enter", { target: button });
    expect(restartAt).not.toHaveBeenCalled();
    button.remove();
  });

  it("moves the playhead to the edges of the waveform view with Home and End", () => {
    mountTab();
    pressKey("Home");
    expect(seekToViewEdge).toHaveBeenLastCalledWith("start");
    pressKey("End");
    expect(seekToViewEdge).toHaveBeenLastCalledWith("end");
  });

  it("moves the playhead to the start of the song on the key bound to it", () => {
    mountTab();
    useSettingsStore().setTimingKey("songStart", { key: "k", code: "KeyK", ctrl: true });

    pressKey("Home", { ctrlKey: true });
    expect(seekToTrackEdge).not.toHaveBeenCalled();
    pressKey("KeyK", { ctrlKey: true });
    expect(seekToTrackEdge).toHaveBeenLastCalledWith("start");
  });

  it("moves the playhead to the ends of the song with ctrl held", () => {
    mountTab();
    pressKey("Home", { ctrlKey: true });
    expect(seekToTrackEdge).toHaveBeenLastCalledWith("start");
    pressKey("End", { ctrlKey: true });
    expect(seekToTrackEdge).toHaveBeenLastCalledWith("end");
    expect(seekToViewEdge).not.toHaveBeenCalled();
  });

  it("leaves Home and End to form controls", () => {
    mountTab();
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey("Home", { target: input });
    pressKey("End", { target: input });
    expect(seekToViewEdge).not.toHaveBeenCalled();
    input.remove();
  });

  it("plays, steps and zooms on the keys bound to them", () => {
    const wrapper = mountTab();
    const store = useSettingsStore();
    store.setTimingKey("playPause", { key: "p", code: "KeyP" });
    store.setTimingKey("seekBack", { key: "a", code: "KeyA" });
    store.setTimingKey("zoomIn", { key: "w", code: "KeyW" });

    pressKey("Space");
    pressKey("ArrowLeft");
    pressKey("ArrowUp");
    expect(togglePlayPause).not.toHaveBeenCalled();
    expect(seekBy).not.toHaveBeenCalled();

    pressKey("KeyP");
    expect(togglePlayPause).toHaveBeenCalledOnce();
    pressKey("KeyA");
    expect(seekBy).toHaveBeenCalledWith(-1);
    const zoom = wrapper.vm.zoom;
    pressKey("KeyW");
    expect(wrapper.vm.zoom).toBeGreaterThan(zoom);
  });

  it("steps five times as far with Shift and an arrow key", () => {
    mountTab();
    pressKey("ArrowLeft", { shiftKey: true });
    expect(seekBy).toHaveBeenCalledWith(-5);
    pressKey("ArrowRight", { shiftKey: true });
    expect(seekBy).toHaveBeenLastCalledWith(5);
  });

  it("steps further on the character Shift types, once it is bound to that", () => {
    mountTab();
    const store = useSettingsStore();
    store.setTimingKey("seekBack", { key: ",", code: "Comma" });
    store.setTimingKey("seekBackFar", { key: "<", code: "Comma" });

    pressKey("Comma", { key: "," });
    expect(seekBy).toHaveBeenLastCalledWith(-1);
    pressKey("Comma", { key: "<", shiftKey: true });
    expect(seekBy).toHaveBeenLastCalledWith(-5);
  });

  it("switches modes on the key in T's place when a Russian layout types е there", () => {
    const wrapper = mountTab();
    pressKey("KeyT", { key: "е" });
    expect(wrapper.vm.isTapMode).toBe(true);
  });

  it("leaves a bound key held with Ctrl to the browser, except at the view's edges", () => {
    mountTab();
    pressKey("Space", { ctrlKey: true });
    pressKey("ArrowLeft", { ctrlKey: true });
    expect(togglePlayPause).not.toHaveBeenCalled();
    expect(seekBy).not.toHaveBeenCalled();
  });

  it("leaves keys alone while a dialog is open", () => {
    mountTab();
    const modal = document.createElement("div");
    modal.className = "modal is-active";
    document.body.appendChild(modal);
    pressKey("Space");
    expect(togglePlayPause).not.toHaveBeenCalled();
    modal.remove();
  });

  it("clears the region selection on Esc", () => {
    mountTab();
    pressKey("Escape");
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it("leaves Esc to form controls", () => {
    mountTab();
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey("Escape", { target: input });
    expect(clearSelection).not.toHaveBeenCalled();
    input.remove();
  });

  it("steps by the preroll with the arrow keys, wherever the focus is", () => {
    const wrapper = mountTab();
    wrapper.vm.prerollSeconds = 2;
    pressKey("ArrowRight");
    expect(seekBy).toHaveBeenLastCalledWith(2);
    pressKey("ArrowLeft");
    expect(seekBy).toHaveBeenLastCalledWith(-2);
  });

  it("steps five prerolls at a time with shift held", () => {
    const wrapper = mountTab();
    wrapper.vm.prerollSeconds = 2;
    pressKey("ArrowRight", { shiftKey: true });
    expect(seekBy).toHaveBeenLastCalledWith(10);
    pressKey("ArrowLeft", { shiftKey: true });
    expect(seekBy).toHaveBeenLastCalledWith(-10);
  });

  it("zooms in and out around the playhead with the up and down arrows", () => {
    const wrapper = mountTab();
    pressKey("ArrowUp");
    expect(wrapper.vm.zoom).toBe(125);
    expect(anchorZoomOnPlayhead).toHaveBeenCalledOnce();
    pressKey("ArrowDown");
    expect(wrapper.vm.zoom).toBe(100);
    expect(anchorZoomOnPlayhead).toHaveBeenCalledTimes(2);
  });

  it("leaves no zoom anchor behind when the zoom is already at its limit", () => {
    const wrapper = mountTab();
    pressKey("ArrowDown");
    expect(wrapper.vm.zoom).toBe(100);
    expect(anchorZoomOnPlayhead).not.toHaveBeenCalled();
  });

  it("zooms with the up and down arrows in Tap mode too", () => {
    const wrapper = mountTab();
    wrapper.vm.setMode("tap");
    pressKey("ArrowUp");
    expect(wrapper.vm.zoom).toBe(125);
    expect(anchorZoomOnPlayhead).toHaveBeenCalledOnce();
  });

  it("keeps a preroll for each mode, of 2 s in Tap mode at first", () => {
    const wrapper = mountTab();
    expect(wrapper.vm.prerollSeconds).toBe(1);
    wrapper.vm.prerollSeconds = 3;

    wrapper.vm.setMode("tap");
    expect(wrapper.vm.prerollSeconds).toBe(2);
    wrapper.vm.prerollSeconds = 4;

    wrapper.vm.setMode("adjust");
    expect(wrapper.vm.prerollSeconds).toBe(3);
    wrapper.vm.setMode("tap");
    expect(wrapper.vm.prerollSeconds).toBe(4);
  });

  it("leaves the arrow keys to form controls", () => {
    mountTab();
    for (const tag of ["input", "select", "textarea"]) {
      const element = document.createElement(tag);
      document.body.appendChild(element);
      pressKey("ArrowRight", { target: element });
      element.remove();
    }
    expect(seekBy).not.toHaveBeenCalled();
  });

  it("takes the keys over from the player when the player has focus", () => {
    mountTab();
    const audio = document.createElement("audio");
    document.body.appendChild(audio);
    pressKey("ArrowRight", { target: audio });
    pressKey("Space", { target: audio });
    expect(seekBy).toHaveBeenCalledWith(1);
    expect(togglePlayPause).toHaveBeenCalledOnce();
    audio.remove();
  });

  // The audio element's built-in controls handle these same keys, and a bubble-phase listener runs after them:
  // verified in Chromium, where the native seek and play/pause still fired on top of ours.
  // Only a capture-phase preventDefault suppresses them.
  it("listens in the capture phase so the player cannot act first", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    mountTab();
    const keydownRegistrations = addEventListener.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownRegistrations).toHaveLength(1);
    expect(keydownRegistrations[0][2]).toBe(true);
    addEventListener.mockRestore();
  });

  it("keeps a separate replay point per voice", () => {
    const wrapper = mountTab();
    wrapper.vm.onSeek(12.5);
    // Switching voices saves the outgoing voice's state and loads the incoming one's.
    (wrapper.vm.$options.watch!.activeVoice as Function).call(wrapper.vm, "voice2", "voice1");
    pressKey("Enter");
    expect(restartAt).toHaveBeenLastCalledWith(0);

    (wrapper.vm.$options.watch!.activeVoice as Function).call(wrapper.vm, "voice1", "voice2");
    pressKey("Enter");
    expect(restartAt).toHaveBeenLastCalledWith(12.5);
  });

  describe("undo and redo", () => {
    const dragStart = (wrapper: ReturnType<typeof mountTab>) => {
      const segments = useTimingsStore().activeSegments.map((segment) => ({ ...segment }));
      segments[0] = { ...segments[0], start: 0.8 };
      wrapper.findComponent({ name: "TimingAdjuster" }).vm.$emit("segmentschange", segments);
    };

    beforeEach(() => {
      vi.mocked(isDragging).mockReturnValue(false);
    });

    it("undoes with ctrl+Z and redoes with ctrl+shift+Z or ctrl+Y", () => {
      const wrapper = mountTab();
      dragStart(wrapper);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(useTimingsStore().activeSegments[0].start).toBe(0.5);

      pressKey("KeyZ", { key: "Z", ctrlKey: true, shiftKey: true });
      expect(useTimingsStore().activeSegments[0].start).toBe(0.8);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      pressKey("KeyY", { key: "y", ctrlKey: true });
      expect(useTimingsStore().activeSegments[0].start).toBe(0.8);
    });

    it("follows the keyboard layout rather than the key's position", () => {
      const wrapper = mountTab();
      dragStart(wrapper);

      // On AZERTY, Z sits where QWERTY has W.
      pressKey("KeyW", { key: "z", ctrlKey: true });

      expect(useTimingsStore().activeSegments[0].start).toBe(0.5);
    });

    it("leaves ctrl+Z to form controls", () => {
      const wrapper = mountTab();
      dragStart(wrapper);
      const input = document.createElement("input");
      document.body.appendChild(input);

      pressKey("KeyZ", { key: "z", ctrlKey: true, target: input });

      expect(useTimingsStore().activeSegments[0].start).toBe(0.8);
      input.remove();
    });

    it("ignores the shortcuts during a drag", () => {
      const wrapper = mountTab();
      dragStart(wrapper);
      vi.mocked(isDragging).mockReturnValue(true);

      pressKey("KeyZ", { key: "z", ctrlKey: true });

      expect(useTimingsStore().activeSegments[0].start).toBe(0.8);
    });

    it("steps the history for the navbar's buttons while it is mounted", () => {
      const wrapper = mountTab();
      const stepper = useHistoryStore().tabStepper!;
      expect(stepper.tab).toBe("adjust");
      expect(stepper.canStep("undo")).toBe(false);

      dragStart(wrapper);
      expect(stepper.canStep("undo")).toBe(true);
      expect(stepper.canStep("redo")).toBe(false);

      stepper.step("undo");
      expect(stepper.canStep("undo")).toBe(false);
      expect(stepper.canStep("redo")).toBe(true);

      wrapper.unmount();
      expect(useHistoryStore().tabStepper).toBeNull();
    });
  });

  describe("lines mode", () => {
    const adjuster = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.findComponent({ name: "TimingAdjuster" });
    const linesButton = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.find('b-button-stub[title^="Drag when each line"]');

    beforeEach(() => {
      useAdvancedStore().isAdvanced = true;
    });

    it("is Adjust mode, with its button hidden, outside advanced mode, and comes back with it", async () => {
      const wrapper = mountTab();
      wrapper.vm.setMode("lines");
      useAdvancedStore().isAdvanced = false;
      await nextTick();

      expect(adjuster(wrapper).vm.$attrs.displayMode).toBe(false);
      expect(adjuster(wrapper).vm.$attrs.bands).toEqual([]);
      expect(linesButton(wrapper).exists()).toBe(false);
      useAdvancedStore().isAdvanced = true;
      await nextTick();
      expect(linesButton(wrapper).attributes("aria-pressed")).toBe("true");
      expect(adjuster(wrapper).vm.$attrs.displayMode).toBe(true);
    });

    it("hands the adjuster the line frames only in Lines mode", async () => {
      const wrapper = mountTab();
      expect(adjuster(wrapper).vm.$attrs.displayMode).toBe(false);
      expect(adjuster(wrapper).vm.$attrs.bands).toEqual([]);

      wrapper.vm.setMode("lines");
      await nextTick();

      expect(adjuster(wrapper).vm.$attrs.displayMode).toBe(true);
      expect(adjuster(wrapper).vm.$attrs.bands).toMatchObject([
        { segmentIndex: 0, text: "hello world" },
      ]);
    });

    it("stores a dragged edge on the line's first segment", () => {
      const wrapper = mountTab();
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, start: 0.25 }]);
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, end: 3 }]);

      expect(useTimingsStore().activeSegments[0]).toMatchObject({
        start: 0.5,
        displayStart: 0.25,
        displayEnd: 3,
      });
    });

    it("stores the edges of several lines as one edit, leaving out the others", () => {
      const wrapper = mountTab();
      useLyricsStore().setLyrics("hello\nworld");
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "hello\n", start: 1, end: 2 },
          { text: "world", start: 3, end: 4 },
        ],
      });
      adjuster(wrapper).vm.$emit("bands-updated", [
        { segmentIndex: 0, end: 2.5 },
        { segmentIndex: 1, end: 4.5 },
      ]);

      const [first, second] = useTimingsStore().activeSegments;
      expect(first).toMatchObject({ displayEnd: 2.5 });
      expect(second).toMatchObject({ displayEnd: 4.5 });
      expect(first.displayStart).toBeUndefined();
      expect(second.displayStart).toBeUndefined();

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(useTimingsStore().hasDisplayPeriods).toBe(false);
    });

    it("clears only the double-clicked edge", () => {
      const wrapper = mountTab();
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, start: 0.25 }]);
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, end: 3 }]);
      adjuster(wrapper).vm.$emit("band-reset", 0, "start");

      const [segment] = useTimingsStore().activeSegments;
      expect(segment.displayStart).toBeUndefined();
      expect(segment.displayEnd).toBe(3);
    });

    it("flags the lines the video shows in the same place", async () => {
      const wrapper = mountTab();
      useMediaStore().songDuration = 30;
      useLyricsStore().setLyrics("hello\n\nworld");
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "hello\n\n", start: 1, end: 2 },
          { text: "world", start: 3, end: 4 },
        ],
      });
      wrapper.vm.setMode("lines");
      await nextTick();
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, end: 3.5 }]);
      await nextTick();

      expect(adjuster(wrapper).vm.$attrs.bands).toMatchObject([
        { text: "hello", placement: { overlaps: true } },
        { text: "world", placement: { overlaps: true } },
      ]);
    });

    const resetButton = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.find('b-button-stub[aria-label="Reset line display times"]');

    it("turns the eraser into a reset of the line display times, enabled once a bound is stored", async () => {
      const wrapper = mountTab();
      expect(resetButton(wrapper).exists()).toBe(false);

      wrapper.vm.setMode("lines");
      await nextTick();
      expect(wrapper.find('b-button-stub[aria-label="Reset timings"]').exists()).toBe(false);
      expect(resetButton(wrapper).attributes("disabled")).toBe("true");

      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, start: 0.25 }]);
      await nextTick();
      expect(resetButton(wrapper).attributes("disabled")).toBe("false");
    });

    it("clears every stored bound of the voice with the eraser, which can be undone", async () => {
      const wrapper = mountTab();
      wrapper.vm.setMode("lines");
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, start: 0.25 }]);
      adjuster(wrapper).vm.$emit("bands-updated", [{ segmentIndex: 0, end: 3 }]);
      await nextTick();

      await resetButton(wrapper).trigger("click");
      expect(useTimingsStore().hasDisplayPeriods).toBe(false);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(useTimingsStore().activeSegments[0]).toMatchObject({
        displayStart: 0.25,
        displayEnd: 3,
      });
    });

    it("leaves out the timing shift", async () => {
      const wrapper = mountTab();
      const shift = () => wrapper.find('[label="Shift all timings (ms)"]');
      expect(shift().exists()).toBe(true);

      wrapper.vm.setMode("lines");
      await nextTick();
      expect(shift().exists()).toBe(false);
    });

    it("comes back on T after Tap mode, as Adjust mode does", () => {
      const wrapper = mountTab();
      wrapper.vm.setMode("lines");

      pressKey("KeyT", { key: "t" });
      expect(wrapper.vm.isTapMode).toBe(true);
      pressKey("KeyT", { key: "t" });
      expect(wrapper.vm.displayMode).toBe(true);

      wrapper.vm.setMode("adjust");
      pressKey("KeyT", { key: "t" });
      pressKey("KeyT", { key: "t" });
      expect(wrapper.vm.isAdjustMode).toBe(true);
    });

    it("opens a save from when it was a switch on Adjust mode", () => {
      localStorage.setItem(
        "adjust.state",
        JSON.stringify({ voiceState: {}, preservePitch: false, showDisplayBands: true }),
      );
      const wrapper = mountTab();

      expect(wrapper.vm.displayMode).toBe(true);
    });
  });

  describe("mix mode", () => {
    const adjuster = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.findComponent({ name: "TimingAdjuster" });
    const resetButton = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.find('b-button-stub[aria-label="Reset mute times"]');

    beforeEach(() => {
      useAdvancedStore().isAdvanced = true;
    });

    // Each voice sings one line, and Ben's second segment is untimed.
    const twoVoices = () => {
      const wrapper = mountTab();
      useMediaStore().songDuration = 30;
      useLyricsStore().setLyrics("[Anna] hello\n[Ben] wide_world");
      useTimingsStore().setAllSegments({
        Anna: [{ text: "hello", start: 1, end: 2 }],
        Ben: [{ text: "wide_", start: 5, end: 6 }, { text: "world" }],
      });
      wrapper.vm.setMode("mix");
      return wrapper;
    };

    it("hands the adjuster each line's frame with how far its edges can go", async () => {
      const wrapper = twoVoices();
      await nextTick();

      expect(adjuster(wrapper).vm.$attrs.mixFrames).toMatchObject([
        { voice: "Anna", segmentIndex: 0, latestStart: 1.2, earliestEnd: 2, startStored: false },
        { voice: "Ben", segmentIndex: 0, latestStart: 5.2, earliestEnd: 6, endStored: false },
      ]);
    });

    it("stores a dragged edge in the line's own voice, and clears it on a double-click", async () => {
      const wrapper = twoVoices();
      await nextTick();
      const [, ben] = adjuster(wrapper).vm.$attrs.mixFrames as MixFrame[];

      adjuster(wrapper).vm.$emit("mute-updated", ben, "start", 4);
      adjuster(wrapper).vm.$emit("mute-updated", ben, "end", 8);
      expect(useTimingsStore().timedSegmentsForVoice("Ben")[0]).toMatchObject({
        muteStart: 4,
        muteEnd: 8,
      });
      expect(useTimingsStore().timedSegmentsForVoice("Anna")[0].muteStart).toBeUndefined();

      await nextTick();
      const [, stored] = adjuster(wrapper).vm.$attrs.mixFrames as MixFrame[];
      expect(stored).toMatchObject({ start: 4, end: 8, startStored: true, endStored: true });
      adjuster(wrapper).vm.$emit("mute-reset", stored, "start");
      expect(useTimingsStore().timedSegmentsForVoice("Ben")[0]).toMatchObject({ muteEnd: 8 });
      expect(useTimingsStore().timedSegmentsForVoice("Ben")[0].muteStart).toBeUndefined();
    });

    it("resets every voice's mute times with the eraser, which can be undone", async () => {
      const wrapper = twoVoices();
      await nextTick();
      expect(wrapper.find('b-button-stub[aria-label="Reset timings"]').exists()).toBe(false);
      expect(resetButton(wrapper).attributes("disabled")).toBe("true");

      const [anna, ben] = adjuster(wrapper).vm.$attrs.mixFrames as MixFrame[];
      adjuster(wrapper).vm.$emit("mute-updated", anna, "end", 3);
      adjuster(wrapper).vm.$emit("mute-updated", ben, "start", 4);
      await nextTick();
      expect(resetButton(wrapper).attributes("disabled")).toBe("false");

      await resetButton(wrapper).trigger("click");
      expect(useTimingsStore().hasMuteBounds).toBe(false);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(useTimingsStore().timedSegmentsForVoice("Anna")[0].muteEnd).toBe(3);
      expect(useTimingsStore().timedSegmentsForVoice("Ben")[0].muteStart).toBe(4);
    });
  });

  describe("Preserve pitch", () => {
    it("is on for a first visit", () => {
      expect(mountTab().vm.preservePitch).toBe(true);
    });

    it("turns on once for a save from when it was off by default", () => {
      localStorage.setItem(
        "adjust.state",
        JSON.stringify({ voiceState: {}, preservePitch: false }),
      );

      expect(mountTab().vm.preservePitch).toBe(true);
    });

    it("stays off once turned off since", () => {
      localStorage.setItem(
        "adjust.state",
        JSON.stringify({ version: 2, voiceState: {}, preservePitch: false }),
      );

      expect(mountTab().vm.preservePitch).toBe(false);
    });
  });

  describe("tap mode", () => {
    const adjuster = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.findComponent({ name: "TimingAdjuster" });

    // Two lines, "ka den" and "lu so", timed and open-ended.
    function mountTapTab() {
      const wrapper = mountTab();
      useLyricsStore().setLyrics("ka_den\nlu so");
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "ka_", start: 1 },
          { text: "den\n", start: 2 },
          { text: "lu ", start: 5 },
          { text: "so", start: 6 },
        ],
      });
      wrapper.vm.setMode("tap");
      return wrapper;
    }

    const starts = () => useTimingsStore().activeSegments.map((segment) => segment.start);

    const tap = (code: string, time: number) => {
      playback.time = time;
      pressKey(code);
    };

    // A click on a region or a queued segment, which makes the segment the head.
    const pick = (wrapper: ReturnType<typeof mountTab>, index: number) => {
      adjuster(wrapper).vm.$emit("segment-picked", index);
    };

    const pausePlayback = (wrapper: ReturnType<typeof mountTab>) => {
      playback.paused = true;
      adjuster(wrapper).vm.$emit("pause");
    };

    it("is enabled with lyrics and no timings, and opens in Tap mode then", () => {
      const mediaStore = useMediaStore();
      mediaStore.songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: { stubs: { TimingAdjuster: timingAdjusterStub } },
      });
      mountedTabs.push(wrapper);

      expect(wrapper.vm.isEnabled).toBe(true);
      expect(wrapper.vm.isTapMode).toBe(true);
      expect(wrapper.find(".timing-adjuster-stub").exists()).toBe(true);
    });

    it("shows an empty preview before there are any timings", () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: { stubs: { TimingAdjuster: timingAdjusterStub } },
      });
      mountedTabs.push(wrapper);

      const preview = wrapper.findComponent({ name: "SubtitleDisplay" });
      expect(preview.exists()).toBe(true);
      expect(preview.props("subtitles")).toBe("");
    });

    it("leaves Tap mode once timings arrive from elsewhere, unless it was chosen", () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: { stubs: { TimingAdjuster: timingAdjusterStub } },
      });
      mountedTabs.push(wrapper);
      expect(wrapper.vm.isTapMode).toBe(true);

      useTimingsStore().resetTimings([[0.5, LYRIC_MARKERS.SEGMENT_START]]);

      expect(wrapper.vm.isTapMode).toBe(false);
    });

    it("stays in Tap mode after the first pass over a voice with no timings", () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: { stubs: { TimingAdjuster: timingAdjusterStub } },
      });
      Object.defineProperty(wrapper.vm.$el, "offsetParent", { value: document.body });
      mountedTabs.push(wrapper);
      playback.paused = false;
      tap("Space", 0.5);

      pausePlayback(wrapper);

      expect(useTimingsStore().activeSegments[0].start).toBe(0.5);
      expect(wrapper.vm.isTapMode).toBe(true);
    });

    it("switches modes with T", () => {
      const wrapper = mountTab();
      pressKey("KeyT", { key: "t" });
      expect(wrapper.vm.isTapMode).toBe(true);
      pressKey("KeyT", { key: "T", shiftKey: true });
      expect(wrapper.vm.isTapMode).toBe(false);
    });

    it("switches modes on the letter T, wherever the layout puts it", () => {
      const wrapper = mountTab();
      // Bépo puts "è" where QWERTY has T, and T where QWERTY has J.
      pressKey("KeyT", { key: "è" });
      expect(wrapper.vm.isTapMode).toBe(false);
      pressKey("KeyJ", { key: "t" });
      expect(wrapper.vm.isTapMode).toBe(true);
    });

    it("switches modes on the key bound to it", () => {
      const wrapper = mountTab();
      useSettingsStore().setTimingKey("switchMode", { key: "m", code: "KeyM" });
      pressKey("KeyT", { key: "t" });
      expect(wrapper.vm.isTapMode).toBe(false);
      pressKey("KeyM", { key: "m" });
      expect(wrapper.vm.isTapMode).toBe(true);
    });

    it("draws the regions without handles or selection", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      expect(adjuster(wrapper).vm.$attrs.tapMode).toBe(true);
    });

    it("plays from wherever the playhead was left on the start key while paused", () => {
      const wrapper = mountTapTab();
      wrapper.vm.prerollSeconds = 2;
      pick(wrapper, 2);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(3);

      pressKey("Space");
      expect(togglePlayPause).toHaveBeenCalledOnce();
      expect(restartAt).not.toHaveBeenCalled();
    });

    it("cues the playhead to the head's preroll when the redo key moves it while paused", () => {
      const wrapper = mountTapTab();
      wrapper.vm.prerollSeconds = 1;
      pick(wrapper, 3);
      pressKey("Backspace");
      expect(wrapper.vm.tapHead).toBe(2);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(4);
      expect(togglePlayPause).not.toHaveBeenCalled();
    });

    it("cues the playhead to the preroll before the tap an undo takes back while paused", () => {
      const wrapper = mountTapTab();
      wrapper.vm.prerollSeconds = 1;
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.5);
      pausePlayback(wrapper);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(wrapper.vm.tapHead).toBe(2);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(4.5);
      expect(restartAt).not.toHaveBeenCalled();
    });

    it("stages the taps, and writes each as its own edit when playback pauses", async () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);
      tap("Space", 6.3);
      tap("Enter", 6.8);

      expect(starts()).toEqual([1, 2, 5, 6]);
      await nextTick();
      expect(adjuster(wrapper).vm.$attrs.segments).toMatchObject([
        { start: 1 },
        { start: 2 },
        { start: 5.2 },
        { start: 6.3, end: 6.8 },
      ]);

      pausePlayback(wrapper);
      expect(starts()).toEqual([1, 2, 5.2, 6.3]);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(useTimingsStore().activeSegments[3]).toEqual({ text: "so", start: 6.3 });
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(starts()).toEqual([1, 2, 5.2, 6]);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(starts()).toEqual([1, 2, 5, 6]);
    });

    it("ends the segment before the head on the end key, before any start tap", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Enter", 3);

      pausePlayback(wrapper);

      expect(useTimingsStore().activeSegments[1]).toMatchObject({ start: 2, end: 3 });
    });

    it("ends the segment before the pass's first tap after that tap is undone", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 3);
      playback.paused = false;
      tap("Space", 6.3);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      tap("Enter", 5.8);

      pausePlayback(wrapper);

      expect(useTimingsStore().activeSegments.slice(2)).toMatchObject([
        { start: 5, end: 5.8 },
        { start: 6 },
      ]);
    });

    it("clears every timing of the voice as one edit that can be undone", async () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      await wrapper.find('b-button-stub[aria-label="Reset timings"]').trigger("click");

      expect(starts()).toEqual([undefined, undefined, undefined, undefined]);
      expect(wrapper.vm.tapHead).toBe(0);
      await nextTick();
      expect(wrapper.find('b-button-stub[aria-label="Reset timings"]').attributes("disabled")).toBe(
        "true",
      );

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(starts()).toEqual([1, 2, 5, 6]);
    });

    it("writes a pass that is running before clearing the timings", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);

      wrapper.vm.resetTimings();

      expect(starts()).toEqual([undefined, undefined, undefined, undefined]);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(starts()).toEqual([1, 2, 5.2, 6]);
    });

    it("shows the help for the mode it is in", async () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      useTimingsStore().resetTimings([[0.5, LYRIC_MARKERS.SEGMENT_START]]);
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: {
          stubs: {
            TimingAdjuster: timingAdjusterStub,
            HelpSection: { template: '<div class="help"><slot /></div>' },
          },
        },
      });
      mountedTabs.push(wrapper);

      expect(wrapper.find(".help").text()).toContain("Drag the left edge");
      wrapper.vm.setMode("tap");
      await nextTick();
      expect(wrapper.find(".help").text()).toContain("tap along");
      expect(wrapper.find(".help").text()).not.toContain("Drag the left edge");
    });

    it("shows the legacy Timing tab from a switch in the Tap mode help, off at first", async () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("hello world");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: {
          stubs: {
            TimingAdjuster: timingAdjusterStub,
            HelpSection: { template: '<div class="help"><slot /></div>' },
          },
        },
      });
      mountedTabs.push(wrapper);
      const legacy = useLegacyTimingStore();
      expect(legacy.isShown).toBe(false);

      const toggle = wrapper.find(".legacy-tab-switch").findComponent({ name: "BSwitch" });
      toggle.vm.$emit("update:modelValue", true);

      expect(legacy.isShown).toBe(true);
    });

    it("writes a pass in progress and saves it when the page is left", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);

      window.dispatchEvent(new Event("pagehide"));

      expect(wrapper.vm.pass).toBeNull();
      expect(starts()).toEqual([1, 2, 5.2, 6]);
      const saved = JSON.parse(localStorage.getItem("timings._segments")!);
      expect(saved[DEFAULT_VOICE_ID][2].start).toBe(5.2);
      expect(
        JSON.parse(localStorage.getItem("adjust.state")!).voiceState[DEFAULT_VOICE_ID].tapHead,
      ).toBe(3);
    });

    it("hands the head and the pass's taps to the waveform, which fades the rest as ghosts", async () => {
      const wrapper = mountTapTab();
      pick(wrapper, 1);
      playback.paused = false;
      tap("Space", 2.2);
      await nextTick();

      expect(adjuster(wrapper).vm.$attrs.head).toBe(2);
      expect(adjuster(wrapper).vm.$attrs.tapped).toEqual([1]);

      pausePlayback(wrapper);
      await nextTick();
      expect(adjuster(wrapper).vm.$attrs.tapped).toEqual([]);
    });

    it("taps from the on-screen buttons, shown from the keyboard toggle", async () => {
      const wrapper = mountTapTab();
      wrapper.vm.showTapButtons = false;
      await nextTick();
      expect(wrapper.findComponent({ name: "TapButtons" }).exists()).toBe(false);

      await wrapper.find('b-button-stub[aria-label="Timing buttons"]').trigger("click");
      const buttons = wrapper.findComponent({ name: "TapButtons" });
      pick(wrapper, 2);
      playback.paused = false;
      playback.time = 5.2;
      buttons.vm.$emit("start");
      playback.time = 5.6;
      buttons.vm.$emit("end");
      pausePlayback(wrapper);

      expect(useTimingsStore().activeSegments[2]).toMatchObject({ start: 5.2, end: 5.6 });
      buttons.vm.$emit("play-pause");
      expect(togglePlayPause).toHaveBeenCalledOnce();
    });

    it("says it's almost done once every segment has a start, and done once the last one ends", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      expect(wrapper.vm.timingStatus).toBe("almost");
      expect(wrapper.findComponent({ name: "BMessage" }).attributes("type")).toBe("is-warning");

      pick(wrapper, 3);
      playback.paused = false;
      tap("Space", 6.2);
      tap("Enter", 6.8);
      await nextTick();
      expect(wrapper.vm.timingStatus).toBe("done");
      expect(wrapper.findComponent({ name: "BMessage" }).attributes("type")).toBe("is-success");
    });

    it("tucks a message away as an icon, which brings it back", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      wrapper.vm.tuckStatusMessage();
      await nextTick();
      expect(wrapper.findComponent({ name: "BMessage" }).exists()).toBe(false);
      const icon = wrapper.find(".status-icon");
      expect(icon.attributes("aria-label")).toBe("Almost done");

      await icon.trigger("click");
      expect(wrapper.findComponent({ name: "BMessage" }).exists()).toBe(true);
      expect(wrapper.find(".status-icon").exists()).toBe(false);
    });

    it("keeps the message tucked away in Adjust mode, where only Done shows", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      wrapper.vm.tuckStatusMessage();
      wrapper.vm.setMode("adjust");
      await nextTick();
      expect(wrapper.vm.timingStatus).toBeNull();

      wrapper.vm.setMode("tap");
      await nextTick();
      expect(wrapper.find(".status-icon").attributes("aria-label")).toBe("Almost done");

      pick(wrapper, 3);
      playback.paused = false;
      tap("Space", 6.2);
      tap("Enter", 6.8);
      pausePlayback(wrapper);
      wrapper.vm.tuckStatusMessage();
      wrapper.vm.setMode("adjust");
      await nextTick();
      expect(wrapper.vm.timingStatus).toBe("done");
      expect(wrapper.findComponent({ name: "BMessage" }).exists()).toBe(false);
      expect(wrapper.find(".status-icon").attributes("aria-label")).toBe("Done");
    });

    it("shows a tucked-away message again once the status changes", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      wrapper.vm.tuckStatusMessage();
      pick(wrapper, 3);
      playback.paused = false;
      tap("Space", 6.2);
      tap("Enter", 6.8);
      await nextTick();
      expect(wrapper.findComponent({ name: "BMessage" }).attributes("type")).toBe("is-success");
    });

    it("keeps the pass and the head on a click on the waveform", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);

      wrapper.vm.onSeek(1.5);

      expect(wrapper.vm.pass).not.toBeNull();
      expect(wrapper.vm.tapHead).toBe(3);
      expect(starts()).toEqual([1, 2, 5, 6]);
    });

    it("keeps the pass through the seek of its own replay", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      wrapper.vm.prerollSeconds = 2;
      playback.paused = false;
      tap("Space", 5.2);
      pressKey("Backspace");
      expect(restartAt).toHaveBeenLastCalledWith(3.2);

      wrapper.vm.onSeek(3.2);

      expect(wrapper.vm.pass).not.toBeNull();
      expect(wrapper.vm.tapHead).toBe(2);
    });

    it("moves the head back a line on the redo key while paused", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      pressKey("Backspace");
      expect(wrapper.vm.tapHead).toBe(0);
      expect(restartAt).not.toHaveBeenCalled();
    });

    it("pauses on Esc, which ends the pass", () => {
      mountTapTab();
      playback.paused = false;
      pressKey("Escape");
      expect(pause).toHaveBeenCalledOnce();
      expect(clearSelection).not.toHaveBeenCalled();
    });

    it("takes back only the last tap on undo while playing, and replays from before it", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      wrapper.vm.prerollSeconds = 2;
      playback.paused = false;
      tap("Space", 5.2);
      tap("Space", 6.3);

      pressKey("KeyZ", { key: "z", ctrlKey: true });

      expect(restartAt).toHaveBeenLastCalledWith(6.3 - 2);
      expect(wrapper.vm.tapHead).toBe(3);
      expect(wrapper.vm.pass?.staged[3].start).toBe(6);
      expect(starts()).toEqual([1, 2, 5, 6]);

      // The replay's own seek keeps the pass going.
      wrapper.vm.onSeek(6.3 - 2);
      pausePlayback(wrapper);
      expect(starts()).toEqual([1, 2, 5.2, 6]);
    });

    it("goes on to the taps of earlier passes on undo while playing", () => {
      const wrapper = mountTapTab();
      wrapper.vm.prerollSeconds = 1;
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.5);
      pausePlayback(wrapper);
      playback.paused = false;

      pressKey("KeyZ", { key: "z", ctrlKey: true });

      expect(starts()).toEqual([1, 2, 5, 6]);
      expect(wrapper.vm.tapHead).toBe(2);
      expect(restartAt).toHaveBeenLastCalledWith(4.5);
    });

    it("waits for a pause to redo", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);
      pausePlayback(wrapper);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(starts()).toEqual([1, 2, 5, 6]);

      playback.paused = false;
      pressKey("KeyZ", { key: "z", ctrlKey: true, shiftKey: true });
      expect(starts()).toEqual([1, 2, 5, 6]);

      playback.paused = true;
      pressKey("KeyZ", { key: "z", ctrlKey: true, shiftKey: true });
      expect(starts()).toEqual([1, 2, 5.2, 6]);
    });

    it("keeps the head on the next segment to tap when a pass stops mid-line", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);

      pausePlayback(wrapper);

      expect(wrapper.vm.tapHead).toBe(3);
    });

    it("keeps the pass and the head when the arrow keys rewind the song", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);
      tap("Space", 6.3);

      pressKey("ArrowLeft");
      wrapper.vm.onSeek(5.3);

      expect(wrapper.vm.pass).not.toBeNull();
      expect(wrapper.vm.tapHead).toBe(4);
      expect(starts()).toEqual([1, 2, 5, 6]);
    });

    it("keeps the head when the arrow keys move the song while paused", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 3);

      pressKey("ArrowLeft", { shiftKey: true });
      wrapper.vm.onSeek(1.2);

      expect(wrapper.vm.tapHead).toBe(3);
    });

    it("makes a clicked region the head, and moves the playhead to the preroll before it", () => {
      const wrapper = mountTapTab();
      wrapper.vm.prerollSeconds = 2;
      pick(wrapper, 3);
      expect(wrapper.vm.tapHead).toBe(3);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(4);
      expect(restartAt).not.toHaveBeenCalled();
    });

    it("goes back to the last timed segment with no end when an untimed one is clicked", () => {
      const wrapper = mountTapTab();
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "ka_", start: 1 },
          { text: "den\n", start: 3 },
          { text: "lu " },
          { text: "so" },
        ],
      });
      wrapper.vm.prerollSeconds = 1;

      pick(wrapper, 3);

      expect(wrapper.vm.tapHead).toBe(1);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(2);
    });

    it("goes to the segment after the last timed one when that one has an end", () => {
      const wrapper = mountTapTab();
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "ka_", start: 1 },
          { text: "den\n", start: 3, end: 4 },
          { text: "lu " },
          { text: "so" },
        ],
      });
      wrapper.vm.prerollSeconds = 1;

      pick(wrapper, 3);

      expect(wrapper.vm.tapHead).toBe(2);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(3);
    });

    it("goes back to the first segment when one is clicked on a voice with no timings", () => {
      const wrapper = mountTapTab();
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [{ text: "ka_" }, { text: "den\n" }, { text: "lu " }, { text: "so" }],
      });
      wrapper.vm.tapHead = 2;

      pick(wrapper, 3);

      expect(wrapper.vm.tapHead).toBe(0);
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(0);
    });

    it("keeps the taps made so far when a region is clicked during a pass", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);
      tap("Space", 6.3);

      pick(wrapper, 2);

      expect(wrapper.vm.pass?.head).toBe(2);
      expect(wrapper.vm.pass?.staged[3].start).toBe(6.3);
      pausePlayback(wrapper);
      expect(starts()).toEqual([1, 2, 5.2, 6.3]);
    });

    it("follows the segment it was on when a segment before it is split in the lyrics", async () => {
      const wrapper = mountTapTab();
      await nextTick();
      pick(wrapper, 3);

      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "ka_", start: 1 },
          { text: "den\n", start: 2 },
          { text: "l/", start: 5 },
          { text: "u " },
          { text: "so", start: 6 },
        ],
      });
      await nextTick();

      expect(wrapper.vm.tapHead).toBe(4);
    });

    it("queues the segments from the head, marking the head, word joins, line ends and timings", async () => {
      const wrapper = mountTapTab();
      useLyricsStore().setLyrics("ka/den\nlu so");
      useTimingsStore().setAllSegments({
        [DEFAULT_VOICE_ID]: [
          { text: "ka/", start: 1 },
          { text: "den\n", start: 2, end: 2.5 },
          { text: "lu ", start: 5 },
          { text: "so" },
        ],
      });
      pick(wrapper, 0);
      await nextTick();

      // "ka" is closed by the start of "den", "den" by its own end, and nothing closes "lu".
      expect(adjuster(wrapper).vm.$attrs.queue).toEqual([
        { index: 0, text: "ka", isHead: true, joinsNext: true, endsLine: false, timing: "full" },
        { index: 1, text: "den", isHead: false, joinsNext: false, endsLine: true, timing: "full" },
        { index: 2, text: "lu", isHead: false, joinsNext: false, endsLine: false, timing: "start" },
        { index: 3, text: "so", isHead: false, joinsNext: false, endsLine: false, timing: "none" },
      ]);

      playback.paused = false;
      tap("Space", 1.1);
      await nextTick();
      expect(adjuster(wrapper).vm.$attrs.queue).toMatchObject([
        { text: "den", isHead: true },
        {},
        {},
      ]);
    });

    it("queues each tap again as it is undone, across passes", () => {
      const wrapper = mountTapTab();
      pick(wrapper, 2);
      playback.paused = false;
      tap("Space", 5.2);
      tap("Space", 6.1);
      pausePlayback(wrapper);
      pick(wrapper, 0);
      playback.paused = false;
      tap("Space", 1.2);
      pausePlayback(wrapper);
      expect(wrapper.vm.tapHead).toBe(1);
      wrapper.vm.tapHead = 3;

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(wrapper.vm.tapHead).toBe(0);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(wrapper.vm.tapHead).toBe(3);
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(wrapper.vm.tapHead).toBe(2);
    });

    it("queues the first segment again once every tap over a fresh voice is undone", () => {
      useMediaStore().songFile = new File(["audio"], "song.mp3", { type: "audio/mp3" });
      useLyricsStore().setLyrics("ka_den\nlu so");
      const wrapper = shallowMount(TimingAdjustmentTab, {
        global: { stubs: { TimingAdjuster: timingAdjusterStub } },
      });
      Object.defineProperty(wrapper.vm.$el, "offsetParent", { value: document.body });
      mountedTabs.push(wrapper);
      playback.paused = false;
      tap("Space", 0.5);
      tap("Space", 1);
      tap("Space", 2);
      pausePlayback(wrapper);
      expect(wrapper.vm.tapHead).toBe(3);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      pressKey("KeyZ", { key: "z", ctrlKey: true });
      pressKey("KeyZ", { key: "z", ctrlKey: true });

      expect(useTimingsStore().activeSegments.some((s) => s.start !== undefined)).toBe(false);
      expect(wrapper.vm.tapHead).toBe(0);
    });

    it("keeps Space and Enter for playback in Adjust mode", () => {
      mountTab();
      pressKey("Space");
      pressKey("Enter");
      expect(togglePlayPause).toHaveBeenCalledOnce();
      expect(restartAt).toHaveBeenCalledOnce();
    });
  });
  describe("segments to review", () => {
    const mountFlagged = () => {
      const wrapper = mountTab();
      useLyricsStore().setLyrics("one_two_three_four");
      useTimingsStore().resetSegments([
        { text: "one_", start: 1 },
        { text: "two_", start: 2, review: "moved" },
        { text: "three_", start: 3 },
        { text: "four", review: "lost" },
      ]);
      return wrapper;
    };
    const select = (wrapper: ReturnType<typeof mountTab>, indices: number[]) =>
      wrapper.findComponent({ name: "TimingAdjuster" }).vm.$emit("selection-change", indices);
    const markButton = (wrapper: ReturnType<typeof mountTab>) =>
      wrapper.find('[label="Mark as checked"]');

    it("isn't done until the last flag is cleared", async () => {
      const wrapper = mountTab();
      useTimingsStore().resetSegments([
        { text: "hello world", start: 0.5, end: 1.5, review: "moved" },
      ]);
      await nextTick();
      expect(wrapper.vm.timingStatus).toBeNull();

      useTimingsStore().resetSegments([{ text: "hello world", start: 0.5, end: 1.5 }]);
      await nextTick();
      expect(wrapper.vm.timingStatus).toBe("done");
    });

    it("goes to the next and previous ones in order, wrapping around", async () => {
      const wrapper = mountFlagged();
      await nextTick();

      pressKey("KeyN", { key: "n" });
      expect(selectSegment).toHaveBeenLastCalledWith(1);
      select(wrapper, [1]);
      pressKey("KeyN", { key: "n" });
      expect(selectSegment).toHaveBeenLastCalledWith(3);
      select(wrapper, [3]);
      pressKey("KeyN", { key: "n" });
      expect(selectSegment).toHaveBeenLastCalledWith(1);
      select(wrapper, [1]);
      pressKey("KeyN", { key: "N", shiftKey: true });
      expect(selectSegment).toHaveBeenLastCalledWith(3);
    });

    it("moves the playhead to the preroll before the one it goes to", async () => {
      const wrapper = mountFlagged();
      wrapper.vm.prerollSeconds = 0.5;
      await nextTick();

      pressKey("KeyN", { key: "n" });
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(1.5);
      select(wrapper, [1]);
      pressKey("KeyN", { key: "n" });
      // The lost syllable has no place in time, so its preroll counts back from the one before.
      expect(setAudioPlayhead).toHaveBeenLastCalledWith(2.5);
    });

    it("counts them by the heading", async () => {
      const wrapper = mountFlagged();
      await nextTick();

      expect(wrapper.find(".review-count").attributes("title")).toBe("2 syllables to review");
    });

    it("shows Mark as checked only for a selection holding one", async () => {
      const wrapper = mountFlagged();
      await nextTick();
      expect(markButton(wrapper).exists()).toBe(false);

      select(wrapper, [0]);
      await nextTick();
      expect(markButton(wrapper).exists()).toBe(false);

      select(wrapper, [0, 1]);
      await nextTick();
      expect(markButton(wrapper).exists()).toBe(true);
    });

    it("clears the selected flags with C, and an undo brings them back", async () => {
      const wrapper = mountFlagged();
      select(wrapper, [1, 2, 3]);
      await nextTick();

      pressKey("KeyC", { key: "c" });
      const timings = useTimingsStore();
      expect(timings.activeSegments.map(({ review }) => review)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(timings.activeSegments[1].start).toBe(2);

      pressKey("KeyZ", { key: "z", ctrlKey: true });
      expect(timings.activeSegments[1].review).toBe("moved");
    });

    it("goes to the next one once the selection is marked as checked", async () => {
      const wrapper = mountFlagged();
      select(wrapper, [1]);
      await nextTick();

      pressKey("KeyC", { key: "c" });
      expect(selectSegment).toHaveBeenLastCalledWith(3);

      select(wrapper, [3]);
      await nextTick();
      selectSegment.mockClear();
      pressKey("KeyC", { key: "c" });
      expect(selectSegment).not.toHaveBeenCalled();
    });

    it("makes the next one the head with N in Tap mode, and leaves C alone", async () => {
      const wrapper = mountFlagged();
      wrapper.vm.setMode("tap");
      wrapper.vm.tapHead = 0;
      select(wrapper, [1]);
      await nextTick();

      pressKey("KeyN", { key: "n" });
      pressKey("KeyC", { key: "c" });

      expect(wrapper.vm.tapHead).toBe(1);
      expect(selectSegment).not.toHaveBeenCalled();
      expect(useTimingsStore().activeSegments[1].review).toBe("moved");
    });

    it("lets a tap key bound to N tap instead", async () => {
      const wrapper = mountFlagged();
      useSettingsStore().setTimingKey("start", { key: "n", code: "KeyN" });
      wrapper.vm.setMode("tap");
      wrapper.vm.tapHead = 0;
      await nextTick();

      pressKey("KeyN", { key: "n" });

      expect(togglePlayPause).toHaveBeenCalledOnce();
      expect(wrapper.vm.tapHead).toBe(0);
    });

    it("goes to the first one when the toast asks", async () => {
      mountFlagged();
      await nextTick();

      useTimingsStore().requestReview();
      await nextTick();

      expect(selectSegment).toHaveBeenLastCalledWith(1);
    });
  });
});
