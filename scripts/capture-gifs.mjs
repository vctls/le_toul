/**
 * Generates the animated GIFs the README uses, by driving the running app with
 * Playwright, capturing frame sequences, and assembling them with ffmpeg.
 *
 * Prereqs: the Vite dev server must be running (npm run dev, port 5173) and
 * ffmpeg must be on PATH.
 *
 *   node scripts/capture-gifs.mjs [feature...]
 *
 * feature: any of the keys in CAPTURES, or "all" (default). "probe" writes a
 * single validation screenshot of the adjust view instead.
 */
import { chromium } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const OUT_DIR = path.join(ROOT, "docs", "media");
const FRAME_DIR = path.join(ROOT, ".gif-frames");
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

const AUDIO = path.join(FIXTURES, "Ma Rainey - Prove It on Me Blues, first verse.mp3");
const LYRICS = path.join(FIXTURES, "lyrics.txt");
const TIMINGS = path.join(FIXTURES, "timings.json");
const SETTINGS = path.join(FIXTURES, "settings.yaml");
const SPLIT_ZIP = path.join(FIXTURES, "split_song.zip");

// Frame rate the GIFs are assembled at. The captures pace their own sleeps to
// roughly match, so raising it makes the result quicker rather than smoother.
const FPS = 20;

// Every GIF is rendered at this width so they line up down the README. Each
// capture picks its own clip, so only the heights differ.
const WIDTH = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Assembles a numbered PNG sequence into an optimized GIF via ffmpeg. */
async function assembleGif(framesDir, outPath, { fps = FPS, width = WIDTH } = {}) {
  // No dithering: the captures are flat UI, so dither only stipples the solid
  // areas, which looks worse and costs a third of the file size.
  const vf =
    `fps=${fps},scale=${width}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=none`;
  await execFileP("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(framesDir, "frame_%04d.png"),
    "-vf",
    vf,
    "-loop",
    "0",
    outPath,
  ]);
}

/**
 * Rescales a still to the shared width. Screenshots come out at the device scale
 * factor, so they ship at 2x to stay sharp on dense displays while laying out at
 * the same width as the GIFs.
 */
async function normalizeStill(filePath, width = WIDTH * 2) {
  const tmp = `${filePath}.tmp.png`;
  await execFileP("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-vf",
    `scale=${width}:-1:flags=lanczos`,
    tmp,
  ]);
  await fs.rename(tmp, filePath);
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
    const file = path.join(this.dir, `frame_${String(this.n).padStart(4, "0")}.png`);
    await this.page.screenshot({ path: file, clip: this.clip });
  }
  async hold(count) {
    for (let i = 0; i < count; i++) await this.frame();
  }
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
      if (document.getElementById("__cursor")) return;
      const style = document.createElement("style");
      style.textContent =
        "#__cursor{position:fixed;left:0;top:0;z-index:10000;pointer-events:none;" +
        "transform:translate(-2px,-2px);filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))}" +
        "#__cursor .ring{position:absolute;left:0;top:0;width:34px;height:34px;" +
        "margin:-17px 0 0 -17px;border-radius:50%;background:rgba(229,57,53,.35);" +
        "opacity:0;transform:scale(.4);transition:opacity .1s ease,transform .1s ease}" +
        "#__cursor.down .ring{opacity:1;transform:scale(1)}";
      document.head.appendChild(style);
      const el = document.createElement("div");
      el.id = "__cursor";
      el.innerHTML =
        '<div class="ring"></div>' +
        '<svg width="22" height="30" viewBox="0 0 22 30">' +
        '<path d="M2 2 L2 23 L7.5 17.5 L11 26 L14 24.7 L10.5 16.5 L18 16.5 Z" ' +
        'fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    });
  }
  async _sync() {
    await this.page.evaluate(
      ({ x, y, pressed }) => {
        const el = document.getElementById("__cursor");
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.classList.toggle("down", pressed);
      },
      { x: this.x, y: this.y, pressed: this.pressed },
    );
  }
  async moveTo(x, y) {
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
    await this._sync();
  }
  async click(x, y) {
    await this.moveTo(x, y);
    await this.press();
    await sleep(40);
    await this.release();
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
  /** Moves in steps so the cursor reads as travelling rather than teleporting. */
  async glideTo(x, y, rec, steps = 8, delay = 25) {
    const x0 = this.x;
    const y0 = this.y;
    for (let i = 1; i <= steps; i++) {
      await this.moveTo(
        Math.round(x0 + ((x - x0) * i) / steps),
        Math.round(y0 + ((y - y0) * i) / steps),
      );
      await sleep(delay);
      if (rec) await rec.frame();
    }
  }
}

