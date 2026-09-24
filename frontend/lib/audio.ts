import jszip from "jszip";
import { API_HOSTNAME } from "@/constants";
import { SeparationModel } from "@/types";

// Functions for working with audio files and streams
export interface TrackSeparationResult {
  backing: Blob;
  vocals: Blob;
}

interface PollResponse {
  finishedTrackURL: string;
}

// Shape of the JSON served while a separation job is still in flight.
// The backend may or may not suggest a poll interval,
// so fall back to a value suited to a job running on a remote machine.
// Progress and stage are only reported by a job running on this backend:
// a GCS-cached job is polled straight from the bucket, which serves the placeholder unchanged.
interface JobStatus {
  status?: string;
  error?: string;
  pollIntervalSeconds?: number;
  progress?: number;
  stage?: string;
  songsAhead?: number;
}

export interface SeparationProgress {
  // Fraction of the job done, or null when the job reports no figure
  progress: number | null;
  // What the job is doing now, e.g. "separating the vocals"
  stage: string | null;
  // Songs separated before this one starts, or null once it has started
  songsAhead: number | null;
}

export type SeparationProgressCallback = (progress: SeparationProgress) => void;

const DEFAULT_POLL_INTERVAL_SECONDS = 30;

// A redeploy takes the server away for a moment, and it picks the job up again when it is back.
// Polling waits that out, up to this long without an answer.
const RESTART_GRACE_SECONDS = 120;
const UNAVAILABLE_RETRY_SECONDS = 3;
const UNAVAILABLE_STATUSES = [502, 503, 504];

// Statuses a job never moves out of, so polling one is over.
const FINISHED_STATUSES = ["error", "cancelled"];

// A job running on this backend can be called off.
// A GCS-backed one is polled straight from the bucket, where nothing is listening.
const LOCAL_JOB_PREFIX = "/separated_track/";

function callOffJob(pollUrl: string): void {
  if (!pollUrl.startsWith(LOCAL_JOB_PREFIX)) {
    return;
  }
  // keepalive so the request still goes out if the page is on its way down.
  fetch(`${pollUrl}/cancel`, { method: "POST", keepalive: true }).catch((error) => {
    console.warn(`Failed to call off the separation job at ${pollUrl}`, error);
  });
}

function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, seconds * 1000);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Fetches a poll URL, or returns null when the server did not answer for itself.
 * That is a network error, or a gateway answering while the server restarts.
 */
async function fetchPoll(url: string, signal?: AbortSignal): Promise<Response | null> {
  try {
    const response = await fetch(url, { cache: "no-cache", signal });
    return UNAVAILABLE_STATUSES.includes(response.status) ? null : response;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    console.warn(`The server did not answer a poll of ${url}`, error);
    return null;
  }
}

async function pollForResult(
  url: string,
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
): Promise<Blob> {
  let unavailableSince: number | null = null;
  while (true) {
    try {
      const response = await fetchPoll(url, signal);
      if (response === null) {
        unavailableSince ??= Date.now();
        if (Date.now() - unavailableSince > RESTART_GRACE_SECONDS * 1000) {
          throw new Error("Lost contact with the server while separating the track.");
        }
        await sleep(UNAVAILABLE_RETRY_SECONDS, signal);
        continue;
      }
      unavailableSince = null;

      // Job statuses always arrive as 200. Error bodies are JSON too,
      // so without this check a 404 would read as a job still in flight and be polled forever.
      if (response.status === 404) {
        throw new Error("The separation job no longer exists. Please separate the track again.");
      }
      if (!response.ok) {
        throw new Error(`Track separation failed with status ${response.status}`);
      }

      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        const status: JobStatus = await response.json();

        // A job that failed or was called off never produces a zip,
        // so without this the poll loop would never terminate.
        if (status.status && FINISHED_STATUSES.includes(status.status)) {
          throw new Error(status.error || "Track separation failed");
        }

        onProgress?.({
          progress: status.progress ?? null,
          stage: status.stage ?? null,
          songsAhead: status.songsAhead ?? null,
        });

        const intervalSeconds = status.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
        await sleep(intervalSeconds, signal);
        continue;
      }

      return await response.blob();
    } catch (error) {
      if (signal?.aborted) {
        callOffJob(url);
        throw error;
      }
      console.error(`Failed to fetch audio separation result from URL: ${url}`, error);
      throw error;
    }
  }
}

// The container the separated stems arrive in is a backend setting, so nothing
// here names one. Stems are matched by role and typed from the name they came
// back under, and every other site that has to write one of them out asks
// extensionForBlob what to call it.
const MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

const FALLBACK_EXTENSION = "wav";

export function mimeForExtension(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}

export function extensionForBlob(blob: Blob): string {
  const type = blob.type.split(";")[0].trim().toLowerCase();
  const match = Object.entries(MIME_TYPES).find(([, mime]) => mime === type);
  return match ? match[0] : FALLBACK_EXTENSION;
}

function extensionOf(name: string): string {
  return name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "";
}

async function stemBlob(entry: jszip.JSZipObject): Promise<Blob> {
  return new Blob([await entry.async("blob")], {
    type: mimeForExtension(extensionOf(entry.name)),
  });
}

async function processZipResponse(zipBlob: Blob): Promise<TrackSeparationResult> {
  console.log("Received separated audio. Unzipping...");
  const zip = await jszip.loadAsync(zipBlob);
  const [accompanimentEntry] = zip.file(/^accompaniment\./);
  const [vocalsEntry] = zip.file(/^vocals\./);
  if (!accompanimentEntry || !vocalsEntry) {
    throw new Error("Separated track archive is missing an accompaniment or a vocals track");
  }

  return { backing: await stemBlob(accompanimentEntry), vocals: await stemBlob(vocalsEntry) };
}

/**
 * Separates a song on the backend, resolving with its stems.
 * `onSubmitted` gets the URL the job is polled at, which `resumeSeparation` can follow again later.
 */
export async function separateTrack(
  songFile: File,
  modelName: SeparationModel,
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
  onSubmitted?: (pollUrl: string) => void,
): Promise<TrackSeparationResult> {
  const formData = new FormData();
  formData.append("songFile", songFile);
  formData.append("modelName", modelName);
  const url = `${API_HOSTNAME}/separate_track`;

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      signal,
    });

    // A refusal is JSON too, and would otherwise be read as a poll URL that is not there.
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail ?? `Track separation failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type");

    // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
    if (contentType?.includes("application/json")) {
      const jsonResponse: PollResponse = await response.json();
      onSubmitted?.(jsonResponse.finishedTrackURL);
      const zipBlob = await pollForResult(jsonResponse.finishedTrackURL, onProgress, signal);
      return await processZipResponse(zipBlob);
    } else {
      const zipBlob = await response.blob();
      return await processZipResponse(zipBlob);
    }
  } catch (error) {
    if (!signal?.aborted) {
      console.error(`Failed to fetch from separateTrack URL: ${url}`, error);
    }
    throw error;
  }
}

/**
 * Follows a separation job submitted earlier, such as before the page was reloaded.
 */
export async function resumeSeparation(
  pollUrl: string,
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
): Promise<TrackSeparationResult> {
  const zipBlob = await pollForResult(pollUrl, onProgress, signal);
  return await processZipResponse(zipBlob);
}

export default { separateTrack, resumeSeparation };
