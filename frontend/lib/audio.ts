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
}

export interface SeparationProgress {
  // Fraction of the job done, or null when the job reports no figure
  progress: number | null;
  // What the job is doing now, e.g. "separating the vocals"
  stage: string | null;
}

export type SeparationProgressCallback = (progress: SeparationProgress) => void;

const DEFAULT_POLL_INTERVAL_SECONDS = 30;

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

async function pollForResult(
  url: string,
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
): Promise<Blob> {
  while (true) {
    try {
      const response = await fetch(url, {
        cache: "no-cache",
        signal,
      });
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
        });

        const intervalSeconds = status.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
        await sleep(intervalSeconds, signal);
        continue;
      }

      // Anything that is neither JSON nor a successful response is not a zip.
      // Reporting the status beats handing an error page to jszip.
      if (!response.ok) {
        throw new Error(`Track separation failed with status ${response.status}`);
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

async function processZipResponse(zipBlob: Blob): Promise<TrackSeparationResult> {
  console.log("Received separated audio. Unzipping...");
  const zip = await jszip.loadAsync(zipBlob);
  const accompanimentEntry = zip.file("accompaniment.wav");
  const vocalsEntry = zip.file("vocals.wav");
  if (!accompanimentEntry || !vocalsEntry) {
    throw new Error("Separated track archive is missing accompaniment.wav or vocals.wav");
  }

  const accompaniment = new Blob([await accompanimentEntry.async("blob")], { type: "audio/wav" });
  const vocals = new Blob([await vocalsEntry.async("blob")], { type: "audio/wav" });

  return { backing: accompaniment, vocals: vocals };
}

export async function separateTrack(
  songFile: File,
  modelName: SeparationModel,
  onProgress?: SeparationProgressCallback,
  signal?: AbortSignal,
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

    const contentType = response.headers.get("content-type");

    // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
    if (contentType?.includes("application/json")) {
      const jsonResponse: PollResponse = await response.json();
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

export default { separateTrack };