// --- app setup -------------------------------------------------------------

async function gotoApp(page) {
  await page.goto(BASE_URL);
  await page.waitForSelector("nav.tabs");
}

async function uploadSong(page) {
  await page.click("nav.tabs .song-info-tab-header");
  await page.locator('[name="song-file-upload"] [type="file"]').setInputFiles(AUDIO);
  await page.locator('[name="artist"]').waitFor();
}

async function enterLyrics(page, text) {
  await page.click("nav.tabs .lyric-input-tab-header");
  const lyrics = text ?? (await fs.readFile(LYRICS, "utf-8"));
  await page.locator(".lyric-input-tab .lyric-editor-textarea").fill(lyrics);
}

/** Uploading a timings file marks timings complete, which enables the Adjust tab. */
async function uploadTimings(page) {
  await page.click("nav.tabs .song-info-tab-header");
  await page.click("button:has-text('Advanced')");
  await page.locator('[name="timings-file-upload"] input[type="file"]').setInputFiles(TIMINGS);
}

async function openAdjustTab(page) {
  await page.click("nav.tabs .timing-adjustment-tab-header");
  await page.locator('h2:has-text("Adjust Timings")').waitFor();
  await page.locator(".wavesurfer-container").waitFor();
  await page.locator('[part^="region segment_"]').first().waitFor({ timeout: 30000 });
  await sleep(1200);
}

/** Drives the app from a blank slate into a ready-to-interact Adjust view. */
async function setupAdjustView(page) {
  await gotoApp(page);
  await uploadSong(page);
  await enterLyrics(page);
  await uploadTimings(page);
  await openAdjustTab(page);
}

/** A screenshot clip for an element, clamped to the viewport. */
async function clipFor(page, locator, { pad = 0, maxHeight = null } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(150);
  const box = await locator.boundingBox();
  const view = page.viewportSize();
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(view.width - x, box.width + pad * 2);
  let height = Math.min(view.height - y, box.height + pad * 2);
  if (maxHeight) height = Math.min(height, maxHeight);
  return { x, y, width: Math.round(width), height: Math.round(height) };
}

// --- region helpers --------------------------------------------------------

/** Returns the screen rect of a region by its `part` id. */
async function getRegionBox(page, id) {
  const box = await page.locator(`[part="${id}"]`).boundingBox();
  if (!box) return null;
  return {
    id,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    width: box.width,
  };
}

const segmentBox = (page, i) => getRegionBox(page, `region segment_${i}`);

/**
 * Finds the widest open-ended region and its rect. Regions live in WaveSurfer's
 * shadow DOM, so we use Playwright locators (which pierce shadow roots) rather
 * than document.querySelectorAll.
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
        id: node.getAttribute("part"),
        dashed: h ? getComputedStyle(h).borderRightStyle === "dashed" : false,
      };
    });
    if (!meta.dashed) continue;
    const cand = {
      id: meta.id,
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
      width: box.width,
    };
    if (!best || cand.width > best.width) best = cand;
  }
  return best;
}

/** Wheel-zooms the waveform under the cursor. One wheel event is worth ±10 zoom. */
async function wheelZoom(page, ticks, dir = 1, rec = null, delay = 40) {
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, dir * 150);
    await sleep(delay);
    if (rec) await rec.frame();
  }
}

/** Zooms in on the region under the cursor until it is wide enough to read. */
async function zoomUntilWide(page, id, minWidth, maxTicks = 26) {
  for (let i = 0; i < maxTicks; i++) {
    const box = await getRegionBox(page, id);
    if (box && box.width >= minWidth) break;
    await page.mouse.wheel(0, 150);
    await sleep(55);
  }
  await sleep(400);
  return getRegionBox(page, id);
}

/**
 * Narrows a clip to a window around the action. The waveform container spans the
 * whole page, so a full-width frame leaves the gesture a few pixels wide.
 */
