import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { separateTrack } from "@/lib/audio";
import { BACKING_VOCALS_SEPARATOR_MODEL, useMediaStore } from "./media";

vi.mock("@/lib/audio", () => ({
  separateTrack: vi.fn(),
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

  it("reports a separation that failed", async () => {
    const store = useMediaStore();
    (separateTrack as any).mockRejectedValue(new Error("Separator ran out of memory"));

    const result = await store.startSeparation(SONG, BACKING_VOCALS_SEPARATOR_MODEL);

    expect(result).toBeUndefined();
    expect(store.error).toBe("Separator ran out of memory");
    expect(store.isProcessing).toBe(false);
  });
});
