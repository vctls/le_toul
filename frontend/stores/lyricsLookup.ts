import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  convertFetchedLyrics,
  fetchLyrics,
  fetchLyricsProvider,
  LyricsLookupMatch,
  LyricsProviderInfo,
  LyricsQuery,
} from "@/lib/lyricsLookup";
import { useLyricsStore } from "@/stores/lyrics";
import { useMediaStore } from "@/stores/media";

export type LyricsLookupStatus =
  | { kind: "looking" }
  | { kind: "found"; match: LyricsLookupMatch }
  | { kind: "instrumental"; match: LyricsLookupMatch }
  | { kind: "notFound" }
  | { kind: "failed" };

// The Artist and Title fields. No lookup starts while one of them has focus.
export const SONG_DETAIL_FIELD = ".metadata-input";

export const useLyricsLookupStore = defineStore("lyricsLookup", () => {
  const media = useMediaStore();
  const lyrics = useLyricsStore();

  const provider = ref<LyricsProviderInfo | null>(null);
  const status = ref<LyricsLookupStatus | null>(null);

  // The text the last lookup wrote, which the "found" status describes until it is edited.
  let fetchedText: string | null = null;
  let lastKey: string | null = null;
  let runningLoaders = 0;
  let inFlight: AbortController | null = null;

  watch(
    () => lyrics.lyricText,
    (text) => {
      const current = status.value;
      if (!current || current.kind === "looking") return;
      if (current.kind === "found" ? text !== fetchedText : text.trim() !== "") {
        status.value = null;
      }
    },
  );

  /**
   * Asks the server which provider it uses. A failed request leaves the lookup off.
   */
  async function loadProvider(): Promise<void> {
    try {
      provider.value = await fetchLyricsProvider();
    } catch (error) {
      console.warn("Couldn't tell whether lyrics lookup is on:", error);
      provider.value = null;
    }
  }

  function currentQuery(): LyricsQuery | null {
    const title = media.songTitle?.trim() ?? "";
    const artist = media.songArtist?.trim() ?? "";
    const duration = media.songDuration;
    if (!title || !artist || !duration) return null;
    return { title, artist, duration };
  }

  function keyOf(query: LyricsQuery): string {
    return JSON.stringify([query.title, query.artist, Math.round(query.duration)]);
  }

  function isEditingSongDetails(): boolean {
    return document.activeElement?.closest(SONG_DETAIL_FIELD) != null;
  }

  /**
   * Fills empty lyrics from the provider once the song's title, artist and duration have settled.
   * Callers only signal that they may have, and this decides whether a lookup is due.
   */
  async function lookUp(): Promise<void> {
    if (!provider.value || runningLoaders > 0) return;
    // A blur runs this before focus reaches the next field.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await media.metadataSettled();
    if (!provider.value || runningLoaders > 0 || isEditingSongDetails()) return;
    if (lyrics.lyricText.trim() !== "") return;
    const query = currentQuery();
    if (!query) return;
    const key = keyOf(query);
    if (key === lastKey) return;

    lastKey = key;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    status.value = { kind: "looking" };
    try {
      const result = await fetchLyrics(query, controller.signal);
      if (inFlight !== controller) return;
      const current = currentQuery();
      if (!current || keyOf(current) !== key || lyrics.lyricText.trim() !== "") {
        status.value = null;
        return;
      }
      const text = result?.lyrics ? convertFetchedLyrics(result.lyrics) : "";
      if (result?.instrumental) {
        status.value = { kind: "instrumental", match: result.match };
      } else if (!result || text === "") {
        status.value = { kind: "notFound" };
      } else {
        fetchedText = text;
        lyrics.setLyrics(text);
        status.value = { kind: "found", match: result.match };
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      // Leaving a field again can then retry.
      lastKey = null;
      status.value = { kind: "failed" };
      logWarning(`Lyrics lookup failed: ${(error as Error).message}`);
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  /**
   * Runs a loader that sets the song's details in several steps, then looks the lyrics up once.
   */
  async function whileLoading<T>(load: () => Promise<T>): Promise<T> {
    runningLoaders++;
    try {
      return await load();
    } finally {
      runningLoaders--;
      if (runningLoaders === 0) void lookUp();
    }
  }

  /**
   * Forgets the last lookup, so that the same song can be looked up again after starting over.
   */
  function reset(): void {
    inFlight?.abort();
    inFlight = null;
    lastKey = null;
    fetchedText = null;
    status.value = null;
  }

  return { provider, status, loadProvider, lookUp, whileLoading, reset };
});

function logWarning(message: string): void {
  console.warn(message);
  fetch("/log_error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: "warning", message, timestamp: new Date().toISOString() }),
  }).catch(() => {});
}
