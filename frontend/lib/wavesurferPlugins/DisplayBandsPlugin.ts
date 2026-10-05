// Draws each line in a waveform row of its own, framed by its display period.
// The frame's left and right edges can be dragged. The syllables inside are for reference only.
// Hovering or dragging a frame tints it and lifts it over the others, and more lightly tints
// the frames of lines drawn at the same height in the video.
// A dragged edge snaps to the edges of lines in other rows, unless Ctrl or Cmd is held.
// Clicking frames or dragging a box around them selects them. Dragging a selected frame moves the
// whole selection, and dragging one of its edges moves that edge of every frame in the selection.
// Frames can overlap, so the handles are drawn over every frame, even the lifted one.

import { BasePlugin, BasePluginEvents } from "wavesurfer.js/dist/base-plugin.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { groupBy, sortBy } from "lodash-es";
import {
  BandUpdate,
  clampBandShift,
  clampEdgeShift,
  DisplayBand,
  nearestTarget,
  snapTargets,
} from "@/lib/displayBands";
import { sameHeight } from "@/lib/linePlacements";
import { EDGE_LINE_COLOR, makeDraggable } from "./OpenEndedRegionPlugin";
import { listenForMarquee, MarqueeArea } from "./marquee";

export type DisplayBandsPluginEvents = BasePluginEvents & {
  /** When frames or edges have been dragged to new times */
  "bands-updated": [updates: BandUpdate[]];
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
const SELECTED_FILL = "color-mix(in srgb, var(--bulma-primary) 30%, transparent)";
const SELECTED_COLOR = "var(--bulma-primary)";
const LIMIT_COLOR = "var(--bulma-primary)";
// In pixels, so snapping feels the same at every zoom.
const SNAP_DISTANCE = 7;
// The fills are translucent, so the more frames overlap, the darker the area they share.
const restFill = (color: string) => `color-mix(in srgb, ${color} 7%, transparent)`;
// The z-indexes of the lifted frame, and of the halves of each handle outside and inside its frame.
const LIFTED_Z = "1";
const OUTER_HANDLE_Z = "2";
const INNER_HANDLE_Z = "3";

const bandColor = (band: DisplayBand) => (band.placement?.overlaps ? OVERLAP_COLOR : FRAME_COLOR);

/**
 * When the label after each band's own starts in its row. The last label of a row has none.
 */
function nextLabelStarts(bands: DisplayBand[]): Map<DisplayBand, number> {
  const ends = new Map<DisplayBand, number>();
  for (const row of Object.values(groupBy(bands, (band) => band.row))) {
    const sorted = sortBy(row, (band) => band.latestStart);
    sorted.slice(0, -1).forEach((band, i) => ends.set(band, sorted[i + 1].latestStart));
  }
  return ends;
}

class DisplayBandsPlugin extends BasePlugin<DisplayBandsPluginEvents, undefined> {
  private readonly container: HTMLElement;
  private bands: DisplayBand[] = [];
  private enabled = true;
  private cleanups: (() => void)[] = [];
  private frames: {
    band: DisplayBand;
    row: HTMLElement;
    frame: HTMLElement;
    show: (start: number, end: number) => void;
  }[] = [];
  private limits: Record<"start" | "end", HTMLElement> | undefined;
  private snapLine: HTMLElement | undefined;
  private hovered?: DisplayBand;
  private dragged?: DisplayBand;
  // Lines are kept by the index of their first segment, which a re-render doesn't change.
  private selected = new Set<number>();
  private anchor?: number;
  private moving?: { bands: DisplayBand[]; pointer: number; delta: number };

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
    const wrapper = this.wavesurfer!.getWrapper();
    wrapper.appendChild(this.container);
    // Only a click on the bare waveform targets the wrapper itself.
    const clearOnBareClick = (event: MouseEvent) => {
      if (event.target === wrapper && this.selected.size) this.clearSelection();
    };
    wrapper.addEventListener("click", clearOnBareClick);
    this.subscriptions.push(
      () => wrapper.removeEventListener("click", clearOnBareClick),
      this.wavesurfer!.on("ready", () => this.render()),
      listenForMarquee(this.wavesurfer!, {
        canStart: () => this.enabled && this.bands.length > 0,
        onChange: (area) => this.selectTouched(area),
      }),
    );
    this.render();
  }

  /**
   * Replace every band. Disabled bands are drawn faded and can't be dragged.
   */
  public setBands(bands: DisplayBand[], enabled: boolean) {
    this.bands = bands;
    this.enabled = enabled;
    const lines = new Set(bands.map((band) => band.segmentIndex));
    if (!enabled || [...this.selected].some((line) => !lines.has(line))) this.clearSelection();
    this.render();
  }

  private render() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.frames = [];
    this.hovered = undefined;
    this.dragged = undefined;
    this.moving = undefined;
    this.container.replaceChildren();
    const duration = this.wavesurfer?.getDuration() ?? 0;
    if (!duration) return;
    this.container.style.opacity = this.enabled ? "1" : "0.4";
    const labelEnds = nextLabelStarts(this.bands);
    for (const band of this.bands) {
      this.createBand(band, duration, labelEnds.get(band));
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
    this.snapLine = createElement(
      "div",
      {
        part: "display-band-snap",
        style: {
          position: "absolute",
          top: "0",
          height: "100%",
          borderLeft: `1px solid ${EDGE_LINE_COLOR}`,
          display: "none",
        },
      },
      this.container,
    );
    this.highlightFrames();
  }

  private showSnap(time: number | undefined, duration: number) {
    if (!this.snapLine) return;
    Object.assign(this.snapLine.style, {
      display: time === undefined ? "none" : "",
      left: time === undefined ? "" : `${(time / duration) * 100}%`,
    });
  }

  private createBand(band: DisplayBand, duration: number, labelEnd: number | undefined) {
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
          // A label runs on until the next one in its row, which hides the rest of it.
          maxWidth: labelEnd === undefined ? "" : percent(labelEnd - band.latestStart),
          overflow: "hidden",
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
          cursor: "grab",
          pointerEvents: this.enabled ? "auto" : "none",
        },
      },
      row,
    );
    if (overlaps) frame.dataset.overlaps = "";
    const hoverables: HTMLElement[] = [frame];
    const edges = {} as Record<"start" | "end", HTMLElement>;
    const show = (start: number, end: number) => {
      frame.style.left = percent(start);
      frame.style.right = percent(duration - end);
      edges.start.style.left = `calc(${percent(start)} - ${HANDLE_WIDTH / 2}px)`;
      edges.end.style.left = `calc(${percent(end)} - ${HANDLE_WIDTH / 2}px)`;
    };
    this.frames.push({ band, row, frame, show });

    const click = () => this.onFrameClicked(band);
    frame.addEventListener("click", click);
    this.cleanups.push(
      () => frame.removeEventListener("click", click),
      makeDraggable(
        frame,
        (dx) => this.onMove(dx),
        () => this.onMoveStart(band),
        () => this.onMoveEnd(),
      ),
    );

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

      // The pointer's time, before the edge is stopped or snapped.
      let pointer = 0;
      let targets: number[] = [];
      let snapping = true;
      let group: DisplayBand[] = [];
      let delta = 0;
      const move = () => {
        // An edge stops at its own line's timings and at the fixed part of a line at its height.
        const [min, max] =
          side === "start"
            ? [band.placement?.earliestStart ?? 0, band.latestStart]
            : [band.earliestEnd, band.placement?.latestEnd ?? duration];
        const tolerance = (SNAP_DISTANCE / this.container.clientWidth) * duration;
        const target = snapping ? nearestTarget(pointer, targets, tolerance, min, max) : undefined;
        // The line's own timings win when a line at its height leaves no room.
        const stopped =
          side === "start"
            ? Math.min(max, Math.max(min, pointer))
            : Math.max(min, Math.min(max, pointer));
        const wanted = (target ?? stopped) - band[side];
        // The other frames can stop the edge short of where it would snap.
        delta = clampEdgeShift(group, side, wanted, duration);
        this.showFrames(group, (other) =>
          side === "start" ? [other.start + delta, other.end] : [other.start, other.end + delta],
        );
        this.showSnap(delta === wanted ? target : undefined, duration);
      };
      const watchModifier = (event: KeyboardEvent | PointerEvent) => {
        // Ctrl or Cmd held turns snapping off.
        const on = !(event.ctrlKey || event.metaKey);
        if (on === snapping) return;
        snapping = on;
        move();
      };
      const modifierEvents = ["keydown", "keyup", "pointermove"] as const;
      const unwatchModifier = () =>
        modifierEvents.forEach((type) => window.removeEventListener(type, watchModifier));
      this.cleanups.push(unwatchModifier);

      this.cleanups.push(
        makeDraggable(
          handle,
          (dx) => {
            pointer += (dx / this.container.clientWidth) * duration;
            move();
          },
          () => {
            pointer = band[side];
            group = this.groupFor(band);
            targets = snapTargets(this.bands, band, group);
            snapping = true;
            delta = 0;
            modifierEvents.forEach((type) => window.addEventListener(type, watchModifier));
            this.setDragged(band);
          },
          () => {
            unwatchModifier();
            this.showSnap(undefined, duration);
            this.setDragged(undefined);
            // An edge that didn't move is stored where it is, but the rest of the selection is
            // left alone.
            this.emit(
              "bands-updated",
              (delta ? group : [band]).map((other) => ({
                segmentIndex: other.segmentIndex,
                [side]: other[side] + delta,
              })),
            );
          },
          1,
        ),
      );
    }
    show(band.start, band.end);

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

  private onFrameClicked(band: DisplayBand) {
    const line = band.segmentIndex;
    if (this.selected.has(line)) return this.clearSelection();
    const anchorAt = this.bands.findIndex((other) => other.segmentIndex === this.anchor);
    if (anchorAt === -1) {
      this.anchor = line;
      return this.setSelection([line]);
    }
    const clickedAt = this.bands.indexOf(band);
    this.setSelection(
      this.bands
        .slice(Math.min(anchorAt, clickedAt), Math.max(anchorAt, clickedAt) + 1)
        .map((other) => other.segmentIndex),
    );
  }

  /**
   * Select the frames the box touches. A click after the drag extends the selection from the side
   * the drag started on.
   */
  private selectTouched({ touches, forward }: MarqueeArea) {
    const touched = this.frames
      .filter(({ frame }) => touches(frame))
      .map(({ band }) => band.segmentIndex);
    this.anchor = forward ? touched[0] : touched[touched.length - 1];
    this.setSelection(touched);
  }

  public clearSelection() {
    this.anchor = undefined;
    this.setSelection([]);
  }

  private setSelection(lines: number[]) {
    this.selected = new Set(lines);
    this.highlightFrames();
  }

  /**
   * The selection if the band is in it, and the band alone otherwise.
   */
  private groupFor(band: DisplayBand): DisplayBand[] {
    return this.selected.has(band.segmentIndex)
      ? this.bands.filter((other) => this.selected.has(other.segmentIndex))
      : [band];
  }

  /**
   * Draw each of the bands' frames between the times `span` gives for it, without storing them.
   */
  private showFrames(bands: DisplayBand[], span: (band: DisplayBand) => [number, number]) {
    for (const { band, show } of this.frames) {
      if (bands.includes(band)) show(...span(band));
    }
  }

  private onMoveStart(band: DisplayBand) {
    this.moving = { bands: this.groupFor(band), pointer: 0, delta: 0 };
    this.setDragged(band);
  }

  private onMove(dx: number) {
    const duration = this.wavesurfer?.getDuration() ?? 0;
    const moving = this.moving;
    if (!moving || !duration) return;
    moving.pointer += (dx / this.container.clientWidth) * duration;
    const delta = clampBandShift(moving.bands, moving.pointer, duration);
    moving.delta = delta;
    this.showFrames(moving.bands, (band) => [band.start + delta, band.end + delta]);
  }

  private onMoveEnd() {
    const moving = this.moving;
    this.moving = undefined;
    this.setDragged(undefined);
    if (!moving?.delta) return;
    const { bands, delta } = moving;
    this.emit(
      "bands-updated",
      bands.map((band) => ({
        segmentIndex: band.segmentIndex,
        start: band.start + delta,
        end: band.end + delta,
      })),
    );
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
      const selected = this.selected.has(band.segmentIndex);
      frame.style.backgroundColor =
        band === active
          ? ACTIVE_FILL
          : selected
            ? SELECTED_FILL
            : atSameHeight
              ? SAME_HEIGHT_FILL
              : restFill(bandColor(band));
      frame.style.borderColor = selected ? SELECTED_COLOR : bandColor(band);
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
