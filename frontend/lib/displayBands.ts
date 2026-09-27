import { minBy } from "lodash-es";
import { createScreens, KaraokeOptions, LyricsLine } from "./timing";
import { TimedSegment } from "./timedSegments";
import { LinePlacement } from "./linePlacements";

// One line's display period as the Adjust tab draws it, in song time.
export interface DisplayBand {
  // The index of the segment that holds the line's stored period.
  segmentIndex: number;
  // The waveform row the line is drawn in.
  row: number;
  text: string;
  syllables: { start: number; end: number }[];
  start: number;
  end: number;
  startStored: boolean;
  endStored: boolean;
  // A period always contains the line's timings, so its edges can't be dragged past them.
  latestStart: number;
  earliestEnd: number;
  // Where and when the video draws the line, when it is known.
  // It also moves a bound that gives way to another line, which this layout alone can't tell.
  placement?: LinePlacement;
}

// The number of rows the Adjust tab lays regions out in.
const ROWS = 5;

/**
 * Every line's display period, automatic or stored, as the render computes it.
 * The title screen and count-ins are left out, since they move the song away from song time.
 * `placements` are keyed by the index of each line's first segment.
 */
export function displayBands(
  segments: TimedSegment[],
  songDuration: number,
  options: KaraokeOptions,
  placements: ReadonlyMap<number, LinePlacement> = new Map(),
): DisplayBand[] {
  const screens = createScreens(segments, songDuration, "", "", {
    ...options,
    addTitleScreen: false,
    countInMode: "none",
    useStoredDisplayPeriods: true,
  });
  const placement = (line: LyricsLine) => placements.get(line.headIndex ?? 0);
  return screens
    .filter((screen) => screen.kind === "lyrics")
    .flatMap((screen) => screen.lines.map((line) => ({ screen, line })))
    .map(({ screen, line }, index) => ({
      segmentIndex: line.headIndex ?? 0,
      // Consecutive lines never share a row, so lines on neighbouring screens can overlap in time.
      row: index % ROWS,
      text: line.segments
        .map((segment) => segment.text)
        .join("")
        .trim(),
      syllables: line.segments.map((segment) => ({
        start: segment.timestamp,
        end: segment.endTimestamp ?? segment.timestamp,
      })),
      start:
        placement(line)?.startGaveWay ?? line.customDisplayStartTime ?? screen.startTimestamp ?? 0,
      end: placement(line)?.endGaveWay ?? line.customDisplayEndTime ?? screen.endTimestamp,
      startStored: line.storedDisplayStart !== undefined,
      endStored: line.storedDisplayEnd !== undefined,
      latestStart: line.timestamp,
      earliestEnd: line.endTimestamp,
      placement: placement(line),
    }));
}

/**
 * The times a dragged edge of `band` snaps to: the edges of the lines in other rows,
 * and the first syllable of the next line.
 */
export function snapTargets(bands: DisplayBand[], band: DisplayBand): number[] {
  const next = bands[bands.indexOf(band) + 1];
  return [
    // Two edges at the same time in one row can't be told apart, so the band's own row is left out.
    ...bands.filter((other) => other.row !== band.row).flatMap((other) => [other.start, other.end]),
    ...(next ? [next.latestStart] : []),
  ];
}

/**
 * The target nearest `time`, if one is within `tolerance` of it and between `min` and `max`.
 */
export function nearestTarget(
  time: number,
  targets: number[],
  tolerance: number,
  min: number,
  max: number,
): number | undefined {
  const distance = (target: number) => Math.abs(target - time);
  return minBy(
    targets.filter((target) => target >= min && target <= max && distance(target) <= tolerance),
    distance,
  );
}
