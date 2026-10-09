// Builds the restored backing track in the browser, for the render, the preview and the Timing tab.
// The arithmetic runs in a worker, so a rebuild doesn't freeze the page.

import { MixLevels, Span } from "./gapRestore";
import workerUrl from "./gapMix.worker.ts?worker&url";

// The separator writes its stems at this rate, so the backing track is decoded without resampling.
const SAMPLE_RATE = 44100;

type GapMixPayload =
  | {
      type: "load";
      pairId: number;
      sampleRate: number;
      backing: Float32Array[];
      original: Float32Array[];
    }
  | { type: "drop"; pairId: number }
  | { type: "differences"; pairId: number; gaps: Span[] }
  | ({ type: "mix"; pairId: number; gaps: Span[]; fade: number } & Omit<MixLevels, "gain">);

export type GapMixRequest = GapMixPayload & { id: number };

export interface GapMixResponse {
  id: number;
  result?: Blob | GapDifferences;
  error?: string;
}

interface GapDifferences {
  gain: number;
  levels: number[];
}

interface DecodedPair {
  backing: Blob;
  original: Blob;
  id: number;
  loaded: Promise<void>;
  // Requests still using the pair. The worker drops it once it is replaced and unused.
  users: number;
}

interface Mix {
  backing: Blob;
  original: Blob;
  key: string;
  result: Promise<Blob>;
}

let worker: Worker | null = null;
let lastRequestId = 0;
const pending = new Map<
  number,
  { resolve: (result: GapMixResponse["result"]) => void; reject: (error: Error) => void }
>();

// A decoded song takes about 100 MB, so the worker only keeps the latest pair and those in use.
let current: DecodedPair | null = null;
let lastPairId = 0;
// The preview, the Timing tab and the render ask for the same mix in turn.
let mixes: Mix[] = [];
const MIXES_KEPT = 2;

/**
 * Start the mix worker.
 */
function startWorker(): Worker {
  const url = new URL(workerUrl, import.meta.url);
  if (url.origin === location.origin) {
    return new Worker(url, { type: "module" });
  }
  // A worker must share the page's origin, which the scripts don't when FastAPI serves the page
  // and Vite the scripts.
  const loader = new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(loader), { type: "module" });
}

/**
 * Send a request to the worker, starting it on first use.
 */
function request(payload: GapMixPayload): Promise<GapMixResponse["result"]> {
  if (!worker) {
    worker = startWorker();
    worker.onmessage = ({ data }: MessageEvent<GapMixResponse>) => {
      const call = pending.get(data.id);
      pending.delete(data.id);
      if (data.error === undefined) call?.resolve(data.result);
      else call?.reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      // Every pair went with the worker, so the next request starts over.
      worker?.terminate();
      worker = null;
      current = null;
      const error = new Error(`The mix worker failed: ${event.message}`);
      pending.forEach((call) => call.reject(error));
      pending.clear();
    };
  }
  const id = ++lastRequestId;
  const result = new Promise<GapMixResponse["result"]>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  worker.postMessage({ ...payload, id });
  return result;
}

async function decodeChannels(blob: Blob): Promise<Float32Array[]> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

/**
 * Decode the pair into the worker.
 */
function loadPair(backing: Blob, original: Blob): DecodedPair {
  const id = ++lastPairId;
  const loaded = Promise.all([decodeChannels(backing), decodeChannels(original)]).then(
    async ([backingChannels, originalChannels]) => {
      await request({
        type: "load",
        pairId: id,
        sampleRate: SAMPLE_RATE,
        backing: backingChannels,
        original: originalChannels,
      });
    },
  );
  const pair = { backing, original, id, loaded, users: 0 };
  // A failed decode is tried again next time.
  loaded.catch(() => {
    if (current === pair) current = null;
  });
  return pair;
}

function dropIfUnused(pair: DecodedPair): void {
  if (pair !== current && pair.users === 0 && worker) {
    void request({ type: "drop", pairId: pair.id });
  }
}

/**
 * Run `use` on the pair's id in the worker, once the pair is decoded there.
 */
async function withPair<T>(
  backing: Blob,
  original: Blob,
  use: (pairId: number) => Promise<T>,
): Promise<T> {
  if (current?.backing !== backing || current.original !== original) {
    const previous = current;
    current = loadPair(backing, original);
    if (previous) dropIfUnused(previous);
  }
  const pair = current;
  pair.users++;
  try {
    await pair.loaded;
    return await use(pair.id);
  } finally {
    pair.users--;
    dropIfUnused(pair);
  }
}

/**
 * Plain copies of the gaps, since a reactive proxy can't be posted to a worker.
 */
function plainGaps(gaps: Span[]): Span[] {
  return gaps.map(({ start, end }) => ({ start, end }));
}

export interface GapMixSettings extends Omit<MixLevels, "gain"> {
  fade: number;
}

/**
 * The backing track with the original song over the gaps, as a WAV, or the backing track itself
 * when there is no gap. The two are brought to the same level in the gaps.
 */
export function restoredBacking(
  backing: Blob,
  original: Blob,
  gaps: Span[],
  { fade, balance = 1, atBackingLevel = false }: GapMixSettings,
): Promise<Blob> {
  if (gaps.length === 0) {
    return Promise.resolve(backing);
  }
  const key = JSON.stringify([gaps, fade, balance, atBackingLevel]);
  const cached = mixes.find(
    (mix) => mix.backing === backing && mix.original === original && mix.key === key,
  );
  if (cached) {
    return cached.result;
  }
  const result = withPair(
    backing,
    original,
    (pairId) =>
      request({
        type: "mix",
        pairId,
        gaps: plainGaps(gaps),
        fade,
        balance,
        atBackingLevel,
      }) as Promise<Blob>,
  );
  const mix = { backing, original, key, result };
  mixes = [mix, ...mixes].slice(0, MIXES_KEPT);
  result.catch(() => {
    mixes = mixes.filter((other) => other !== mix);
  });
  return result;
}

/**
 * The gain that brings the backing track to the original's level over the gaps, and how loud the
 * two then differ over each gap, in dBFS.
 */
export function gapDifferences(
  backing: Blob,
  original: Blob,
  gaps: Span[],
): Promise<GapDifferences> {
  return withPair(
    backing,
    original,
    (pairId) =>
      request({ type: "differences", pairId, gaps: plainGaps(gaps) }) as Promise<GapDifferences>,
  );
}
