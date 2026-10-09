// Mixes the restored backing track off the main thread. Workers can't decode audio, so the page
// decodes each pair and sends its channels here once.

import bufferToWav from "audiobuffer-to-wav";
import { gapDifference, gapGain, mixGaps } from "./gapRestore";
import type { GapMixRequest, GapMixResponse } from "./gapMix";

interface Pair {
  sampleRate: number;
  backing: Float32Array[];
  original: Float32Array[];
}

const pairs = new Map<number, Pair>();

/**
 * The result of a request, or an error when it names a pair that isn't loaded.
 */
function handle(request: GapMixRequest): GapMixResponse["result"] {
  if (request.type === "load") {
    const { sampleRate, backing, original } = request;
    pairs.set(request.pairId, { sampleRate, backing, original });
    return undefined;
  }
  if (request.type === "drop") {
    pairs.delete(request.pairId);
    return undefined;
  }
  const pair = pairs.get(request.pairId);
  if (!pair) {
    throw new Error(`Pair ${request.pairId} isn't loaded`);
  }
  const { sampleRate, backing, original } = pair;
  const gain = gapGain(backing, original, sampleRate, request.gaps);
  if (request.type === "differences") {
    return {
      gain,
      levels: request.gaps.map((gap) => gapDifference(backing, original, sampleRate, gap, gain)),
    };
  }
  const { gaps, fade, balance, atBackingLevel } = request;
  const mixed = mixGaps(backing, original, sampleRate, gaps, fade, {
    gain,
    balance,
    atBackingLevel,
  });
  const wav = bufferToWav({
    numberOfChannels: mixed.length,
    sampleRate,
    length: mixed[0].length,
    getChannelData: (c: number) => mixed[c],
  } as AudioBuffer);
  return new Blob([wav], { type: "audio/wav" });
}

self.onmessage = ({ data }: MessageEvent<GapMixRequest>) => {
  let response: GapMixResponse;
  try {
    response = { id: data.id, result: handle(data) };
  } catch (error) {
    response = { id: data.id, error: String(error) };
  }
  self.postMessage(response);
};
