import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ref } from "vue";
import { resumeSeparation, separateTrack } from "@/lib/audio";
import { persistJsonRef } from "@/lib/persistence";
import { BACKING_VOCALS_SEPARATOR_MODEL, useMediaStore } from "./media";

vi.mock("@/lib/audio", () => ({
  separateTrack: vi.fn(),
  resumeSeparation: vi.fn(),
}));

vi.mock("@/lib/persistence", () => ({
  persistJsonRef: vi.fn(),
  persistBlobRef: vi.fn().mockResolvedValue(undefined),
  clearPersistence: vi.fn().mockResolvedValue(undefined),
}));

const SONG = new File(["audio data"], "test.mp3", { type: "audio/mp3" });
const TRACK = { backing: new Blob(["backing"]), vocals: new Blob(["vocals"]) };

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
    store.separatedTrack = TRACK;
    store.backingTrackFile = new File(["backing"], "accompaniment.wav");
    store.vocalTrackFile = new File(["vocals"], "vocals.wav");

    store.discardSeparatedTrack();

    expect(signal.aborted).toBe(true);
    expect(store.separatedTrack).toBeNull();
    expect(store.backingTrackFile).toBeNull();
    expect(store.vocalTrackFile).toBeNull();
    expect(store.hasSeparatedTrack).toBe(false);
  });

  it("reports an uploaded track alone as a separated track", async () => {
    const store = useMediaStore();

    expect(store.hasSeparatedTrack).toBe(false);
    await store.setBackingTrack(new File(["backing"], "accompaniment.wav"));

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
  let running: Ref<{ pollUrl: string; requestedAt: number } | null> | undefined;

  // Captures the persisted ref, optionally seeding it as a reload would from localStorage.
  function persistRunning(stored: { pollUrl: string; requestedAt: number } | null = null) {
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
    persistRunning({ pollUrl: POLL_URL, requestedAt: Date.now() - 60_000 });
    (resumeSeparation as any).mockResolvedValue(TRACK);

    const store = useMediaStore();

    await vi.waitFor(() => expect(store.lastSeparation?.status).toBe("succeeded"));
    expect(resumeSeparation).toHaveBeenCalledWith(
      POLL_URL,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(store.separatedTrack).toBe(TRACK);
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
