import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ref } from "vue";
import { resumeSeparation, separateTrack } from "@/lib/audio";
import { persistJsonRef, takeLegacyBlob } from "@/lib/persistence";
import { useSettingsStore } from "@/stores/settings";
import {
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  TrackPair,
  useMediaStore,
} from "./media";

vi.mock("@/lib/audio", () => ({
  separateTrack: vi.fn(),
  resumeSeparation: vi.fn(),
}));

vi.mock("@/jsmediatags.min.js", () => ({
  default: {
    read: (_file: File, { onSuccess }: { onSuccess: (tag: unknown) => void }) =>
      onSuccess({ tags: {} }),
  },
}));

vi.mock("@/lib/persistence", () => ({
  persistJsonRef: vi.fn(),
  persistBlobRef: vi.fn().mockResolvedValue(undefined),
  clearPersistence: vi.fn().mockResolvedValue(undefined),
  takeLegacyBlob: vi.fn().mockResolvedValue(undefined),
}));

const SONG = new File(["audio data"], "test.mp3", { type: "audio/mp3" });
const TRACK = { backing: new Blob(["backing"]), vocals: new Blob(["vocals"]) };
const PAIR: TrackPair = { source: BACKING_VOCALS_SEPARATOR_MODEL, ...TRACK };

// Resolves once the store has read its saved files back, after which a new song counts as a change.
function hydrated() {
  return new Promise((resolve) => setTimeout(resolve));
}

// Resolves once the separation has been asked for, so a test can act on the signal the store handed it.
function pendingSeparation() {
  let signal: AbortSignal;
  const started = new Promise<AbortSignal>((resolve) => {
    (separateTrack as any).mockImplementation(
      (_file: File, _model: string, _onProgress: unknown, abortSignal: AbortSignal) => {
        signal = abortSignal;
        resolve(abortSignal);
        return new Promise((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        });
      },
    );
  });
  return started;
}

describe("Media Store separation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("joins a separation already in flight instead of starting a second one", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValue(TRACK);

    const [first, second] = await Promise.all([
      store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL),
      store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL),
    ]);

    expect(separateTrack).toHaveBeenCalledTimes(1);
    expect(first).toBe(TRACK);
    expect(second).toBe(TRACK);
  });

  it("stops the separation when it is cancelled", async () => {
    const store = useMediaStore();
    const started = pendingSeparation();

    const running = store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    const signal = await started;
    expect(store.isProcessing).toBe(true);

    store.cancelSeparation();

    expect(signal.aborted).toBe(true);
    expect(store.isProcessing).toBe(false);
    await expect(running).resolves.toBeUndefined();
    // A cancel is not a failure, so there is nothing to report to the user.
    expect(store.error).toBeNull();
  });

  it("separates again after a cancel", async () => {
    const store = useMediaStore();
    const started = pendingSeparation();

    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    await started;
    store.cancelSeparation();
    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(separateTrack).toHaveBeenCalledTimes(2);
    expect(store.isProcessing).toBe(true);
  });

  it("discards the separated track and calls off the run that would replace it", async () => {
    const store = useMediaStore();
    const started = pendingSeparation();
    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    const signal = await started;
    store.trackPairs = [PAIR];
    store.backingTrackFile = new File(["backing"], "backing.wav");
    store.vocalTrackFile = new File(["vocals"], "vocals.wav");

    store.discardSeparatedTrack();

    expect(signal.aborted).toBe(true);
    expect(store.separatedTrack).toBeNull();
    expect(store.backingTrackFile).toBeNull();
    expect(store.vocalTrackFile).toBeNull();
    expect(store.hasSeparatedTrack).toBe(false);
  });

  it("discards the tracks of the previous song when the song changes, but keeps the background", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        async decodeAudioData(_data: ArrayBuffer, onSuccess: (buffer: AudioBuffer) => void) {
          onSuccess({ duration: 1 } as AudioBuffer);
        }
      },
    );
    const store = useMediaStore();
    await hydrated();
    const started = pendingSeparation();
    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    const signal = await started;
    store.trackPairs = [PAIR];
    store.backingTrackFile = new File(["backing"], "backing.wav");
    const video = new Blob(["video"]);
    store.background = video;
    store.backgroundVideoOffset = -0.5;

    store.songFile = new File(["other audio"], "other.mp3");

    expect(signal.aborted).toBe(true);
    expect(store.separatedTrack).toBeNull();
    expect(store.backingTrackFile).toBeNull();
    expect(store.background).toBe(video);
    expect(store.backgroundVideoOffset).toBe(-0.5);
    await store.metadataSettled();
    vi.unstubAllGlobals();
  });

  it("turns the background on when a new one arrives", async () => {
    const store = useMediaStore();
    const settings = useSettingsStore();
    await hydrated();
    settings.videoOptions.useBackground = false;

    store.background = new File(["image"], "sunset.png", { type: "image/png" });

    expect(settings.videoOptions.useBackground).toBe(true);
  });

  it("resets the background video's offset when a new background arrives", async () => {
    const store = useMediaStore();
    await hydrated();
    store.background = new Blob(["video"]);
    store.backgroundVideoOffset = 0.75;

    store.background = new Blob(["other video"]);

    expect(store.backgroundVideoOffset).toBe(0);
  });

  it("keeps the tracks that are restored along with the song", () => {
    const store = useMediaStore();
    store.trackPairs = [PAIR];

    store.songFile = SONG;

    expect(store.trackPairs).toEqual([PAIR]);
  });

  it("reports an uploaded track alone as a separated track", async () => {
    const store = useMediaStore();

    expect(store.hasSeparatedTrack).toBe(false);
    store.replaceUploadedTrack("backing", null, new File(["backing"], "backing.wav"));

    expect(store.hasSeparatedTrack).toBe(true);
  });

  it("reports a separation that failed", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockRejectedValue(new Error("Separator ran out of memory"));

    const result = await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(result).toBeUndefined();
    expect(store.error).toBe("Separator ran out of memory");
    expect(store.isProcessing).toBe(false);
  });
});

