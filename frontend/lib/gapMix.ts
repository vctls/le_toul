// Builds the restored backing track in the browser, for the render, the preview and the Timing tab.

import bufferToWav from "audiobuffer-to-wav";
import { gapDifference, gapGain, mixGaps, Span } from "./gapRestore";

// The separator writes its stems at this rate, so the backing track is decoded without resampling.
const SAMPLE_RATE = 44100;

interface DecodedPair {
  backing: Blob;
  original: Blob;
  channels: Promise<{ backing: Float32Array[]; original: Float32Array[] }>;
}

interface Mix {
  backing: Blob;
  original: Blob;
  key: string;
  result: Promise<Blob>;
}

// A decoded song takes about 100 MB, so only the latest pair is kept.
let decoded: DecodedPair | null = null;
// The preview, the Timing tab and the render ask for the same mix in turn.
let mixes: Mix[] = [];
const MIXES_KEPT = 2;

async function decodeChannels(blob: Blob): Promise<Float32Array[]> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

function decodePair(backing: Blob, original: Blob): DecodedPair["channels"] {
  if (decoded?.backing !== backing || decoded.original !== original) {
    const channels = Promise.all([decodeChannels(backing), decodeChannels(original)]).then(
      ([backing, original]) => ({ backing, original }),
    );
    decoded = { backing, original, channels };
    // A failed decode is tried again next time.
    channels.catch(() => {
      if (decoded?.channels === channels) decoded = null;
    });
  }
  return decoded.channels;
}

/**
 * The backing track with the original song over the gaps, as a WAV, or the backing track itself
 * when there is no gap. The backing track is brought to the original's level in the gaps.
 */
export function restoredBacking(
  backing: Blob,
  original: Blob,
  gaps: Span[],
  fade: number,
): Promise<Blob> {
  if (gaps.length === 0) {
    return Promise.resolve(backing);
  }
  const key = JSON.stringify([gaps, fade]);
  const cached = mixes.find(
    (mix) => mix.backing === backing && mix.original === original && mix.key === key,
  );
  if (cached) {
    return cached.result;
  }
  const result = decodePair(backing, original).then((channels) => {
    const { backing, original } = channels;
    const gain = gapGain(backing, original, SAMPLE_RATE, gaps);
    const mixed = mixGaps(backing, original, SAMPLE_RATE, gaps, fade, gain);
    const wav = bufferToWav({
      numberOfChannels: mixed.length,
      sampleRate: SAMPLE_RATE,
      length: mixed[0].length,
      getChannelData: (c: number) => mixed[c],
    } as AudioBuffer);
    return new Blob([wav], { type: "audio/wav" });
  });
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
export async function gapDifferences(
  backing: Blob,
  original: Blob,
  gaps: Span[],
): Promise<{ gain: number; levels: number[] }> {
  const channels = await decodePair(backing, original);
  const gain = gapGain(channels.backing, channels.original, SAMPLE_RATE, gaps);
  return {
    gain,
    levels: gaps.map((gap) =>
      gapDifference(channels.backing, channels.original, SAMPLE_RATE, gap, gain),
    ),
  };
}
