import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { fetchLyrics, LyricsLookupResult } from "@/lib/lyricsLookup";
import { useLyricsStore } from "./lyrics";
import { useLyricsLookupStore } from "./lyricsLookup";
import { useMediaStore } from "./media";

vi.mock("@/lib/lyricsLookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lyricsLookup")>()),
  fetchLyrics: vi.fn(),
  fetchLyricsProvider: vi.fn(),
}));

vi.mock("@/lib/persistence", () => ({
  persistJsonRef: vi.fn(),
  persistBlobRef: vi.fn().mockResolvedValue(undefined),
  clearPersistence: vi.fn().mockResolvedValue(undefined),
  takeLegacyBlob: vi.fn().mockResolvedValue(undefined),
  loadJsonFromStorage: <T>(_key: string, defaultValue: T) => defaultValue,
}));

const PROVIDER = { id: "fake", name: "Fake Lyrics", url: "https://lyrics.test" };

const MATCH = {
  title: "Glim Tovar",
  artist: "The Wendels",
  album: "Pellow",
  duration: 201,
  url: "https://lyrics.test/7",
};

const FOUND: LyricsLookupResult = {
  lyrics: "[Chorus]\nVel oma trin\nSossa lein",
  instrumental: false,
  match: MATCH,
};

function setUp({ provider = PROVIDER as typeof PROVIDER | null } = {}) {
  const lookup = useLyricsLookupStore();
  const media = useMediaStore();
  const lyrics = useLyricsStore();
  lookup.provider = provider;
  media.songTitle = "Glim Tovar";
  media.songArtist = "The Wendels";
  media.songDuration = 200.4;
  return { lookup, media, lyrics };
}

// A fetch that stays pending until the test settles it.
function pendingFetch() {
  let resolve!: (result: LyricsLookupResult | null) => void;
  let signal!: AbortSignal;
  vi.mocked(fetchLyrics).mockImplementationOnce((_query, abortSignal) => {
    signal = abortSignal!;
    return new Promise((r) => (resolve = r));
  });
  return { resolve: (result: LyricsLookupResult | null) => resolve(result), signal: () => signal };
}

describe("Lyrics lookup store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.mocked(fetchLyrics).mockResolvedValue(FOUND);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fills empty lyrics with the converted text", async () => {
    const { lookup, lyrics } = setUp();

    await lookup.lookUp();

    expect(fetchLyrics).toHaveBeenCalledWith(
      { title: "Glim Tovar", artist: "The Wendels", duration: 200.4 },
      expect.any(AbortSignal),
    );
    expect(lyrics.lyricText).toBe("Vel oma trin\nSossa lein");
    expect(lookup.status).toEqual({ kind: "found", match: MATCH });
  });

  it("requests nothing when no provider is configured", async () => {
    const { lookup } = setUp({ provider: null });

    await lookup.lookUp();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it.each([
    ["the title is blank", { songTitle: "  " }],
    ["the artist is missing", { songArtist: null }],
    ["the duration is unknown", { songDuration: null }],
  ])("waits when %s", async (_, change) => {
    const { lookup, media } = setUp();
    Object.assign(media, change);

    await lookup.lookUp();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("leaves lyrics that are already there", async () => {
    const { lookup, lyrics } = setUp();
    lyrics.setLyrics("Prel dova");

    await lookup.lookUp();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("waits while the Artist or Title field has focus", async () => {
    const { lookup } = setUp();
    document.body.innerHTML = '<div class="metadata-input"><input /></div>';
    document.querySelector("input")!.focus();

    await lookup.lookUp();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("looks a song up once, and again when its details change", async () => {
    const { lookup, media, lyrics } = setUp();
    vi.mocked(fetchLyrics).mockResolvedValue(null);

    await lookup.lookUp();
    await lookup.lookUp();
    media.songDuration = 200.2;
    await lookup.lookUp();
    expect(fetchLyrics).toHaveBeenCalledTimes(1);

    media.songTitle = "Glim Tovar (Live)";
    await lookup.lookUp();
    expect(fetchLyrics).toHaveBeenCalledTimes(2);
    expect(lyrics.lyricText).toBe("");
  });

  it("holds lookups while a loader runs and looks up once when it ends", async () => {
    const { lookup } = setUp();
    let ended!: () => void;

    const loading = lookup.whileLoading(async () => {
      await lookup.lookUp();
      await lookup.whileLoading(async () => {
        await lookup.lookUp();
      });
      await new Promise<void>((resolve) => (ended = resolve));
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(fetchLyrics).not.toHaveBeenCalled();

    ended();
    await loading;
    await vi.waitFor(() => expect(fetchLyrics).toHaveBeenCalledTimes(1));
  });

  it("aborts a lookup when a newer one starts, and drops its answer", async () => {
    const { lookup, media, lyrics } = setUp();
    const first = pendingFetch();
    const firstLookup = lookup.lookUp();
    await vi.waitFor(() => expect(fetchLyrics).toHaveBeenCalledTimes(1));

    media.songTitle = "Glim Tovar (Live)";
    vi.mocked(fetchLyrics).mockResolvedValueOnce(null);
    await lookup.lookUp();
    expect(first.signal().aborted).toBe(true);

    first.resolve(FOUND);
    await firstLookup;
    expect(lyrics.lyricText).toBe("");
    expect(lookup.status).toEqual({ kind: "notFound" });
  });

  it("drops an answer when lyrics were typed while it was on its way", async () => {
    const { lookup, lyrics } = setUp();
    const pending = pendingFetch();
    const looking = lookup.lookUp();
    await vi.waitFor(() => expect(lookup.status).toEqual({ kind: "looking" }));

    lyrics.setLyrics("Prel dova");
    pending.resolve(FOUND);
    await looking;

    expect(lyrics.lyricText).toBe("Prel dova");
    expect(lookup.status).toBeNull();
  });

  it("reports an instrumental song and leaves the lyrics empty", async () => {
    const { lookup, lyrics } = setUp();
    vi.mocked(fetchLyrics).mockResolvedValue({ lyrics: null, instrumental: true, match: MATCH });

    await lookup.lookUp();

    expect(lyrics.lyricText).toBe("");
    expect(lookup.status).toEqual({ kind: "instrumental", match: MATCH });
  });

  it("reports a failure and lets the same song be tried again", async () => {
    const { lookup } = setUp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    vi.mocked(fetchLyrics).mockRejectedValueOnce(new Error("status 502"));

    await lookup.lookUp();
    expect(lookup.status).toEqual({ kind: "failed" });
    expect(fetchSpy).toHaveBeenCalledWith("/log_error", expect.anything());

    await lookup.lookUp();
    expect(fetchLyrics).toHaveBeenCalledTimes(2);
    expect(lookup.status?.kind).toBe("found");
  });

  it("clears the found status once the lyrics are edited", async () => {
    const { lookup, lyrics } = setUp();
    await lookup.lookUp();

    lyrics.setLyrics(lyrics.lyricText + "\nPrel");
    await nextTick();

    expect(lookup.status).toBeNull();
  });

  it("looks the same song up again after a reset", async () => {
    const { lookup, lyrics } = setUp();
    await lookup.lookUp();
    lyrics.clear();

    lookup.reset();
    await lookup.lookUp();

    expect(fetchLyrics).toHaveBeenCalledTimes(2);
  });
});