describe("Media Store track pairs", () => {
  const OTHER = { backing: new Blob(["other backing"]), vocals: new Blob(["other vocals"]) };

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("keeps the tracks of each model side by side", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValueOnce(TRACK).mockResolvedValueOnce(OTHER);

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    await store.startSeparation(SONG, NO_VOCALS_SEPARATOR_MODEL);

    expect(store.vocalSources).toEqual([BACKING_VOCALS_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL]);
    expect(store.trackFor("vocals", BACKING_VOCALS_SEPARATOR_MODEL)).toBe(TRACK.vocals);
    expect(store.trackFor("backing", NO_VOCALS_SEPARATOR_MODEL)).toBe(OTHER.backing);
  });

  it("renders with the latest backing track until one is picked", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValueOnce(TRACK).mockResolvedValueOnce(OTHER);
    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    await store.startSeparation(SONG, NO_VOCALS_SEPARATOR_MODEL);

    expect(store.separatedTrack?.source).toBe(NO_VOCALS_SEPARATOR_MODEL);
    store.renderTrackSource = BACKING_VOCALS_SEPARATOR_MODEL;

    expect(store.separatedTrack?.backing).toBe(TRACK.backing);
  });

  it("replaces the tracks a model made before and counts them as the latest", async () => {
    const store = useMediaStore();
    (separateTrack as any)
      .mockResolvedValueOnce(TRACK)
      .mockResolvedValueOnce(OTHER)
      .mockResolvedValueOnce(OTHER);
    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    await store.startSeparation(SONG, NO_VOCALS_SEPARATOR_MODEL);

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(store.backingSources).toEqual([
      NO_VOCALS_SEPARATOR_MODEL,
      BACKING_VOCALS_SEPARATOR_MODEL,
    ]);
    expect(store.trackFor("backing", BACKING_VOCALS_SEPARATOR_MODEL)).toBe(OTHER.backing);
  });

  it("keeps each uploaded file apart from the separated tracks", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValue(TRACK);
    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    const vocals = new File(["my vocals"], "vocals.wav");

    store.replaceUploadedTrack("vocals", null, vocals);

    expect(store.vocalSources).toEqual([BACKING_VOCALS_SEPARATOR_MODEL, "file:vocals/vocals.wav"]);
    expect(store.backingSources).toEqual([BACKING_VOCALS_SEPARATOR_MODEL]);
    expect(store.trackFor("vocals", "file:vocals/vocals.wav")).toBe(vocals);
    expect(store.separatedTrack?.backing).toBe(TRACK.backing);
    store.replaceUploadedTrack("vocals", vocals, null);
    expect(store.trackPair("file:vocals/vocals.wav")).toBeUndefined();
  });

  it("swaps one uploaded file for another, leaving the rest", () => {
    const store = useMediaStore();
    const [first, second, third] = ["a.wav", "b.wav", "c.wav"].map(
      (name) => new File([name], name),
    );
    store.replaceUploadedTrack("backing", null, first);
    store.replaceUploadedTrack("backing", null, second);

    store.replaceUploadedTrack("backing", first, third);

    expect(store.backingSources).toEqual(["file:backing/b.wav", "file:backing/c.wav"]);
  });

  it("refuses a fourth uploaded file of a kind", () => {
    const store = useMediaStore();
    const files = ["a.wav", "b.wav", "c.wav", "d.wav"].map((name) => new File([name], name));

    const added = files.map((file) => store.replaceUploadedTrack("vocals", null, file));

    expect(added).toEqual([true, true, true, false]);
    expect(store.vocalSources).toHaveLength(3);
    expect(store.replaceUploadedTrack("backing", null, files[3])).toBe(true);
  });

  it("finds no track for the full song or a source that has none", () => {
    const store = useMediaStore();
    store.trackPairs = [PAIR];

    expect(store.trackFor("vocals", "full")).toBeNull();
    expect(store.trackFor("vocals", NO_VOCALS_SEPARATOR_MODEL)).toBeNull();
  });

  it("brings back the background video an older version saved, as a named video", async () => {
    vi.mocked(takeLegacyBlob).mockImplementation(async (key) =>
      key === "media.backgroundVideo" ? new Blob(["video"]) : undefined,
    );
    const store = useMediaStore();

    await vi.waitFor(() => expect(store.background).toBeInstanceOf(File));
    expect((store.background as File).name).toBe("video.mp4");
    expect(store.background?.type).toBe("video/mp4");
    vi.mocked(takeLegacyBlob).mockResolvedValue(undefined);
  });

  it("brings back the single pair an older version saved", async () => {
    vi.mocked(takeLegacyBlob).mockResolvedValueOnce(TRACK);
    const store = useMediaStore();

    await vi.waitFor(() =>
      expect(store.trackPairs).toEqual([{ source: store.separationModel, ...TRACK }]),
    );
  });
});

