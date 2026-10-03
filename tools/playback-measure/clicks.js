// Clicks Timing tab rectangles one after the other, and logs each click and, on every frame,
// the player's position and where the waveform drew the playhead. Paste the function into a
// browser tool's script evaluation on the Timing tab, in Adjust mode, then read the log from
// receive.py once it has posted. It takes about two seconds per rectangle, plus their length.
//
// It returns at once and posts when done, since browser tools time scripts out. Set
// window.measureRun = { name, segments } first to name the run and pick the rectangles.
() => {
  const { name = "run", segments = [2, 3, 5, 8, 9, 13, 16, 19, 23, 30] } = window.measureRun ?? {};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => performance.timeOrigin + performance.now();
  let adjuster;
  for (let c = document.querySelector(".timing-adjuster").__vueParentComponent; c; c = c.parent) {
    if (c.proxy?.playRange) {
      adjuster = c.proxy;
      break;
    }
  }
  const { player } = adjuster;
  const shadow = [...document.querySelectorAll(".wavesurfer-container *")].find(
    (el) => el.shadowRoot,
  ).shadowRoot;
  const scroll = shadow.querySelector(".scroll");
  const cursor = shadow.querySelector(".cursor");
  const duration = player.duration;
  const pixelsPerSecond = shadow.querySelector(".wrapper").scrollWidth / duration;
  const ranges = [];
  const frames = [];
  const clicks = [];

  const playRange = adjuster.playRange.bind(adjuster);
  adjuster.playRange = (start, end) => {
    ranges.push([start, end, now()]);
    return playRange(start, end);
  };
  // The player moves the waveform's playhead on each frame before this runs, so this reads the
  // playhead that frame draws.
  const logFrame = () => {
    if (player.paused) return;
    const left = parseFloat(cursor.style.left);
    const drawn = Number.isFinite(left) ? (left / 100) * duration : null;
    frames.push([now(), player.currentTime, drawn]);
  };
  player.addEventListener("timeupdate", logFrame);

  // A synthetic click isn't a user gesture, so the page needs a real click before this, such
  // as on the Play button, or Firefox never starts the AudioContext.
  const click = (target) => {
    const box = target.getBoundingClientRect();
    const at = {
      clientX: box.left + Math.min(box.width / 2, 20),
      clientY: box.top + box.height / 2,
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      const down = type.endsWith("down");
      target.dispatchEvent(
        new Event(type, { ...at, bubbles: true, composed: true, buttons: down ? 1 : 0 }),
      );
    }
  };

  const run = async () => {
    await wait(2500);
    for (const segment of segments) {
      const region = adjuster.regions.find((r) => r.id === `segment_${segment}`);
      scroll.scrollLeft = region.start * pixelsPerSecond - 200;
      await wait(300);
      clicks.push([segment, now()]);
      click(shadow.querySelector(`[part="region segment_${segment}"]`));
      await wait(100);
      for (let i = 0; i < 100 && !player.paused; i++) await wait(50);
      await wait(1500);
    }
    player.removeEventListener("timeupdate", logFrame);
    adjuster.playRange = playRange;
    const log = { duration, rate: player.playbackRate, ranges, clicks, frames };
    await fetch(`http://127.0.0.1:8765/${name}`, { method: "POST", body: JSON.stringify(log) });
  };
  run().catch((error) => console.error("The measurement failed:", error));
  return `measuring ${segments.length} rectangles as ${name}`;
};