function focusClip(clip, centreX, width) {
  const w = Math.min(width, clip.width);
  const x = Math.round(Math.min(Math.max(centreX - w / 2, clip.x), clip.x + clip.width - w));
  return { ...clip, x, width: Math.round(w) };
}

/** Segment rectangles wholly inside the clip, in left-to-right order. */
async function visibleSegments(page, clip) {
  const regions = page.locator('[part^="region segment_"]');
  const count = await regions.count();
  const out = [];
  for (let i = 0; i < count; i++) {
    const el = regions.nth(i);
    const id = await el.getAttribute("part");
    const index = parseInt(id.match(/segment_(\d+)/)[1], 10);
    const box = await el.boundingBox();
    if (!box) continue;
    if (box.x < clip.x || box.x + box.width > clip.x + clip.width) continue;
    out.push({
      index,
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
    });
  }
  return out.sort((a, b) => a.left - b.left);
}

// --- captures --------------------------------------------------------------

/** Cursor-anchored scroll-to-zoom: the feature under the cursor stays put. */
async function captureZoom(page) {
  await setupAdjustView(page);
  const pointer = new Pointer(page);
  await pointer.install();

  const clip = await clipFor(page, page.locator(".wavesurfer-container"));
  const cursorY = Math.round(clip.y + clip.height / 2);
  const xA = Math.round(clip.x + clip.width * 0.3);
  const xB = Math.round(clip.x + clip.width * 0.7);

  // A full-height marker line tracking the cursor's x, so the fixed point stays
  // legible across the whole waveform.
  await page.evaluate(
    ({ x, top, height }) => {
      const el = document.createElement("div");
      el.id = "__zoom_marker";
      Object.assign(el.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${top}px`,
        height: `${height}px`,
        width: "2px",
        background: "rgba(229,57,53,0.9)",
        zIndex: "9999",
        pointerEvents: "none",
      });
      document.body.appendChild(el);
    },
    { x: xA, top: clip.y, height: clip.height },
  );
  const setMarker = (x) =>
    page.evaluate((px) => {
      const el = document.getElementById("__zoom_marker");
      if (el) el.style.left = `${px}px`;
    }, x);

  const rec = new Recorder(page, "zoom", clip);
  await rec.init();

  await pointer.moveTo(xA, cursorY);
  await rec.hold(3);
  await wheelZoom(page, 12, 1, rec);
  await rec.hold(4);
  await wheelZoom(page, 12, -1, rec);
  await rec.hold(3);

  const glide = 8;
  for (let i = 1; i <= glide; i++) {
    const x = Math.round(xA + ((xB - xA) * i) / glide);
    await pointer.moveTo(x, cursorY);
    await setMarker(x);
    await sleep(25);
    await rec.frame();
  }
  await rec.hold(3);
  await wheelZoom(page, 12, 1, rec);
  await rec.hold(4);
  await wheelZoom(page, 12, -1, rec);
  await rec.hold(3);

  await page.evaluate(() => document.getElementById("__zoom_marker")?.remove());
  return { rec };
}

/** Separating a joined segment from the next, re-joining it, then moving the shared edge. */
async function captureSplit(page) {
  await setupAdjustView(page);
  const pointer = new Pointer(page);
  await pointer.install();

  // Scroll the waveform into place before measuring anything: the region rects
  // are viewport coordinates, and the pointer has to land on them to zoom.
  const container = await clipFor(page, page.locator(".wavesurfer-container"));

  const target = await findOpenEndedRegion(page);
  if (!target) throw new Error("No open-ended region wide enough to demo.");

  // Zoom in anchored on the target so the gap is legible. Wheeling over the
  // region keeps it under the cursor and in view.
  await pointer.moveTo((target.left + target.right) / 2, (target.top + target.bottom) / 2);
  const region = await zoomUntilWide(page, target.id, 130);
  console.log("  splitting", region.id, `(width ${Math.round(region.width)}px)`);

  const handleX = region.right - 3;
  const handleY = (region.top + region.bottom) / 2;

  const clip = focusClip(container, (region.left + region.right) / 2, 560);
  const rec = new Recorder(page, "split", clip);
  await rec.init();

  // Hover the body to reveal the ghost handle, then grab it.
  await pointer.moveTo((region.left + region.right) / 2, handleY);
  await rec.hold(2);
  await pointer.moveTo(handleX, handleY);
  await rec.hold(2);
  await pointer.press();
  await rec.hold(3);

  const travel = Math.min(120, Math.round(region.width * 0.6));
  const steps = 11;
  // Drag the end leftward: separates the segment, opening a gap before the next.
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(handleX - (travel * i) / steps, handleY);
    await sleep(25);
    await rec.frame();
  }
  await rec.hold(6);
  // Drag it back to the next region's start: re-joins, snapping back to open-ended.
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(handleX - travel + (travel * i) / steps, handleY);
    await sleep(25);
    await rec.frame();
  }
  await rec.hold(4);
  await pointer.release();
  await rec.hold(4);

  // Now that the two are joined, dragging the START of the next segment drags
  // the END of this one along with it: their shared boundary moves as one.
  const num = parseInt(region.id.match(/segment_(\d+)/)[1], 10);
  const next = await segmentBox(page, num + 1);
  const prev = await getRegionBox(page, region.id);
  if (next && prev) {
    const nextStartX = next.left + 3;
    const nextStartY = (next.top + next.bottom) / 2;
    // Stay clear of the previous segment's start so the drag isn't clamped.
    const travel2 = Math.min(100, Math.round(next.left - prev.left - 12));
    await pointer.moveTo(nextStartX, nextStartY);
    await rec.hold(3);
    await pointer.press();
    await rec.hold(3);
    for (let i = 1; i <= steps; i++) {
      await pointer.moveTo(nextStartX - (travel2 * i) / steps, nextStartY);
      await sleep(25);
      await rec.frame();
    }
    await rec.hold(6);
    for (let i = 1; i <= steps; i++) {
      await pointer.moveTo(nextStartX - travel2 + (travel2 * i) / steps, nextStartY);
      await sleep(25);
      await rec.frame();
    }
    await rec.hold(4);
    await pointer.release();
    await rec.hold(3);
  }
  return { rec };
}

/** Click-to-select a run of rectangles, then drag the whole run as one. */
async function captureGroupDrag(page) {
  await setupAdjustView(page);
  const pointer = new Pointer(page);
  await pointer.install();

  const container = await clipFor(page, page.locator(".wavesurfer-container"));

  // Enough zoom for the labels to read, but not so much that a run of four
  // rectangles stops fitting in one window.
  const anchor = await segmentBox(page, 4);
  await pointer.moveTo((anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2);
  await wheelZoom(page, 10, 1, null, 55);
  await sleep(400);

  // A run of four consecutive rectangles, as near the middle of the waveform as
  // the layout allows, so the drag has room on both sides.
  const visible = await visibleSegments(page, container);
  const runs = [];
  for (let i = 0; i + 3 < visible.length; i++) {
    const run = visible.slice(i, i + 4);
    if (run[3].index - run[0].index !== 3) continue;
    runs.push(run);
  }
  if (runs.length === 0) throw new Error("No run of four consecutive rectangles on screen.");
  const containerMid = container.x + container.width / 2;
  const run = runs.reduce((best, r) => {
    const mid = (r[0].left + r[3].right) / 2;
    return Math.abs(mid - containerMid) <
      Math.abs((best[0].left + best[3].right) / 2 - containerMid)
      ? r
      : best;
  });
  const [first, , middle, last] = run;

  const clip = focusClip(container, (first.left + last.right) / 2, 620);
  const rec = new Recorder(page, "group-drag", clip);
  await rec.init();

  const centre = (b) => [(b.left + b.right) / 2, (b.top + b.bottom) / 2];

  await pointer.moveTo(...centre(first));
  await rec.hold(3);
  await pointer.click(...centre(first));
  await rec.hold(4);

  // Clicking a second rectangle extends the selection over everything between.
  await pointer.glideTo(...centre(last), rec, 8, 25);
  await pointer.click(...centre(last));
  await rec.hold(6);

  // Dragging any selected rectangle moves the whole selection at once.
  const [mx, my] = centre(middle);
  await pointer.glideTo(mx, my, rec, 6, 25);
  await rec.hold(2);
  await pointer.press();
  await rec.hold(3);

  const travel = 70;
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(mx + (travel * i) / steps, my);
    await sleep(25);
    await rec.frame();
  }
  await rec.hold(6);
  for (let i = 1; i <= steps; i++) {
    await pointer.moveTo(mx + travel - (travel * i) / steps, my);
    await sleep(25);
    await rec.frame();
  }
  await rec.hold(4);
  await pointer.release();
  await rec.hold(3);

  // Esc clears the selection.
  await page.keyboard.press("Escape");
  await rec.hold(6);

  return { rec };
}

/** Builds a folder shaped like an extracted export from the Submit tab. */
async function makeProjectFolder() {
  const folder = path.join(FRAME_DIR, "project");
  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  await fs.copyFile(AUDIO, path.join(folder, "song.mp3"));
  await fs.copyFile(LYRICS, path.join(folder, "lyrics.txt"));
  await fs.copyFile(TIMINGS, path.join(folder, "timings.json"));
  await fs.copyFile(SETTINGS, path.join(folder, "settings.yaml"));
  await fs.writeFile(path.join(folder, "subtitles.ass"), "[Script Info]\n");
  await fs.writeFile(path.join(folder, "Ma Rainey - Prove It On Me Blues [karaoke].mp4"), "");
  return folder;
}

/**
 * The session round trip: Start Over throws the project away, then pointing the
 * Advanced panel at an exported folder brings all of it back.
 */
async function captureSessionRoundTrip(page) {
  const folder = await makeProjectFolder();
  await gotoApp(page);
  await uploadSong(page);
  await page.locator('[name="title"]').waitFor();
  await page.click("button:has-text('Advanced')");
  await page.locator('[name="project-folder-upload"]').waitFor();
  await sleep(500);

  const pointer = new Pointer(page);
  await pointer.install();

  // One frame has to hold the navbar button at the top right, the song details
  // that empty and refill, the folder picker down in Advanced, and the toast.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  const form = await page.locator(".song-info-tab").boundingBox();
  const view = page.viewportSize();
  const clip = {
    x: Math.max(0, Math.round(form.x - 12)),
    y: 0,
    width: Math.round(Math.min(view.width - Math.max(0, form.x - 12), form.width + 24)),
    height: Math.round(Math.min(form.y + form.height + 12, view.height)),
  };

  const rec = new Recorder(page, "session-round-trip", clip);
  await rec.init();
  await rec.hold(5);

  // Start Over, and confirm it.
  const startOver = page.locator('button[title*="Discard the saved session"]');
  const sbox = await startOver.boundingBox();
  await pointer.moveTo(sbox.x + sbox.width / 2, sbox.y + sbox.height + 80);
  await rec.hold(2);
  await pointer.glideTo(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, rec, 8, 30);
  await rec.hold(3);
  await pointer.click(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
  for (let i = 0; i < 9; i++) {
    await sleep(50);
    await rec.frame();
  }
  await rec.hold(5);

  const confirm = page.locator(".modal-card-foot button", { hasText: "Start Over" }).last();
  const cbox = await confirm.boundingBox();
  await pointer.glideTo(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2, rec, 8, 30);
  await rec.hold(3);
  await pointer.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);

  // The form empties out.
  for (let i = 0; i < 18; i++) {
    await sleep(55);
    await rec.frame();
  }
  await rec.hold(6);

  // Start Over resets the tab's own state too, so Advanced has to be reopened
  // before the folder picker is there to aim at.
  const upload = page.locator('[name="project-folder-upload"] .file-cta');
  if ((await upload.count()) === 0) {
    const advanced = page.locator("button:has-text('Advanced')");
    const abox = await advanced.boundingBox();
    await pointer.glideTo(abox.x + abox.width / 2, abox.y + abox.height / 2, rec, 7, 30);
    await pointer.click(abox.x + abox.width / 2, abox.y + abox.height / 2);
    await upload.waitFor();
    for (let i = 0; i < 7; i++) {
      await sleep(50);
      await rec.frame();
    }
  }

  const ubox = await upload.boundingBox();
  const ux = ubox.x + ubox.width / 2;
  const uy = ubox.y + ubox.height / 2;
  await pointer.glideTo(ux, uy, rec, 8, 30);
  await rec.hold(3);
  await pointer.press();
  await rec.frame();
  await rec.frame();
  await pointer.release();

  await page.locator('[name="project-folder-upload"] input[type="file"]').setInputFiles(folder);

  // Fields refill and a toast reports what was loaded.
  for (let i = 0; i < 34; i++) {
    await sleep(60);
    await rec.frame();
  }
  return { rec };
}

const MULTI_VOICE_LYRICS = [
  "[Anna]Went_out_last_night,_had_a_great_big_fight",
  "[Ben]E/very/thing_seemed_to_go_on_wrong",
  "[Anna]I_looked_up,_to_my_sur/prise",
  "[Anna+Ben]The_gal_I_was_with_was_gone",
].join("\n");

/** Tagging lines with [Voice] splits the lyrics into independent voices. */
async function captureMultiVoice(page) {
  await gotoApp(page);
  await uploadSong(page);
  await enterLyrics(page);

  const editor = page.locator(".lyric-input-tab .lyric-editor-textarea");
  const clip = await clipFor(page, page.locator(".lyric-input-tab"), { pad: 8, maxHeight: 480 });

  const rec = new Recorder(page, "multi-voice", clip);
  await rec.init();
  await rec.hold(6);

  // Type the tags in a line at a time, so the split reads as an edit rather than a jump.
  const plain = (await fs.readFile(LYRICS, "utf-8")).split("\n");
  const tagged = MULTI_VOICE_LYRICS.split("\n");
  for (let i = 0; i < tagged.length; i++) {
    const tag = tagged[i].slice(0, tagged[i].indexOf("]") + 1);
    for (let c = 1; c <= tag.length; c++) {
      const lines = plain.map((line, j) =>
        j < i ? tagged[j] : j === i ? tag.slice(0, c) + line : line,
      );
      await editor.fill(lines.join("\n"));
      if (c % 2 === 0 || c === tag.length) await rec.frame();
      await sleep(20);
    }
    await rec.hold(2);
  }
  await rec.hold(8);

  // The Voice selector appears wherever a voice is timed, and switches the tab
  // over to that voice's own lines.
  const pointer = new Pointer(page);
  await page.click("nav.tabs .song-timing-tab-header");
  await page.locator('h2:has-text("Song Timing")').waitFor();
  await pointer.install();

  // Both halves must share a frame size, or ffmpeg cannot assemble the sequence.
  const timingClip = await clipFor(page, page.locator(".song-timing-tab"), { pad: 8 });
  rec.clip = { ...timingClip, width: clip.width, height: clip.height };
  await rec.hold(10);

  const select = page.locator(".song-timing-tab .voice-selector select");
  const sbox = await select.boundingBox();
  await pointer.moveTo(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
  await rec.hold(4);
  for (const voice of ["Ben", "Anna", "Ben"]) {
    await select.selectOption(voice);
    await sleep(120);
    await rec.hold(9);
  }
  return { rec };
}

/** The Song Timing tab's transport: speed, pitch lock, seek bar, tap keys. */
async function captureTimingControls(page) {
  await gotoApp(page);
  await uploadSong(page);
  await enterLyrics(page);
  await page.click("nav.tabs .song-timing-tab-header");
  await page.locator('h2:has-text("Song Timing")').waitFor();

  const pointer = new Pointer(page);
  await pointer.install();
  const clip = await clipFor(page, page.locator(".song-timing-tab"), { pad: 8, maxHeight: 440 });

  const rec = new Recorder(page, "timing-controls", clip);
  await rec.init();
  await rec.hold(5);

  // Drop to half speed for a fast passage, and hold the original key while there.
  // Buefy hides the radio itself; the clickable target is its label.
  const slow = page.locator('.playback-speed input[type="radio"][value="0.5"]').locator("xpath=..");
  const sbox = await slow.boundingBox();
  await pointer.glideTo(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, rec, 8, 30);
  await pointer.click(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
  await rec.hold(6);

  const pitch = page.locator('.preserve-pitch input[type="checkbox"]').locator("xpath=..");
  const pbox = await pitch.boundingBox();
  await pointer.glideTo(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2, rec, 8, 30);
  await pointer.click(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
  await rec.hold(6);

  // Tap the start/end keys against playback: the highlight advances as each
  // segment is marked and the seek bar tracks the song.
  await page.click(".song-timing-tab button[name='song-timing-play-pause']");
  const taps = ["Space", "Enter", "Space", "Enter", "Space", "Enter"];
  for (const key of taps) {
    for (let i = 0; i < 7; i++) {
      await sleep(45);
      await rec.frame();
    }
    await page.keyboard.press(key);
    await rec.hold(3);
  }
  await rec.hold(6);
  await page.click(".song-timing-tab button[name='song-timing-play-pause']");
  await rec.hold(4);

  return { rec };
}

// The stages the backend actually reports, from api/karaoke/separation_progress.py.
// Scripted here so the progress GIF walks the whole sequence in a few seconds
// instead of the few minutes a real separation takes.
const SEPARATION_SCRIPT = [
  ["reading the song", 0.03],
  ["reading the song", 0.09],
  ["separating the vocals", 0.17],
  ["separating the vocals", 0.28],
  ["separating the vocals", 0.4],
  ["separating the vocals", 0.52],
  ["separating the vocals", 0.63],
  ["separating the vocals", 0.74],
  ["separating the vocals", 0.85],
  ["packaging the tracks", 0.93],
  ["packaging the tracks", 0.98],
];

/**
 * Stands in for the separation backend: `/separate_track` hands back a poll URL,
 * and the poll walks SEPARATION_SCRIPT before serving the fixture ZIP.
 */
async function mockSeparation(page, { intervalSeconds = 0.55 } = {}) {
  const pollUrl = "https://storage.googleapis.com/le-toul-demo/separated_tracks/split_song.zip";
  const cors = { "Access-Control-Allow-Origin": "*" };

  await page.route("**/separate_track", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({ finishedTrackURL: pollUrl }),
    }),
  );

  let step = 0;
  await page.route(pollUrl, async (route) => {
    if (step < SEPARATION_SCRIPT.length) {
      const [stage, progress] = SEPARATION_SCRIPT[step++];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({ stage, progress, pollIntervalSeconds: intervalSeconds }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/zip",
      headers: cors,
      body: await fs.readFile(SPLIT_ZIP),
    });
  });
}

/** Separation progress: the named stage and bar, plus the ring on the tab header. */
async function captureSeparation(page) {
  await gotoApp(page);
  await mockSeparation(page);
  await uploadSong(page);
  await sleep(400);

  const pointer = new Pointer(page);
  await pointer.install();

  // Both indicators in one frame: the tab rail on the left carries the ring,
  // the bar appears under the button at the bottom of the form.
  await page.evaluate(() => window.scrollTo(0, 0));
  const button = page.locator("button:has-text('Separate Track')");
  const bbox = await button.boundingBox();
  const form = await page.locator(".song-info-tab").boundingBox();
  const view = page.viewportSize();
  const clip = {
    x: 0,
    y: 0,
    // Out to the form's right edge: the bar spans it, and its Cancel button
    // sits at the far end.
    width: Math.round(Math.min(form.x + form.width, view.width)),
    // Room below the button for the bar, which only appears once the job starts.
    height: Math.round(Math.min(bbox.y + bbox.height + 160, view.height)),
  };

  const rec = new Recorder(page, "separation", clip);
  await rec.init();

  await pointer.moveTo(bbox.x + bbox.width / 2, bbox.y - 90);
  await rec.hold(3);
  await pointer.glideTo(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2, rec, 7, 30);
  await rec.hold(2);
  await pointer.press();
  await rec.frame();
  await pointer.release();

  // Follow the stages until the finished track lands. Driven by the bar rather
  // than a frame count, since a screenshot costs more wall time than a poll.
  const bar = page.locator(".separation-progress");
  for (let i = 0; i < 90; i++) {
    await rec.frame();
    if (i > 4 && (await bar.count()) === 0) break;
    await sleep(40);
  }
  await rec.hold(8);
  return { rec };
}

/** The Edit tab, cropped to the timing text itself. */
async function shootEditTab(page, outPath) {
  await gotoApp(page);
  await uploadSong(page);
  await enterLyrics(page);
  await uploadTimings(page);
  await page.click("nav.tabs .timing-edit-tab-header, nav.tabs li:has-text('Edit') a");
  await page.locator('h2:has-text("Edit Timings")').waitFor();
  await page.locator(".timing-editor-textarea").waitFor();
  await sleep(600);

  const field = page.locator(".timing-edit-tab .editor-field");
  await field.scrollIntoViewIfNeeded();
  await sleep(200);
  const box = await field.boundingBox();

  // The editor is `white-space: pre`, and the fixture's first line is far longer
  // than the rest. Start the crop at the second line so none of them runs off
  // the edge, and keep it narrow enough that the tags stay readable.
  const metrics = await page.locator(".timing-editor-textarea").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lineHeight: parseFloat(cs.lineHeight), padTop: parseFloat(cs.paddingTop) };
  });

  await page.screenshot({
    path: outPath,
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y + metrics.padTop + metrics.lineHeight),
      width: Math.round(Math.min(box.width, 1060)),
      height: Math.round(metrics.lineHeight * 3 + 16),
    },
  });
  await normalizeStill(outPath);
}

/** The Submit tab, with a separated backing track so the preview has something to show. */
async function shootSubmitTab(page, outPath) {
  await gotoApp(page);
  await mockSeparation(page, { intervalSeconds: 0.05 });
  await uploadSong(page);
  await enterLyrics(page);
  await uploadTimings(page);

  await page.click("nav.tabs .song-info-tab-header");
  await page.click("button:has-text('Separate Track')");
  await page.locator(".separation-progress").waitFor({ state: "detached", timeout: 60000 });

  await page.click("nav.tabs .submit-tab-header, nav.tabs li:has-text('Submit') a");
  await page.locator('h2:has-text("More Settings")').waitFor();
  await sleep(2500);

  // Park the preview mid-line, so the canvas shows rendered lyrics rather than
  // the blank frame the video opens on.
  await page.evaluate(() => {
    const audio = document.querySelector(".submit-tab audio");
    if (audio) audio.currentTime = 6;
  });
  await sleep(1500);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.locator(".submit-tab").screenshot({ path: outPath });
  await normalizeStill(outPath);
}

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

const CAPTURES = {
  zoom: { fn: captureZoom, out: "waveform-zoom.gif" },
  split: { fn: captureSplit, out: "segment-split-join.gif" },
  "group-drag": { fn: captureGroupDrag, out: "region-group-drag.gif" },
  "round-trip": {
    fn: captureSessionRoundTrip,
    out: "start-over-and-restore.gif",
    // Tall enough for the whole Song Info form with Advanced open.
    viewport: { width: 1180, height: 1180 },
  },
  "multi-voice": { fn: captureMultiVoice, out: "multi-voice.gif" },
  "timing-controls": { fn: captureTimingControls, out: "timing-controls.gif" },
  separation: {
    fn: captureSeparation,
    out: "separation-progress.gif",
    viewport: { width: 1280, height: 1030 },
  },
  "edit-tab": { fn: shootEditTab, out: "edit-tab.png", viewport: { width: 1560, height: 800 } },
  "submit-tab": {
    fn: shootSubmitTab,
    out: "submit-tab.png",
    viewport: { width: 1280, height: 1100 },
  },
};

async function main() {
  const args = process.argv.slice(2);
  const requested = args.length === 0 || args.includes("all") ? Object.keys(CAPTURES) : args;

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });

  // Each capture gets a fresh context: the app persists a session, so a reused
  // one would start from the previous capture's state.
  const withPage = async (fn, viewport = DEFAULT_VIEWPORT, outPath = null) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log("  [page error]", m.text());
    });
    try {
      return await fn(page, outPath);
    } finally {
      await context.close();
    }
  };

  if (requested.includes("probe")) {
    await withPage(async (page) => {
      await setupAdjustView(page);
      const shot = path.join(OUT_DIR, "probe.png");
      await page.locator(".timing-adjustment-tab").screenshot({ path: shot });
      console.log("Wrote", shot);
    });
  }

  for (const name of requested) {
    const capture = CAPTURES[name];
    if (!capture) continue;
    console.log(`\n== ${name}`);
    const out = path.join(OUT_DIR, capture.out);
    // A still capture writes the file itself and returns nothing.
    const { rec } = (await withPage(capture.fn, capture.viewport, out)) ?? {};
    if (rec) await assembleGif(rec.dir, out);
    const { size } = await fs.stat(out);
    const frames = rec ? `${rec.n} frames, ` : "";
    console.log(`Wrote ${out} (${frames}${Math.round(size / 1024)} KB)`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