describe("Media Store separation outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a success and how long it took", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockImplementation(async () => {
      vi.advanceTimersByTime(90_000);
      return TRACK;
    });

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(store.lastSeparation).toEqual({ status: "succeeded", durationSeconds: 90 });
  });

  it("records a failure", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockImplementation(async () => {
      vi.advanceTimersByTime(12_000);
      throw new Error("The separation job no longer exists.");
    });

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(store.lastSeparation).toEqual({ status: "failed", durationSeconds: 12 });
  });

  it("records a cancel", async () => {
    const store = useMediaStore();
    const started = pendingSeparation();
    const running = store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    await started;
    vi.advanceTimersByTime(30_000);

    store.cancelSeparation();
    await running;

    expect(store.lastSeparation).toEqual({ status: "cancelled", durationSeconds: 30 });
  });

  it("counts the wait in line towards the duration", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockImplementation(
      async (_file: File, _model: string, onProgress: (update: object) => void) => {
        onProgress({ progress: null, stage: "waiting in line", songsAhead: 1 });
        vi.advanceTimersByTime(60_000);
        onProgress({ progress: 0.5, stage: "separating", songsAhead: null });
        vi.advanceTimersByTime(30_000);
        return TRACK;
      },
    );

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(store.lastSeparation?.durationSeconds).toBe(90);
  });

  it("keeps the last outcome while the next separation runs", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValueOnce(TRACK);
    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);
    pendingSeparation();

    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(store.lastSeparation?.status).toBe("succeeded");
  });
});

