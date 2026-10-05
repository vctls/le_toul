// Each level holds the loudest sample of every LEVEL_FACTOR samples of the level below it, so a
// canvas reads at most a few dozen values per pixel at any zoom, rather than every sample it covers.
const LEVEL_FACTOR = 4;
const MIN_LEVEL_LENGTH = 1024;

interface PeakLevel {
  // How many samples of the audio each value covers.
  blockSize: number;
  data: Float32Array;
}

const cache = new WeakMap<AudioBuffer, PeakLevel[][]>();

function buildLevels(channel: Float32Array): PeakLevel[] {
  const levels: PeakLevel[] = [{ blockSize: 1, data: channel }];
  let below = channel;
  let blockSize = 1;
  while (below.length > MIN_LEVEL_LENGTH) {
    const level = new Float32Array(Math.ceil(below.length / LEVEL_FACTOR));
    for (let i = 0; i < level.length; i++) {
      const end = Math.min(below.length, (i + 1) * LEVEL_FACTOR);
      let max = 0;
      for (let j = i * LEVEL_FACTOR; j < end; j++) {
        const value = Math.abs(below[j]);
        if (value > max) max = value;
      }
      level[i] = max;
    }
    blockSize *= LEVEL_FACTOR;
    levels.push({ blockSize, data: level });
    below = level;
  }
  return levels;
}

/**
 * The peak levels of the first two channels, as WaveSurfer draws them: the first above the middle
 * and the second, or the first again for mono, below it.
 */
export function peakLevelsFor(buffer: AudioBuffer): PeakLevel[][] {
  let levels = cache.get(buffer);
  if (!levels) {
    const first = buildLevels(buffer.getChannelData(0));
    levels = [first, buffer.numberOfChannels > 1 ? buildLevels(buffer.getChannelData(1)) : first];
    cache.set(buffer, levels);
  }
  return levels;
}

/**
 * The loudest of the samples from `from` up to but not including `to`, both of which may fall
 * between samples. Blocks that straddle either end count whole.
 */
function peakBetween({ blockSize, data }: PeakLevel, from: number, to: number): number {
  const firstSample = Math.ceil(from);
  const endSample = Math.max(firstSample + 1, Math.ceil(to));
  const first = Math.floor(firstSample / blockSize);
  const last = Math.min(data.length, Math.floor((endSample - 1) / blockSize) + 1);
  let max = 0;
  for (let i = first; i < last; i++) {
    const value = Math.abs(data[i]);
    if (value > max) max = value;
  }
  return max;
}

/**
 * Draws one of WaveSurfer's canvases from the peak levels, in place of its own line renderer.
 * `sampleCount` is the length of the stretch WaveSurfer sliced for this canvas. Its start is
 * worked out as WaveSurfer does, from the canvas's offset in `totalWidth`, the whole waveform's
 * width. Without one, it is estimated from the canvas's own width, a sample off per canvas.
 */
export function drawPeaks(
  ctx: CanvasRenderingContext2D,
  channelLevels: PeakLevel[][],
  sampleCount: number,
  totalWidth?: number,
) {
  const { width, height } = ctx.canvas;
  if (!width || !sampleCount) return;
  const cssLeft = parseFloat(ctx.canvas.style.left) || 0;
  const cssWidth = parseFloat(ctx.canvas.style.width) || width;
  const start = totalWidth
    ? Math.floor((cssLeft / totalWidth) * channelLevels[0][0].data.length)
    : Math.round((cssLeft / cssWidth) * sampleCount);
  const samplesPerPixel = sampleCount / width;
  // Blocks straddling a column's edges count whole, so they are kept to a sixteenth of a column.
  const maxBlock = Math.max(1, samplesPerPixel / 16);
  const halfHeight = height / 2;

  ctx.beginPath();
  channelLevels.forEach((levels, index) => {
    const direction = index === 0 ? -1 : 1;
    let level = levels[0];
    for (const candidate of levels) if (candidate.blockSize <= maxBlock) level = candidate;
    ctx.moveTo(0, halfHeight);
    for (let x = 0; x < width; x++) {
      // A sample belongs to its nearest column, as in WaveSurfer.
      const from = start + Math.max(0, x - 0.5) * samplesPerPixel;
      const peak = peakBetween(level, from, start + (x + 0.5) * samplesPerPixel);
      // As in WaveSurfer, silence still shows as a one-pixel line.
      ctx.lineTo(x, halfHeight + (Math.round(peak * halfHeight) || 1) * direction);
    }
    ctx.lineTo(width, halfHeight);
  });
  ctx.fill();
}
