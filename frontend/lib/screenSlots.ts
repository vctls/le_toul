import { GLYPH_BLOCK_RATIO } from "@/constants";
import { displayEndOf, displayStartOf } from "./adjustments";
import type { LyricsLine, LyricsScreen, Timestamp, VoiceTrackRender } from "./timing";

// A lyrics line where the video draws it, in subtitle canvas units, and when, in the render's time.
export interface SlottedLine {
  line: LyricsLine;
  screen: LyricsScreen;
  // The index of the line's voice among the renders.
  voice: number;
  top: number;
  bottom: number;
  // The part of the display period that can't give way to another line: the timings and the stored bounds.
  fixedStart: Timestamp;
  fixedEnd: Timestamp;
  startStored: boolean;
  endStored: boolean;
}

/**
 * Whether two lines are drawn at heights that overlap.
 */
export function sameHeight(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

/**
 * Every lyrics line of every voice, placed as the video draws it.
 */
export function slotLines(renders: VoiceTrackRender[]): SlottedLine[] {
  return renders.flatMap((render, voice) => {
    const { size } = render.options.font;
    const stored = render.options.useStoredDisplayPeriods;
    return render.screens
      .filter((screen) => screen.kind === "lyrics")
      .flatMap((screen) =>
        screen.lines.map((line, lineInScreen) => {
          const top = screen.getLineY(lineInScreen, size, render.options.verticalAlignment);
          const startStored = stored && line.storedDisplayStart !== undefined;
          const endStored = stored && line.storedDisplayEnd !== undefined;
          return {
            line,
            screen,
            voice,
            top,
            bottom: top + size * GLYPH_BLOCK_RATIO,
            fixedStart: startStored ? displayStartOf(line, screen) : line.timestamp,
            fixedEnd: endStored ? displayEndOf(line, screen) : line.endTimestamp,
            startStored,
            endStored,
          };
        }),
      );
  });
}

/**
 * The lines at `line`'s height whose fixed parts don't overlap its own.
 * The ones that do can't be separated, so they are left overlapping.
 */
export function separableNeighbours(line: SlottedLine, lines: SlottedLine[]): SlottedLine[] {
  return lines.filter(
    (other) =>
      other !== line &&
      sameHeight(line, other) &&
      !(other.fixedStart < line.fixedEnd && line.fixedStart < other.fixedEnd),
  );
}

/**
 * An automatic bound gives way to the fixed part of any line at its height, in any voice,
 * so the line appears once that line has ended, or disappears as it appears.
 * A bound only ever moves towards the line's own timings, so giving way never makes a new overlap.
 */
export function giveWayToStoredPeriods(renders: VoiceTrackRender[]): void {
  const lines = slotLines(renders);
  if (!lines.some((line) => line.startStored || line.endStored)) {
    return;
  }
  for (const slotted of lines) {
    const { line, screen } = slotted;
    const neighbours = separableNeighbours(slotted, lines);
    const start = displayStartOf(line, screen);
    const end = displayEndOf(line, screen);
    if (!slotted.startStored) {
      const before = neighbours.filter(
        (other) => other.fixedStart < slotted.fixedStart && other.fixedEnd > start,
      );
      if (before.length > 0) {
        line.customDisplayStartTime = Math.max(...before.map((other) => other.fixedEnd));
        line.startGaveWay = true;
      }
    }
    if (!slotted.endStored) {
      const after = neighbours.filter(
        (other) => other.fixedEnd > slotted.fixedEnd && other.fixedStart < end,
      );
      if (after.length > 0) {
        line.customDisplayEndTime = Math.min(...after.map((other) => other.fixedStart));
        line.endGaveWay = true;
      }
    }
  }
}