describe("Media Store running separation", () => {
  const POLL_URL = "/separated_track/abc";
  type Running = { pollUrl: string; model?: string; requestedAt: number };
  let running: Ref<Running | null> | undefined;

  // Captures the persisted ref, optionally seeding it as a reload would from localStorage.
  function persistRunning(stored: Running | null = null) {
    vi.mocked(persistJsonRef).mockImplementation((key: string, ref: Ref<any>) => {
      if (key === "media.runningSeparation") {
        ref.value = stored;
        running = ref;
      }
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    running = undefined;
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.mocked(persistJsonRef).mockReset();
  });

  it("remembers the job once the backend has accepted it", async () => {
    persistRunning();
    const store = useMediaStore();
    (separateTrack as any).mockImplementation(
      (
        _file: File,
        _model: string,
        _onProgress: unknown,
        _signal: AbortSignal,
        onSubmitted: any,
      ) => {
        onSubmitted(POLL_URL);
        return new Promise(() => {});
      },
    );

    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(running?.value?.pollUrl).toBe(POLL_URL);
    expect(running?.value?.model).toBe(BACKING_VOCALS_SEPARATOR_MODEL);
    expect(running?.value?.requestedAt).toBeLessThanOrEqual(Date.now());
  });

  it.each([
    ["succeeds", () => (separateTrack as any).mockResolvedValue(TRACK)],
    ["fails", () => (separateTrack as any).mockRejectedValue(new Error("Out of memory"))],
  ])("forgets the job once it %s", async (_outcome, arrange) => {
    persistRunning();
    const store = useMediaStore();
    arrange();

    await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(running?.value).toBeNull();
  });

  it("forgets the job once it is cancelled", async () => {
    persistRunning({ pollUrl: POLL_URL, requestedAt: Date.now() });
    const store = useMediaStore();
    (resumeSeparation as any).mockReturnValue(new Promise(() => {}));
    await vi.waitFor(() => expect(store.isProcessing).toBe(true));

    store.cancelSeparation();

    expect(running?.value).toBeNull();
    expect(store.lastSeparation?.status).toBe("cancelled");
  });

  it("follows a remembered job when the page loads again", async () => {
    persistRunning({
      pollUrl: POLL_URL,
      model: NO_VOCALS_SEPARATOR_MODEL,
      requestedAt: Date.now() - 60_000,
    });
    (resumeSeparation as any).mockResolvedValue(TRACK);

    const store = useMediaStore();

    await vi.waitFor(() => expect(store.lastSeparation?.status).toBe("succeeded"));
    expect(resumeSeparation).toHaveBeenCalledWith(
      POLL_URL,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(store.trackPairs).toEqual([{ source: NO_VOCALS_SEPARATOR_MODEL, ...TRACK }]);
    // The duration counts from the original request, not from the reload.
    expect(store.lastSeparation?.durationSeconds).toBeGreaterThanOrEqual(60);
    expect(running?.value).toBeNull();
  });

  it("joins the resumed job instead of starting another", async () => {
    persistRunning({ pollUrl: POLL_URL, requestedAt: Date.now() });
    (resumeSeparation as any).mockReturnValue(new Promise(() => {}));
    const store = useMediaStore();
    await vi.waitFor(() => expect(store.isProcessing).toBe(true));

    store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(separateTrack).not.toHaveBeenCalled();
  });

  it("starts nothing when no job was left running", async () => {
    persistRunning();
    const store = useMediaStore();
    await Promise.resolve();
    await Promise.resolve();

    expect(resumeSeparation).not.toHaveBeenCalled();
    expect(store.isProcessing).toBe(false);
  });
});

describe("Media Store upload limit", () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    meta = document.createElement("meta");
    meta.name = "tuul-max-upload-bytes";
    meta.content = "5";
    document.head.appendChild(meta);
  });

  afterEach(() => {
    meta.remove();
  });

  it("refuses to send a song over the limit, and says why", async () => {
    const store = useMediaStore();
    const song = new File(["123456"], "big.wav");

    const result = await store.startSeparation(song, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(result).toBeUndefined();
    expect(separateTrack).not.toHaveBeenCalled();
    expect(store.error).toContain("over the 1 MB the server accepts");
    expect(store.isProcessing).toBe(false);
  });

  it("flags a loaded song over the limit before anything is sent", () => {
    const store = useMediaStore();

    store.songFile = new File(["123456"], "big.wav");

    expect(store.songTooLargeMessage).toContain("This song is 1 MB");
  });

  it("sends a song at the limit", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValue(TRACK);

    await store.startSeparation(new File(["12345"], "ok.wav"), BACKING_VOCALS_SEPARATOR_MODEL);

    expect(separateTrack).toHaveBeenCalledOnce();
    expect(store.songTooLargeMessage).toBeNull();
  });

  it("checks nothing when the page does not state a limit", async () => {
    meta.remove();
    const store = useMediaStore();
    (separateTrack as any).mockResolvedValue(TRACK);

    await store.startSeparation(new File(["123456"], "big.wav"), BACKING_VOCALS_SEPARATOR_MODEL);

    expect(separateTrack).toHaveBeenCalledOnce();
  });
});
