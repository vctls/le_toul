import { describe, expect, it } from "vitest";
import { calculateLinePaths } from "wavesurfer.js/dist/renderer-utils.js";
import { drawPeaks, peakLevelsFor } from "@/lib/waveformPeaks";

function noise(length: number, seed: number): Float32Array {
  const data = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    // Mostly quiet, with occasional loud samples, so that column peaks vary.
    const value = state / 2 ** 32 - 0.5;
    data[i] = i % 97 === 0 ? value * 2 : value * 0.3;
  }
  return data;
}

function buffer(...channels: Float32Array[]): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index],
  } as unknown as AudioBuffer;
}

/**
 * Draws a canvas WaveSurfer would place at `left` in a waveform `totalWidth` wide, and returns the
 * outline of each channel, one y per column, along with the samples WaveSurfer would slice for it.
 */
function draw(channels: Float32Array[], totalWidth: number, left: number, width: number) {
  const length = channels[0].length;
  const start = Math.floor((left / totalWidth) * length);
  const end = Math.floor(((left + width) / totalWidth) * length);
  const outlines: number[][] = [];
  const ctx = {
    canvas: { width, height: 200, style: { left: `${left}px`, width: `${width}px` } },
    beginPath() {},
    moveTo() {
      outlines.push([]);
    },
    lineTo(x: number, y: number) {
      if (x < width) outlines.at(-1)!.push(y);
    },
    fill() {},
    closePath() {},
  } as unknown as CanvasRenderingContext2D;
  drawPeaks(ctx, peakLevelsFor(buffer(...channels)), end - start, totalWidth);
  return { outlines, slices: channels.map((channel) => channel.slice(start, end)) };
}

/**
 * WaveSurfer's own outline for the same canvas, one y per column.
 */
function wavesurferOutlines(slices: Float32Array[], width: number): number[][] {
  const paths = calculateLinePaths({ channelData: slices, width, height: 200, vScale: 1 });
  return paths.map((path) => {
    const ys: number[] = [];
    // The first and last points are the baseline the shape starts and ends on.
    for (const point of path.slice(1, -1)) ys[point.x] = point.y;
    return ys;
  });
}

describe("drawPeaks", () => {
  it("draws WaveSurfer's own outline where a column covers few samples", () => {
    const channels = [noise(40_000, 1), noise(40_000, 2)];
    const { outlines, slices } = draw(channels, 2000, 800, 400);

    expect(outlines).toEqual(wavesurferOutlines(slices, 400));
  });

  it("only ever overstates a wide column, by no more than a block past either edge", () => {
    const channel = noise(400_000, 3);
    const { outlines, slices } = draw([channel, channel], 300, 100, 100);
    const [top] = outlines;
    const exact = wavesurferOutlines(slices, 100)[0];
    // A column covers about 1333 samples here, so the levels give blocks of 64.
    const block = 64;
    const start = Math.floor((100 / 300) * channel.length);
    const samplesPerColumn = slices[0].length / 100;

    top.forEach((y, x) => {
      const from = start + Math.ceil((x - 0.5) * samplesPerColumn) - block;
      const to = start + Math.ceil((x + 0.5) * samplesPerColumn) + block;
      let peak = 0;
      for (let i = Math.max(0, from); i < to; i++) peak = Math.max(peak, Math.abs(channel[i]));
      expect(y).toBeLessThanOrEqual(exact[x]);
      expect(y).toBeGreaterThanOrEqual(100 - (Math.round(peak * 100) || 1));
    });
  });

  it("draws a mono track's only channel on both sides", () => {
    const channel = noise(10_000, 5);
    const { outlines } = draw([channel], 1000, 0, 500);
    const [top, bottom] = outlines;

    // Each side mirrors the other around the middle, at a height of 100.
    top.forEach((y, x) => expect(y + bottom[x]).toBe(200));
  });

  it("builds a track's peak levels once", () => {
    const track = buffer(noise(5000, 6), noise(5000, 7));

    expect(peakLevelsFor(track)).toBe(peakLevelsFor(track));
  });
});
