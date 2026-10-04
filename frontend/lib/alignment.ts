// Syncing a voice's lyrics to its vocals on the backend, and writing the result into the voice.

import { API_HOSTNAME } from "@/constants";
import { JobWording, SeparationProgressCallback, pollForJson } from "@/lib/audio";
import { displayText } from "@/lib/timing";
import { TimedSegment } from "@/lib/timedSegments";

// "fill" syncs the lines around the segments without a start. "replace" syncs every segment.
export type SyncMode = "fill" | "replace";

// One segment as the backend reads it.
export interface SyncRequestSegment {
  // The text as drawn, without the `_` and `/` markup.
  text: string;
  endsLine: boolean;
  // False for a segment kept as it is, whose times bound the audio the others are synced in.
  sync: boolean;
  start?: number;
  end?: number;
}

// A sync made for a voice as it was when the sync was requested.
export interface PendingSync {
  segments: TimedSegment[];
  request: SyncRequestSegment[];
}

// One entry per segment sent, empty for a kept segment or one the aligner left untimed.
export interface SyncResultEntry {
  start?: number;
  end?: number;
  doubtful?: boolean;
}

export interface SyncResult {
  aligner: string;
  segments: SyncResultEntry[];
}

const SYNC_WORDING: JobWording = {
  doing: "syncing",
  name: "Syncing",
  gone: "The server no longer knows this sync. Please sync again.",
};

let availability: Promise<boolean> | null = null;

/**
 * Whether the server can sync, asked once per page load.
 */
export function isSyncAvailable(): Promise<boolean> {
  availability ??= fetch(`${API_HOSTNAME}/alignment/available`)
    .then((response) => (response.ok ? response.json() : { available: false }))
    .then((body) => body.available === true)
    .catch(() => {
      // An unreachable backend is asked again next time.
      availability = null;
      return false;
    });
  return availability;
}

/**
 * The sync to request for a voice's segments in the given mode.
 */
export function pendingSync(segments: TimedSegment[], mode: SyncMode): PendingSync {
  const filled = linesToFill(segments);
  return {
    segments: segments.map((segment) => ({ ...segment })),
    request: segments.map((segment, i) => {
      const sync = mode === "replace" || filled[i];
      return {
        text: displayText(segment.text).replace(/\n+$/, ""),
        endsLine: segment.text.endsWith("\n"),
        sync,
        start: sync ? undefined : segment.start,
        end: sync ? undefined : segment.end,
      };
    }),
  };
}

/**
 * For each segment, whether filling syncs it: its line, or a line next to it, has a segment
 * without a start.
 *
 * A line added after a sync finds its audio taken by the lines around it, so those are synced
 * again too.
 */
export function linesToFill(segments: TimedSegment[]): boolean[] {
  const lines: TimedSegment[][] = [];
  let lineStart = 0;
  segments.forEach((segment, i) => {
    if (i + 1 < segments.length && !segment.text.endsWith("\n")) return;
    lines.push(segments.slice(lineStart, i + 1));
    lineStart = i + 1;
  });
  const untimed = lines.map((line) => line.some(({ start }) => start === undefined));
  return lines.flatMap((line, i) => {
    const fill = [i - 1, i, i + 1].some((j) => untimed[j]);
    return line.map(() => fill);
  });
}

/**
 * How many of the segments a sync was asked to place it left without a start.
 */
export function unplacedCount(pending: PendingSync, result: SyncResult): number {
  return pending.request.filter(({ sync }, i) => sync && result.segments[i].start === undefined)
    .length;
}

/**
 * Syncs the request's segments to the vocals on the backend, resolving with the result.
 */
export async function syncVoice(
  vocals: Blob,
  vocalsName: string,
  request: SyncRequestSegment[],
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const formData = new FormData();
  formData.append("vocalsFile", vocals, vocalsName);
  formData.append("request", JSON.stringify({ segments: request }));

  const response = await fetch(`${API_HOSTNAME}/align_track`, {
    method: "POST",
    body: formData,
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (typeof body?.detail === "string") {
      throw new Error(body.detail);
    }
    if (response.status === 413) {
      throw new Error("The vocals track is larger than the server accepts.");
    }
    throw new Error(`Syncing failed with status ${response.status}`);
  }

  const { finishedTrackURL } = await response.json();
  const result = (await pollForJson(
    finishedTrackURL,
    SYNC_WORDING,
    onProgress,
    signal,
  )) as SyncResult;
  if (result.segments?.length !== request.length) {
    throw new Error("The server sent back a sync for a different number of syllables.");
  }
  return result;
}

/**
 * The voice's segments with a sync's result written in, or null when the voice has changed since
 * the sync was requested.
 *
 * Every synced segment takes the result's times, and the `doubtful` flag or no flag.
 * The kept segments are left as they are.
 */
export function withSyncResult(
  current: TimedSegment[],
  pending: PendingSync,
  result: SyncResult,
): TimedSegment[] | null {
  const unchanged =
    current.length === pending.segments.length &&
    current.every(
      (segment, i) =>
        segment.text === pending.segments[i].text &&
        segment.start === pending.segments[i].start &&
        segment.end === pending.segments[i].end,
    );
  if (!unchanged) return null;

  return current.map((segment, i) => {
    if (!pending.request[i].sync) return segment;
    const { start, end, doubtful } = result.segments[i];
    const { start: _start, end: _end, review: _review, ...rest } = segment;
    return {
      ...rest,
      ...(start !== undefined && { start }),
      ...(start !== undefined && end !== undefined && { end }),
      ...(start !== undefined && doubtful && { review: "doubtful" as const }),
    };
  });
}
