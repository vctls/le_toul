import jszip from "jszip";
import { API_HOSTNAME } from "@/constants";
import { SeparationModel } from "@/types";

// Functions for working with audio files and streams
export interface TrackSeparationResult {
    backing: Blob; // Blob of backing track
    vocals: Blob; // Blob of vocals track
}

interface PollResponse {
    finishedTrackURL: string;
}

// Shape of the JSON served while a separation job is still in flight. The
// backend may or may not suggest a poll interval, so fall back to a value
// suited to a job running on a remote machine.
interface JobStatus {
    status?: string;
    error?: string;
    pollIntervalSeconds?: number;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 30;

async function pollForResult(url: string): Promise<Blob> {
    while (true) {
        try {
            const response = await fetch(url, {
                cache: 'no-cache'
            });
            const contentType = response.headers.get("content-type");

            if (contentType?.includes("application/json")) {
                const status: JobStatus = await response.json();

                // A failed job never produces a zip, so without this the poll
                // loop would never terminate.
                if (status.status === "error") {
                    throw new Error(status.error || "Track separation failed");
                }

                const intervalSeconds = status.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
                continue;
            }

            // Anything that is neither JSON nor a successful response is not a
            // zip. Reporting the status beats handing an error page to jszip.
            if (!response.ok) {
                throw new Error(`Track separation failed with status ${response.status}`);
            }

            return await response.blob();
        } catch (error) {
            console.error(`Failed to fetch audio separation result from URL: ${url}`, error);
            throw error;
        }
    }
}

async function processZipResponse(zipBlob: Blob): Promise<TrackSeparationResult> {
    console.log("Received separated audio. Unzipping...");
    const zip = await jszip.loadAsync(zipBlob);
    const accompaniment = await zip.file("accompaniment.wav").async("blob").then((blob) => {
        return new Blob([blob], { type: "audio/wav" });
    });

    const vocals = await zip.file("vocals.wav").async("blob").then((blob) => {
        return new Blob([blob], { type: "audio/wav" });
    });

    return { backing: accompaniment, vocals: vocals };
}

export async function separateTrack(songFile: File, modelName: SeparationModel): Promise<TrackSeparationResult> {
    const formData = new FormData();
    formData.append("songFile", songFile);
    formData.append("modelName", modelName);
    const url = `${API_HOSTNAME}/separate_track`;
    
    try {
        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        const contentType = response.headers.get("content-type");

        // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
        if (contentType?.includes("application/json")) {
            const jsonResponse: PollResponse = await response.json();
            const zipBlob = await pollForResult(jsonResponse.finishedTrackURL);
            return await processZipResponse(zipBlob);
        } else {
            const zipBlob = await response.blob();
            return await processZipResponse(zipBlob);
        }
    } catch (error) {
        console.error(`Failed to fetch from separateTrack URL: ${url}`, error);
        throw error;
    }
}

export default { separateTrack }