// Draws the gap restore plan: each line in a waveform row of its own, framed by its muted period,
// and the original song's level as a line across the waveform, shaded below where it plays.
// A gap where the original sounds like the backing track is hatched, since restoring it changes
// nothing. A frame that starts after the line's first tap is shaded over the part of the line the
// original still plays. Nothing here can be dragged.

import { BasePlugin, BasePluginEvents } from "wavesurfer.js/dist/base-plugin.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { Span } from "@/lib/gapRestore";

export interface MixFrame extends Span {
  row: number;
  text: string;
  syllables: Span[];
  openEnd: boolean;
}

export interface MixGap extends Span {
  empty: boolean;
  fadeIn: number;
  fadeOut: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Keep in sync with the region rows in OpenEndedRegionPlugin.
const ROWS = 5;
const ROW_INSET = 3;
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

class MixPlugin extends BasePlugin<BasePluginEvents, undefined> {
  private readonly container: HTMLElement;
  private frames: MixFrame[] = [];
  private gaps: MixGap[] = [];
  private enabled = true;

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
   * Replace the plan. Gaps that the video won't restore are drawn faded.
   */
  public setPlan(frames: MixFrame[], gaps: MixGap[], enabled: boolean) {
    this.frames = frames;
    this.gaps = gaps;
    this.enabled = enabled;
    this.render();
  }

  private render() {
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
      const leads = frame.start > firstTap;
      if (leads) {
        createElement(
          "div",
          {
            part: "mix-frame-lead",
            style: {
              position: "absolute",
              top: "0",
              bottom: "0",
              left: percent(firstTap),
              width: percent(frame.start - firstTap),
              backgroundColor: LEAD_FILL,
            },
          },
          row,
        );
      }
      createElement(
        "div",
        {
          textContent: frame.openEnd ? `⚠ ${frame.text}` : frame.text,
          style: {
            position: "absolute",
            top: "1px",
            left: `calc(${percent(frame.start)} + 4px)`,
            maxWidth: `calc(${percent(frame.end - frame.start)} - 8px)`,
            overflow: "hidden",
            whiteSpace: "nowrap",
            fontSize: "0.85em",
            color: frame.openEnd ? WARNING_COLOR : FRAME_COLOR,
            textShadow: Array(3).fill("0 0 3px var(--bulma-scheme-main)").join(", "),
          },
        },
        row,
      );
      createElement(
        "div",
        {
          part: frame.openEnd ? "mix-frame mix-frame-open-end" : "mix-frame",
          style: {
            position: "absolute",
            top: "0",
            bottom: "0",
            left: percent(frame.start),
            width: percent(frame.end - frame.start),
            boxSizing: "border-box",
            border: `1px solid ${FRAME_COLOR}`,
            borderLeftWidth: "2px",
            borderRight: `2px ${frame.openEnd ? "solid" : "dashed"} ${
              frame.openEnd ? WARNING_COLOR : FRAME_COLOR
            }`,
            borderLeftStyle: leads ? "solid" : "dashed",
            borderLeftColor: leads ? WARNING_COLOR : FRAME_COLOR,
            borderRadius: "4px",
          },
        },
        row,
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
}

export default MixPlugin;
