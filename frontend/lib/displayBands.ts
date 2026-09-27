import { createScreens, KaraokeOptions } from "./timing";
import { TimedSegment } from "./timedSegments";

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
}

// The number of rows the Adjust tab lays regions out in.
const ROWS = 5;

/**
 * Every line's display period, automatic or stored, as the render computes it.
 * The title screen and count-ins are left out, since they move the song away from song time.
 */
export function displayBands(
  segments: TimedSegment[],
  songDuration: number,
  options: KaraokeOptions,
): DisplayBand[] {
  const screens = createScreens(segments, songDuration, "", "", {
    ...options,
    addTitleScreen: false,
    countInMode: "none",
    useStoredDisplayPeriods: true,
  });
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
      start: line.customDisplayStartTime ?? screen.startTimestamp ?? 0,
      end: line.customDisplayEndTime ?? screen.endTimestamp,
      startStored: line.storedDisplayStart !== undefined,
      endStored: line.storedDisplayEnd !== undefined,
      latestStart: line.timestamp,
      earliestEnd: line.endTimestamp,
    }));
}
