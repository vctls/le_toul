// Draws the gap restore plan: each line in a waveform row of its own, framed by its muted period,
// and the original song's level as a line across the waveform, shaded below where it plays.
// A gap where the original sounds like the backing track is hatched, since restoring it changes
// nothing. A frame that starts after the line's first tap is shaded over the part of the line the
// original still plays. A frame's edges can be dragged, and stop where the frame would no longer
// cover its line.

import { BasePlugin, BasePluginEvents } from "wavesurfer.js/dist/base-plugin.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { MutedLine, Span } from "@/lib/gapRestore";
import { makeDraggable } from "./OpenEndedRegionPlugin";

export type MixFrame = Pick<
  MutedLine,
  | "start"
  | "end"
  | "voice"
  | "segmentIndex"
  | "text"
  | "syllables"
  | "openEnd"
  | "startStored"
  | "endStored"
  | "latestStart"
  | "earliestEnd"
> & { row: number };

export type MixPluginEvents = BasePluginEvents & {
  /** When a frame's edge has been dragged to a new time */
  "mute-updated": [frame: MixFrame, side: "start" | "end", time: number];
  /** When an edge has been double-clicked, to put it back on the automatic rules */
  "mute-reset": [frame: MixFrame, side: "start" | "end"];
};

export interface MixGap extends Span {
  empty: boolean;
  fadeIn: number;
  fadeOut: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Keep in sync with the region rows in OpenEndedRegionPlugin.
const ROWS = 5;
const ROW_INSET = 3;
const HANDLE_WIDTH = 16;
const FRAME_COLOR = "var(--region-label-on-waveform)";
const WARNING_COLOR = "var(--bulma-warning)";
const LEAD_FILL = "color-mix(in srgb, var(--bulma-warning) 35%, transparent)";
const GAP_FILL = "color-mix(in srgb, var(--bulma-primary) 18%, transparent)";
const ENVELOPE_COLOR = "var(--bulma-primary)";
// The original's full level is drawn this far below the top, as a percentage of the height, so
// the whole line stays in view.
const FULL_LEVEL_TOP = 3;
const EMPTY_GAP_FILL =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--bulma-primary) 14%, transparent) " +
  "0 4px, transparent 4px 10px)";

class MixPlugin extends BasePlugin<MixPluginEvents, undefined> {
  private readonly container: HTMLElement;
  private frames: MixFrame[] = [];
  private gaps: MixGap[] = [];
  private enabled = true;
  private cleanups: (() => void)[] = [];

