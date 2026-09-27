// Draws each line in a waveform row of its own, framed by its display period.
// The frame's left and right edges can be dragged. The syllables inside are for reference only.

import { BasePlugin, BasePluginEvents } from "wavesurfer.js/dist/base-plugin";
import createElement from "wavesurfer.js/dist/dom";
import { DisplayBand } from "@/lib/displayBands";
import { makeDraggable } from "./OpenEndedRegionPlugin";

export type DisplayBandsPluginEvents = BasePluginEvents & {
  /** When an edge has been dragged to a new time */
  "band-updated": [segmentIndex: number, side: "start" | "end", time: number];
  /** When an edge has been double-clicked, to put it back on the automatic rules */
  "band-reset": [segmentIndex: number, side: "start" | "end"];
};

// Keep in sync with the region rows in OpenEndedRegionPlugin.
const ROWS = 5;
const ROW_INSET = 3;
const HANDLE_WIDTH = 12;
const FRAME_COLOR = "var(--region-label-on-waveform)";
const OVERLAP_COLOR = "var(--bulma-danger)";

class DisplayBandsPlugin extends BasePlugin<DisplayBandsPluginEvents, undefined> {
  private readonly container: HTMLElement;
  private bands: DisplayBand[] = [];
  private enabled = true;
  private cleanups: (() => void)[] = [];

  constructor() {
    super(undefined);
    this.container = createElement("div", {
      part: "display-bands",
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
    return new DisplayBandsPlugin();
  }

  /** Called by wavesurfer, don't call manually */
  onInit() {
    this.wavesurfer?.getWrapper().appendChild(this.container);
    this.subscriptions.push(this.wavesurfer!.on("ready", () => this.render()));
    this.render();
  }

  /**
   * Replace every band. Disabled bands are drawn faded and can't be dragged.
   */
  public setBands(bands: DisplayBand[], enabled: boolean) {
    this.bands = bands;
    this.enabled = enabled;
    this.render();
  }

  private render() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.container.replaceChildren();
    const duration = this.wavesurfer?.getDuration() ?? 0;
    if (!duration) return;
    this.container.style.opacity = this.enabled ? "1" : "0.4";
    for (const band of this.bands) {
      this.container.appendChild(this.createBand(band, duration));
    }
  }

  private createBand(band: DisplayBand, duration: number): HTMLElement {
    const percent = (time: number) => `${(time / duration) * 100}%`;
    const overlaps = band.placement?.overlaps ?? false;
    const color = overlaps ? OVERLAP_COLOR : FRAME_COLOR;
    const row = createElement("div", {
      style: {
        position: "absolute",
        left: "0",
        width: "100%",
        top: `calc(${(band.row * 100) / ROWS}% + ${ROW_INSET}px)`,
        height: `calc(${100 / ROWS}% - ${2 * ROW_INSET}px)`,
      },
    });

    for (const syllable of band.syllables) {
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
        textContent: overlaps ? `⚠ ${band.text}` : band.text,
        style: {
          position: "absolute",
          top: "1px",
          left: `calc(${percent(band.latestStart)} + 2px)`,
          whiteSpace: "nowrap",
          fontSize: "0.85em",
          color,
          textShadow: Array(3).fill("0 0 3px var(--bulma-scheme-main)").join(", "),
        },
      },
      row,
    );

    const frame = createElement(
      "div",
      {
        part: "display-band",
        style: {
          position: "absolute",
          top: "0",
          bottom: "0",
          boxSizing: "border-box",
          borderTop: `1px solid ${color}`,
          borderBottom: `1px solid ${color}`,
          borderLeft: `2px ${band.startStored ? "solid" : "dashed"} ${color}`,
          borderRight: `2px ${band.endStored ? "solid" : "dashed"} ${color}`,
          borderRadius: "3px",
        },
      },
      row,
    );
    if (overlaps) frame.dataset.overlaps = "";
    let { start, end } = band;
    const place = () => {
      frame.style.left = percent(start);
      frame.style.right = percent(duration - end);
    };
    place();

    for (const side of ["start", "end"] as const) {
      const handle = createElement(
        "div",
        {
          part: `display-band-handle display-band-${side}`,
          style: {
            position: "absolute",
            top: "0",
            height: "100%",
            width: `${HANDLE_WIDTH}px`,
            [side === "start" ? "left" : "right"]: `-${HANDLE_WIDTH / 2}px`,
            cursor: this.enabled ? "ew-resize" : "default",
            pointerEvents: this.enabled ? "all" : "none",
          },
        },
        frame,
      );

      // The waveform seeks on click, which the end of a drag would trigger.
      const stopClick = (event: MouseEvent) => event.stopPropagation();
      const reset = (event: MouseEvent) => {
        event.stopPropagation();
        this.emit("band-reset", band.segmentIndex, side);
      };
      handle.addEventListener("click", stopClick);
      handle.addEventListener("dblclick", reset);
      this.cleanups.push(() => {
        handle.removeEventListener("click", stopClick);
        handle.removeEventListener("dblclick", reset);
      });

      this.cleanups.push(
        makeDraggable(
          handle,
          (dx) => {
            const seconds = (dx / this.container.clientWidth) * duration;
            // An edge stops at its own line's timings and at the fixed part of a line at its height.
            if (side === "start") {
              const earliest = band.placement?.earliestStart ?? 0;
              start = Math.min(band.latestStart, Math.max(earliest, start + seconds));
            } else {
              const latest = band.placement?.latestEnd ?? duration;
              end = Math.max(band.earliestEnd, Math.min(latest, end + seconds));
            }
            place();
          },
          undefined,
          () => this.emit("band-updated", band.segmentIndex, side, side === "start" ? start : end),
          1,
        ),
      );
    }
    return row;
  }

  /** Destroy the plugin and clean up */
  public destroy() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.container.remove();
    super.destroy();
  }
}

export default DisplayBandsPlugin;
