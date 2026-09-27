// Draws each line in a waveform row of its own, framed by its display period.
// The frame's left and right edges can be dragged. The syllables inside are for reference only.
// Hovering or dragging a frame tints it and lifts it over the others, and more lightly tints
// the frames of lines drawn at the same height in the video.
// Frames can overlap, so the handles are drawn over every frame, even the lifted one.

import { BasePlugin, BasePluginEvents } from "wavesurfer.js/dist/base-plugin";
import createElement from "wavesurfer.js/dist/dom";
import { DisplayBand } from "@/lib/displayBands";
import { sameHeight } from "@/lib/linePlacements";
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
const HANDLE_WIDTH = 16;
const FRAME_COLOR = "var(--region-label-on-waveform)";
const OVERLAP_COLOR = "var(--bulma-danger)";
const ACTIVE_FILL = "color-mix(in srgb, var(--bulma-primary) 45%, transparent)";
const SAME_HEIGHT_FILL = "color-mix(in srgb, var(--bulma-primary) 20%, transparent)";
const LIMIT_COLOR = "var(--bulma-primary)";
// The fills are translucent, so the more frames overlap, the darker the area they share.
const restFill = (color: string) => `color-mix(in srgb, ${color} 7%, transparent)`;
// The z-indexes of the lifted frame, and of the halves of each handle outside and inside its frame.
const LIFTED_Z = "1";
const OUTER_HANDLE_Z = "2";
const INNER_HANDLE_Z = "3";

const bandColor = (band: DisplayBand) => (band.placement?.overlaps ? OVERLAP_COLOR : FRAME_COLOR);

class DisplayBandsPlugin extends BasePlugin<DisplayBandsPluginEvents, undefined> {
  private readonly container: HTMLElement;
  private bands: DisplayBand[] = [];
  private enabled = true;
  private cleanups: (() => void)[] = [];
  private frames: { band: DisplayBand; row: HTMLElement; frame: HTMLElement }[] = [];
  private limits: Record<"start" | "end", HTMLElement> | undefined;
  private hovered?: DisplayBand;
  private dragged?: DisplayBand;

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
    this.frames = [];
    this.hovered = undefined;
    this.dragged = undefined;
    this.container.replaceChildren();
    const duration = this.wavesurfer?.getDuration() ?? 0;
    if (!duration) return;
    this.container.style.opacity = this.enabled ? "1" : "0.4";
    for (const band of this.bands) {
      this.createBand(band, duration);
    }
    const limit = (side: "start" | "end") =>
      createElement(
        "div",
        {
          part: `display-band-limit display-band-limit-${side}`,
          style: {
            position: "absolute",
            top: "0",
            height: "100%",
            borderLeft: `2px dashed ${LIMIT_COLOR}`,
            display: "none",
          },
        },
        this.container,
      );
    this.limits = { start: limit("start"), end: limit("end") };
  }

  private createBand(band: DisplayBand, duration: number) {
    const percent = (time: number) => `${(time / duration) * 100}%`;
    const overlaps = band.placement?.overlaps ?? false;
    const color = bandColor(band);
    const rowStyle = {
      position: "absolute",
      left: "0",
      width: "100%",
      top: `calc(${(band.row * 100) / ROWS}% + ${ROW_INSET}px)`,
      height: `calc(${100 / ROWS}% - ${2 * ROW_INSET}px)`,
    };
    const row = createElement("div", { style: rowStyle }, this.container);
    // The handles sit outside the frame's row, so a lifted row can't cover them.
    // Their layer must not get a z-index, or theirs would only apply inside it.
    const handles = createElement("div", { style: rowStyle }, this.container);

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
          // The rounded corners show which side of an edge its frame is on.
          borderRadius: "var(--bulma-control-radius)",
          backgroundColor: restFill(color),
          pointerEvents: this.enabled ? "auto" : "none",
        },
      },
      row,
    );
    if (overlaps) frame.dataset.overlaps = "";
    this.frames.push({ band, row, frame });
    const hoverables: HTMLElement[] = [frame];
    let { start, end } = band;
    const edges = {} as Record<"start" | "end", HTMLElement>;
    const place = () => {
      frame.style.left = percent(start);
      frame.style.right = percent(duration - end);
      edges.start.style.left = `calc(${percent(start)} - ${HANDLE_WIDTH / 2}px)`;
      edges.end.style.left = `calc(${percent(end)} - ${HANDLE_WIDTH / 2}px)`;
    };

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
            cursor: this.enabled ? "ew-resize" : "default",
            pointerEvents: this.enabled ? "all" : "none",
          },
        },
        handles,
      );
      edges[side] = handle;
      hoverables.push(handle);
      // Where two edges meet, their handles overlap.
      // The half inside each frame is on top, so each side of the edge grabs its own line.
      for (const half of ["left", "right"] as const) {
        const inside = (side === "start") === (half === "right");
        createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: "0",
              height: "100%",
              width: `${HANDLE_WIDTH / 2}px`,
              [half]: "0",
              zIndex: inside ? INNER_HANDLE_Z : OUTER_HANDLE_Z,
            },
          },
          handle,
        );
      }

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
          () => this.setDragged(band),
          () => {
            this.setDragged(undefined);
            this.emit("band-updated", band.segmentIndex, side, side === "start" ? start : end);
          },
          1,
        ),
      );
    }
    place();

    // A handle isn't inside its frame, so it keeps the frame hovered on its own.
    const enter = () => this.setHovered(band);
    const leave = () => this.setHovered(undefined);
    for (const element of hoverables) {
      element.addEventListener("mouseenter", enter);
      element.addEventListener("mouseleave", leave);
      this.cleanups.push(() => {
        element.removeEventListener("mouseenter", enter);
        element.removeEventListener("mouseleave", leave);
      });
    }
  }

  private setHovered(band: DisplayBand | undefined) {
    this.hovered = band;
    this.highlightFrames();
  }

  private setDragged(band: DisplayBand | undefined) {
    this.dragged = band;
    this.highlightFrames();
  }

  /**
   * Tint and lift the dragged or hovered frame, and more lightly tint the frames of the lines
   * drawn at its height. Mark how far its edges can be dragged before they reach one of those lines.
   */
  private highlightFrames() {
    // A drag keeps its highlight when the pointer leaves the frame.
    const active = this.dragged ?? this.hovered;
    for (const { band, row, frame } of this.frames) {
      row.style.zIndex = band === active ? LIFTED_Z : "";
      const atSameHeight =
        active?.placement !== undefined &&
        band.placement !== undefined &&
        sameHeight(band.placement, active.placement);
      frame.style.backgroundColor =
        band === active ? ACTIVE_FILL : atSameHeight ? SAME_HEIGHT_FILL : restFill(bandColor(band));
    }
    const duration = this.wavesurfer?.getDuration() ?? 0;
    if (!this.limits || !duration) return;
    // A limit at the song's bounds comes from no line, so it isn't marked.
    const { earliestStart = 0, latestEnd = duration } = active?.placement ?? {};
    const times = {
      start: earliestStart > 0 ? earliestStart : undefined,
      end: latestEnd < duration ? latestEnd : undefined,
    };
    for (const side of ["start", "end"] as const) {
      const time = times[side];
      Object.assign(this.limits[side].style, {
        display: time === undefined ? "none" : "",
        left: time === undefined ? "" : `${(time / duration) * 100}%`,
      });
    }
  }

  /** Destroy the plugin and clean up */
  public destroy() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.container.remove();
    super.destroy();
  }
}

export default DisplayBandsPlugin;
