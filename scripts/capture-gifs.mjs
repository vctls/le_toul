/**
 * Generates animated GIFs illustrating Timing-Adjustment UI features by driving
 * the running app with Playwright, capturing frame sequences, and assembling
 * them into GIFs with ffmpeg.
 *
 * Prereqs: the Vite dev server must be running (npm run dev, port 5173) and
 * ffmpeg must be on PATH.
 *
 *   node scripts/capture-gifs.mjs [feature]
 *
 * feature: "zoom" | "split" | "all" (default "all"), or "probe" for a single
 * validation screenshot of the adjust view.
 */
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const OUT_DIR = path.join(ROOT, 'docs', 'media');
const FRAME_DIR = path.join(ROOT, '.gif-frames');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const AUDIO = path.join(FIXTURES, 'Ma Rainey - Prove It on Me Blues, first verse.mp3');
const LYRICS = path.join(FIXTURES, 'lyrics.txt');
const TIMINGS = path.join(FIXTURES, 'timings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drives the app from a blank slate into a ready-to-interact Adjust view. */
async function setupAdjustView(page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('nav.tabs');

  // Song Info: upload audio
  await page.click('nav.tabs .song-info-tab-header');
  await page.locator('[name="song-file-upload"] [type="file"]').setInputFiles(AUDIO);
  await page.locator('[name="artist"]').waitFor();

  // Lyrics
  await page.click('nav.tabs .lyric-input-tab-header');
  const lyrics = await fs.readFile(LYRICS, 'utf-8');
  const textarea = page.locator('.lyric-input-tab .lyric-editor-textarea');
  await textarea.fill(lyrics);

  // Advanced -> upload timings file (marks timings complete, enables Adjust tab)
  await page.click('nav.tabs .song-info-tab-header');
  await page.click("button:has-text('Advanced')");
  await page.locator('[name="timings-file-upload"] input[type="file"]').setInputFiles(TIMINGS);

  // Adjust tab
  await page.click('nav.tabs .timing-adjustment-tab-header');
  await page.locator('h2:has-text("Adjust Timings")').waitFor();

  // Wait for the waveform to decode and regions to render.
  await page.locator('.wavesurfer-container').waitFor();
  await page.locator('[part^="region segment_"]').first().waitFor({ timeout: 30000 });
  await sleep(1500);
}

/** A frame recorder that screenshots a fixed clip rect into a numbered sequence. */
class Recorder {
  constructor(page, name, clip) {
    this.page = page;
    this.dir = path.join(FRAME_DIR, name);
    this.clip = clip;
    this.n = 0;
  }
  async init() {
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.dir, { recursive: true });
  }
  async frame() {
    this.n += 1;
    const file = path.join(this.dir, `frame_${String(this.n).padStart(4, '0')}.png`);
    await this.page.screenshot({ path: file, clip: this.clip });
  }
  async hold(count) {
    for (let i = 0; i < count; i++) await this.frame();
  }
}