  constructor() {
    super(undefined);
    this.container = createElement("div", {
      part: "mix",
      style: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "3",
        pointerEvents: "none",
      },
    });
  }

  public static create() {
    return new MixPlugin();
  }

  /** Called by wavesurfer, don't call manually */
  onInit() {
    this.wavesurfer!.getWrapper().appendChild(this.container);
    this.subscriptions.push(this.wavesurfer!.on("ready", () => this.render()));
    this.render();
  }

  /**
   * Replace the plan. Gaps that the video won't restore are drawn faded, and their frames can't
   * be dragged.
   */
  public setPlan(frames: MixFrame[], gaps: MixGap[], enabled: boolean) {
    this.frames = frames;
    this.gaps = gaps;
    this.enabled = enabled;
    this.render();
  }

  private render() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.container.replaceChildren();
    const duration = this.wavesurfer?.getDuration() ?? 0;
    if (!duration) return;
    const percent = (time: number) => `${(time / duration) * 100}%`;

    const opacity = this.enabled ? "1" : "0.4";
    for (const gap of this.gaps) {
      const length = gap.end - gap.start;
      const rise = (gap.fadeIn / length) * 100;
      const fall = 100 - (gap.fadeOut / length) * 100;
      createElement(
        "div",
        {
          part: gap.empty ? "mix-gap mix-gap-empty" : "mix-gap",
          style: {
            position: "absolute",
            top: `${FULL_LEVEL_TOP}%`,
            bottom: "0",
            left: percent(gap.start),
            width: percent(length),
            background: gap.empty ? EMPTY_GAP_FILL : GAP_FILL,
            clipPath: `polygon(0 100%, ${rise}% 0, ${fall}% 0, 100% 100%)`,
            opacity,
          },
        },
        this.container,
      );
    }
    this.drawEnvelope(duration, opacity);

    for (const frame of this.frames) {
      this.createFrame(frame, duration);
    }
  }

  private createFrame(frame: MixFrame, duration: number) {
    const percent = (time: number) => `${(time / duration) * 100}%`;
    const row = createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: "0",
          width: "100%",
          top: `calc(${(frame.row * 100) / ROWS}% + ${ROW_INSET}px)`,
          height: `calc(${100 / ROWS}% - ${2 * ROW_INSET}px)`,
        },
      },
      this.container,
    );
    for (const syllable of frame.syllables) {
      createElement(
        "div",
        {
          style: {
            position: "absolute",
            bottom: "3px",
            height: "35%",
            left: percent(syllable.start),
            width: `calc(${percent(syllable.end - syllable.start)} - 1px)`,
            backgroundColor: "var(--region-fill)",
            borderRadius: "2px",
          },
        },
        row,
      );
    }
    const firstTap = frame.syllables[0]?.start ?? frame.start;
    const lead = createElement(
      "div",
      {
        part: "mix-frame-lead",
        style: {
          position: "absolute",
          top: "0",
          bottom: "0",
          left: percent(firstTap),
          backgroundColor: LEAD_FILL,
        },
      },
      row,
    );
    const label = createElement(
      "div",
      {
        textContent: frame.openEnd ? `⚠ ${frame.text}` : frame.text,
        style: {
          position: "absolute",
          top: "1px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontSize: "0.85em",
          color: frame.openEnd ? WARNING_COLOR : FRAME_COLOR,
          textShadow: Array(3).fill("0 0 3px var(--bulma-scheme-main)").join(", "),
        },
      },
      row,
    );
    const box = createElement(
      "div",
      {
        part: frame.openEnd ? "mix-frame mix-frame-open-end" : "mix-frame",
        style: {
          position: "absolute",
          top: "0",
          bottom: "0",
          boxSizing: "border-box",
          border: `1px solid ${FRAME_COLOR}`,
          borderLeftWidth: "2px",
          borderRightWidth: "2px",
          borderRightStyle: frame.endStored ? "solid" : "dashed",
          borderRightColor: frame.openEnd ? WARNING_COLOR : FRAME_COLOR,
          borderLeftStyle: frame.startStored ? "solid" : "dashed",
          borderRadius: "4px",
        },
      },
      row,
    );
    const handles = {} as Record<"start" | "end", HTMLElement>;
    for (const side of ["start", "end"] as const) {
      handles[side] = createElement(
        "div",
        {
          part: `mix-frame-handle mix-frame-${side}`,
          style: {
            position: "absolute",
            top: "0",
            height: "100%",
            width: `${HANDLE_WIDTH}px`,
            cursor: "ew-resize",
            pointerEvents: this.enabled ? "all" : "none",
          },
        },
        row,
      );
    }
    const show = (start: number, end: number) => {
      const leads = start > firstTap;
      lead.style.display = leads ? "" : "none";
      lead.style.width = percent(start - firstTap);
      label.style.left = `calc(${percent(start)} + 4px)`;
      label.style.maxWidth = `calc(${percent(end - start)} - 8px)`;
      box.style.left = percent(start);
      box.style.width = percent(end - start);
      box.style.borderLeftColor = leads ? WARNING_COLOR : FRAME_COLOR;
      handles.start.style.left = `calc(${percent(start)} - ${HANDLE_WIDTH / 2}px)`;
      handles.end.style.left = `calc(${percent(end)} - ${HANDLE_WIDTH / 2}px)`;
    };
    show(frame.start, frame.end);

    for (const side of ["start", "end"] as const) {
      const handle = handles[side];
      // The waveform seeks on click, which the end of a drag would trigger.
      const stopClick = (event: MouseEvent) => event.stopPropagation();
      const reset = (event: MouseEvent) => {
        event.stopPropagation();
        this.emit("mute-reset", frame, side);
      };
      handle.addEventListener("click", stopClick);
      handle.addEventListener("dblclick", reset);
      this.cleanups.push(() => {
        handle.removeEventListener("click", stopClick);
        handle.removeEventListener("dblclick", reset);
      });

      // The pointer's time, before the edge is stopped.
      let pointer = 0;
      let time = 0;
      this.cleanups.push(
        makeDraggable(
          handle,
          (dx) => {
            pointer += (dx / this.container.clientWidth) * duration;
            time =
              side === "start"
                ? Math.max(0, Math.min(frame.latestStart, pointer))
                : Math.min(duration, Math.max(frame.earliestEnd, pointer));
            show(side === "start" ? time : frame.start, side === "end" ? time : frame.end);
          },
          () => {
            pointer = frame[side];
            time = frame[side];
          },
          () => this.emit("mute-updated", frame, side, time),
          1,
        ),
      );
    }
  }

  /**
   * The original's level as one line from the song's start to its end. The SVG stretches with the
   * waveform, so the line follows every zoom, and its stroke keeps its width.
   */
  private drawEnvelope(duration: number, opacity: string) {
    const y = (level: number) => 100 - (100 - FULL_LEVEL_TOP) * level;
    const points: Array<[number, number]> = [[0, y(0)]];
    for (const gap of this.gaps) {
      points.push(
        [gap.start, y(0)],
        [gap.start + gap.fadeIn, y(1)],
        [gap.end - gap.fadeOut, y(1)],
        [gap.end, y(0)],
      );
    }
    points.push([duration, y(0)]);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("part", "mix-envelope");
    svg.setAttribute("viewBox", `0 0 ${duration} 100`);
    svg.setAttribute("preserveAspectRatio", "none");
    Object.assign(svg.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      overflow: "visible",
      opacity,
    });
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", ENVELOPE_COLOR);
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
    this.container.appendChild(svg);
  }

  /** Destroy the plugin and clean up */
  public destroy() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.container.remove();
    super.destroy();
  }
}

export default MixPlugin;
