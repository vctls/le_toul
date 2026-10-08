// Draws the gap restore plan: each line in a waveform row of its own, framed by its muted period,
// and the gaps where the video plays the original song shaded across every row.
// A gap where the original sounds like the backing track is hatched, since restoring it changes
// nothing. Nothing here can be dragged.

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
}

// Keep in sync with the region rows in OpenEndedRegionPlugin.
const ROWS = 5;
const ROW_INSET = 3;
const FRAME_COLOR = "var(--region-label-on-waveform)";
const OPEN_END_COLOR = "var(--bulma-warning)";
const GAP_FILL = "color-mix(in srgb, var(--bulma-primary) 18%, transparent)";
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

    for (const gap of this.gaps) {
      createElement(
        "div",
        {
          part: gap.empty ? "mix-gap mix-gap-empty" : "mix-gap",
          style: {
            position: "absolute",
            top: "0",
            height: "100%",
            left: percent(gap.start),
            width: percent(gap.end - gap.start),
            background: gap.empty ? EMPTY_GAP_FILL : GAP_FILL,
            opacity: this.enabled ? "1" : "0.4",
          },
        },
        this.container,
      );
    }

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
            color: frame.openEnd ? OPEN_END_COLOR : FRAME_COLOR,
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
              frame.openEnd ? OPEN_END_COLOR : FRAME_COLOR
            }`,
            borderLeftStyle: "dashed",
            borderRadius: "4px",
          },
        },
        row,
      );
    }
  }
}

export default MixPlugin;