/** Assembles a numbered PNG sequence into an optimized GIF via ffmpeg. */
async function assembleGif(framesDir, outPath, { fps = 15, width = 1000 } = {}) {
  const vf =
    `fps=${fps},scale=${width}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
  await execFileP('ffmpeg', [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'frame_%04d.png'),
    '-vf', vf,
    '-loop', '0',
    outPath,
  ]);
}

/**
 * A synthetic on-screen pointer overlaid on the page so the cursor is visible
 * in screenshots (the real OS cursor is never captured). It tracks the
 * Playwright mouse in lockstep and shows a press ring while the button is held.
 */
class Pointer {
  constructor(page) {
    this.page = page;
    this.x = 0;
    this.y = 0;
    this.pressed = false;
  }
  async install() {
    await this.page.evaluate(() => {
      if (document.getElementById('__cursor')) return;
      const style = document.createElement('style');
      style.textContent =
        '#__cursor{position:fixed;left:0;top:0;z-index:10000;pointer-events:none;' +
        'transform:translate(-2px,-2px);filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))}' +
        '#__cursor .ring{position:absolute;left:0;top:0;width:34px;height:34px;' +
        'margin:-17px 0 0 -17px;border-radius:50%;background:rgba(229,57,53,.35);' +
        'opacity:0;transform:scale(.4);transition:opacity .1s ease,transform .1s ease}' +
        '#__cursor.down .ring{opacity:1;transform:scale(1)}';
      document.head.appendChild(style);
      const el = document.createElement('div');
      el.id = '__cursor';
      el.innerHTML =
        '<div class="ring"></div>' +
        '<svg width="22" height="30" viewBox="0 0 22 30">' +
        '<path d="M2 2 L2 23 L7.5 17.5 L11 26 L14 24.7 L10.5 16.5 L18 16.5 Z" ' +
        'fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    });
  }
  async _sync() {
    await this.page.evaluate(({ x, y, pressed }) => {
      const el = document.getElementById('__cursor');
      if (!el) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.classList.toggle('down', pressed);
    }, { x: this.x, y: this.y, pressed: this.pressed });
  }
  async moveTo(x, y) {
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
    await this._sync();
  }
  async press() {
    this.pressed = true;
    await this.page.mouse.down();
    await this._sync();
  }
  async release() {
    this.pressed = false;
    await this.page.mouse.up();
    await this._sync();
  }
}

/** Captures the cursor-anchored scroll-to-zoom feature. */
async function captureZoom(page, pointer) {
  const container = page.locator('.wavesurfer-container');
  const box = await container.boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

  // Two distinct anchor points. We zoom in/out on the first, glide the cursor
  // to the second, and zoom in again: the waveform feature under the cursor
  // stays put both times, showing the zoom is centred on the cursor.
  const cursorY = Math.round(box.y + box.height / 2);
  const xA = Math.round(box.x + box.width * 0.30);
  const xB = Math.round(box.x + box.width * 0.70);

  // A full-height marker line that tracks the cursor's x, so the fixed point is
  // legible across the whole waveform.
  await page.evaluate(({ x, top, height }) => {
    const el = document.createElement('div');
    el.id = '__zoom_marker';
    Object.assign(el.style, {
      position: 'fixed', left: `${x}px`, top: `${top}px`, height: `${height}px`,
      width: '2px', background: 'rgba(229,57,53,0.9)', zIndex: '9999', pointerEvents: 'none',
    });
    document.body.appendChild(el);
  }, { x: xA, top: box.y, height: box.height });
  const setMarker = (x) =>
    page.evaluate((px) => {
      const el = document.getElementById('__zoom_marker');
      if (el) el.style.left = `${px}px`;
    }, x);

  const rec = new Recorder(page, 'zoom', clip);
  await rec.init();

  // wheel down => +10 per tick (zoom in); wheel up => zoom out.
  const zoom = async (dir, ticks) => {
    for (let i = 0; i < ticks; i++) {
      await page.mouse.wheel(0, dir * 150);
      await sleep(70);
      await rec.frame();
    }
  };

  await pointer.moveTo(xA, cursorY);
  await rec.hold(6);
  await zoom(1, 16);
  await rec.hold(8);
  await zoom(-1, 16);
  await rec.hold(8);

  // Glide the cursor (and marker) to the second anchor point.
  const glide = 12;
  for (let i = 1; i <= glide; i++) {
    const x = Math.round(xA + ((xB - xA) * i) / glide);
    await pointer.moveTo(x, cursorY);
    await setMarker(x);
    await sleep(35);
    await rec.frame();
  }
  await rec.hold(8);
  await zoom(1, 16);
  await rec.hold(8);
  await zoom(-1, 16);
  await rec.hold(6);

  await page.evaluate(() => document.getElementById('__zoom_marker')?.remove());
  return rec;
}

/**
 * Finds the widest open-ended region and the screen rect of its right handle.
 * Regions live in WaveSurfer's shadow DOM, so we use Playwright locators (which
 * pierce shadow roots) rather than document.querySelectorAll.
 */
async function findOpenEndedRegion(page) {
  const regions = page.locator('[part^="region segment_"]');
  const count = await regions.count();
  let best = null;
  for (let i = 0; i < count; i++) {
    const el = regions.nth(i);
    const box = await el.boundingBox();
    if (!box || box.width < 35) continue;
    const meta = await el.evaluate((node) => {
      const h = node.querySelector('[part*="region-handle-right"]');
      return {
        id: node.getAttribute('part'),
        dashed: h ? getComputedStyle(h).borderRightStyle === 'dashed' : false,
      };
    });
    if (!meta.dashed) continue;
    const cand = {
      id: meta.id,
      left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, width: box.width,
    };
    if (!best || cand.width > best.width) best = cand;
  }
  return best;
}

/** Returns the screen rect of a specific region by its `part` id. */
async function getRegionBox(page, id) {
  const el = page.locator(`[part="${id}"]`);
  const box = await el.boundingBox();
  if (!box) return null;
  return { id, left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, width: box.width };
}

/** Captures separating a joined segment from the next, then re-joining it. */
async function captureSplit(page, pointer) {
  const target = await findOpenEndedRegion(page);
  if (!target) throw new Error('No open-ended region wide enough to demo.');

  const container = page.locator('.wavesurfer-container');
  const box = await container.boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

  // Zoom in, anchored on the target region, so the gap is clearly legible.
  // Wheeling over the region keeps it under the cursor and in view.
  const midY = (target.top + target.bottom) / 2;
  await pointer.moveTo((target.left + target.right) / 2, midY);
  for (let i = 0; i < 9; i++) {
    await page.mouse.wheel(0, 150);
    await sleep(80);
  }
  await sleep(500);

  const region = await getRegionBox(page, target.id);
  console.log('Splitting region', region.id, `(width ${Math.round(region.width)}px)`);

  const handleX = region.right - 3;
  const handleY = (region.top + region.bottom) / 2;
  const regionMidX = (region.left + region.right) / 2;

  const rec = new Recorder(page, 'split', clip);
  await rec.init();

  // Hover the region body to reveal the ghost handle, then grab it.
  await pointer.moveTo(regionMidX, handleY);
  await rec.hold(3);
  await pointer.moveTo(handleX, handleY);
  await rec.hold(2);
  await pointer.press();
  await sleep(50);
  await rec.hold(5);

  const travel = Math.min(120, Math.round(region.width * 0.6));
  const steps = 14;
  // Drag the end leftward: separates the segment, opening a gap before the next.
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(handleX - (travel * i) / steps, handleY);
    await sleep(35);
    await rec.frame();
  }
  await rec.hold(8);
  // Drag it back to the next region's start: re-joins (snaps back to open-ended).
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(handleX - travel + (travel * i) / steps, handleY);
    await sleep(35);
    await rec.frame();
  }
  await rec.hold(6);
  await pointer.release();
  await rec.hold(6);

  // Phase 3: now that the two segments are joined, dragging the START of the
  // next segment drags the END of this (open-ended) one along with it: their
  // shared boundary moves as one.
  const num = parseInt(region.id.match(/segment_(\d+)/)[1], 10);
  const next = await getRegionBox(page, `region segment_${num + 1}`);
  const prev = await getRegionBox(page, region.id);
  if (next && prev) {
    const nextStartX = next.left + 3;
    const nextStartY = (next.top + next.bottom) / 2;
    // Stay clear of the previous segment's start so the drag isn't clamped.
    const travel2 = Math.min(100, Math.round(next.left - prev.left - 12));
    await pointer.moveTo(nextStartX, nextStartY);
    await rec.hold(4);
    await pointer.press();
    await sleep(50);
    await rec.hold(5);
    // Drag the next segment's start left: the previous segment's end follows.
    for (let i = 1; i <= steps; i++) {
      await pointer.moveTo(nextStartX - (travel2 * i) / steps, nextStartY);
      await sleep(35);
      await rec.frame();
    }
    await rec.hold(8);
    // Drag it back to restore.
    for (let i = 1; i <= steps; i++) {
      await pointer.moveTo(nextStartX - travel2 + (travel2 * i) / steps, nextStartY);
      await sleep(35);
      await rec.frame();
    }
    await rec.hold(6);
    await pointer.release();
    await rec.hold(4);
  }
  return rec;
}

async function main() {
  const feature = process.argv[2] || 'all';
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [page error]', m.text());
  });

  await setupAdjustView(page);
  console.log('Adjust view ready.');

  const pointer = new Pointer(page);
  await pointer.install();

  if (feature === 'probe') {
    const shot = path.join(OUT_DIR, 'probe.png');
    await page.locator('.timing-adjustment-tab').screenshot({ path: shot });
    console.log('Wrote', shot);
  }

  if (feature === 'diag') {
    const regions = page.locator('[part^="region segment_"]');
    const count = await regions.count();
    const info = [];
    for (let i = 0; i < count; i++) {
      const el = regions.nth(i);
      const box = await el.boundingBox();
      const meta = await el.evaluate((node) => ({
        id: node.getAttribute('part'),
        border: node.querySelector('[part*="region-handle-right"]')
          ? getComputedStyle(node.querySelector('[part*="region-handle-right"]')).borderRightStyle : 'none',
        text: node.textContent.trim(),
      }));
      info.push({ ...meta, w: box ? Math.round(box.width) : 0 });
    }
    console.log(`count=${count}`);
    console.log(JSON.stringify(info));
  }

  if (feature === 'zoom' || feature === 'all') {
    const rec = await captureZoom(page, pointer);
    const out = path.join(OUT_DIR, 'waveform-zoom.gif');
    // The whole waveform changes every frame, so keep this one leaner.
    await assembleGif(rec.dir, out, { fps: 13, width: 820 });
    console.log('Wrote', out, `(${rec.n} frames)`);
  }

  if (feature === 'split' || feature === 'all') {
    const rec = await captureSplit(page, pointer);
    const out = path.join(OUT_DIR, 'segment-split-join.gif');
    await assembleGif(rec.dir, out);
    console.log('Wrote', out, `(${rec.n} frames)`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
