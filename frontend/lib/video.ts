import type { LogEvent } from "@ffmpeg/ffmpeg";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { KaraokeOptions } from "@/lib/timing";
import jszip from "jszip";

// Functions related to video file creation

interface VideoMetadata {
  duration?: number;
  artist?: string;
  title?: string;
}

// The additional audio tracks an MKV render carries alongside the backing track.
export interface AlternateAudioTracks {
  vocals?: Blob | null;
  original?: Blob | null;
}

interface EncodedTrack {
  fileName: string;
  title: string;
}

const RENDERED_VIDEO_FILE = "karaoke.mp4";
const MKV_FILE = "karaoke.mkv";
const BACKING_TRACK_TITLE = "Backing track";

const ALTERNATE_TRACKS = [
  { key: "vocals", title: "Vocals" },
  { key: "original", title: "Original mix" },
] as const satisfies readonly { key: keyof AlternateAudioTracks; title: string }[];

class ApiError extends Error {
  public path: string;
  public status?: number;

  constructor(path: string, message: string, status?: number) {
    super(message);
    this.path = path;
    this.name = "ApiError";
    this.status = status;
  }

  toString() {
    return `${this.name}: ${this.message} (status: ${this.status ?? "N/A"}, path: ${this.path})`;
  }
}

function getFfmpegParams(
  hasVideo: boolean,
  backgroundColor: string,
  audioDelayMs: number,
  metadata: VideoMetadata,
) {
  let videoInputArgs, filterArgs;
  if (hasVideo) {
    videoInputArgs = ["-i", "video.mp4"];
    // When there's a background video we use filter_complex to combine the video and audio
    filterArgs = [
      "-filter_complex",
      [
        // Prepend audioDelay secs of the video's first frame
        `[0:v]tpad=start_duration=${audioDelayMs / 1000}:start_mode=clone[padded]`,
        // Add subtitles over that
        "[padded]ass=subtitles.ass:fontsdir=/tmp[vout]",
        // Add audioDelay to audio
        `[1:a]adelay=delays=${audioDelayMs}:all=1[aout]`,
      ].join(";"),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
    ];
  } else {
    videoInputArgs = ["-f", "lavfi", "-i", `color=c=${backgroundColor}:s=1280x720:r=20`];
    // When there's no video, things are simpler
    filterArgs = [
      // Add audioDelay to audio
      "-af",
      `adelay=delays=${audioDelayMs}:all=1`,
      "-vf",
      `ass=subtitles.ass:fontsdir=/tmp`,
    ];
  }
  const videoMetadata = ffmpegMetadataArgs(metadata);

  return [
    ...videoInputArgs,
    "-i",
    "audio.mp4",
    ...filterArgs,
    "-shortest",
    "-y",
    "-threads",
    "3",
    ...videoMetadata,
    RENDERED_VIDEO_FILE,
  ];
}

// One alternate per run: two audio encoders in one ffmpeg run deadlock the WASM core above
// one thread.
export function getAlternateTrackParams(
  inputFile: string,
  audioDelayMs: number,
  outputFile: string,
) {
  return [
    "-i",
    inputFile,
    // Cover art would otherwise come in as a video stream the m4a muxer rejects.
    "-map",
    "0:a:0",
    "-af",
    `adelay=delays=${audioDelayMs}:all=1`,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-threads",
    "1",
    "-y",
    outputFile,
  ];
}

// Copy only: nothing here re-encodes.
export function getMkvMuxParams(alternates: EncodedTrack[], metadata: VideoMetadata) {
  const titles = [BACKING_TRACK_TITLE, ...alternates.map(({ title }) => title)];
  return [
    "-i",
    RENDERED_VIDEO_FILE,
    ...alternates.flatMap(({ fileName }) => ["-i", fileName]),
    "-map",
    "0:v",
    "-map",
    "0:a",
    ...alternates.flatMap((_track, index) => ["-map", `${index + 1}:a`]),
    "-c",
    "copy",
    // Setting any disposition turns off ffmpeg's automatic ones, video included.
    "-disposition:v:0",
    "default",
    ...titles.flatMap((title, index) => [
      `-metadata:s:a:${index}`,
      `title=${title}`,
      `-disposition:a:${index}`,
      index === 0 ? "default" : "0",
    ]),
    ...ffmpegMetadataArgs(metadata),
    "-y",
    MKV_FILE,
  ];
}

// ffmpeg picks a demuxer partly by extension, so a named source keeps its own.
function withSourceExtension(baseName: string, source: Blob): string {
  const sourceName = source instanceof File ? source.name : "";
  const extension = sourceName.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  return extension ? `${baseName}.${extension}` : baseName;
}

// A failed run otherwise surfaces as an FS error when its missing output is read back.
async function runFfmpeg(
  ffmpeg: FFmpeg,
  args: string[],
  step: RenderStep,
  progress: RenderProgress | null,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  progress?.begin(step);
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`FFmpeg failed while ${step.phrase} (exit code ${code})`);
  }
  progress?.end();
}

export type ProgressCallback = (progress: number, step: string) => void;

export interface RenderStep {
  // Names the step in the progress bar, and in the error if the step fails.
  phrase: string;
  // Relative to the other steps in the plan, not a fraction of the bar.
  weight: number;
}

// From the encode speeds the WASM core reports.
const STEP_WEIGHTS = {
  render: 0.85,
  alternateTrack: 0.06,
  mux: 0.03,
};

const ASSUMED_SONG_SECONDS = 300;

// Each run reports the media time it has reached, so its own progress is that against the
// length of what it produces.
export class RenderProgress {
  private readonly totalWeight: number;
  private readonly mediaSeconds: number;
  private readonly onProgress: ProgressCallback;
  private finishedShare = 0;
  private currentShare = 0;
  private phrase = "";

  constructor(plan: RenderStep[], mediaSeconds: number, onProgress: ProgressCallback) {
    this.totalWeight = plan.reduce((total, { weight }) => total + weight, 0) || 1;
    this.mediaSeconds = mediaSeconds > 0 ? mediaSeconds : ASSUMED_SONG_SECONDS;
    this.onProgress = onProgress;
  }

  begin(step: RenderStep) {
    this.currentShare = step.weight / this.totalWeight;
    this.phrase = step.phrase;
    this.report(0);
  }

  handleLog = ({ message }: LogEvent) => {
    if (typeof message !== "string") return;
    const timestamp = message.match(/time=\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
    if (!timestamp) return;
    const [, hours, minutes, seconds] = timestamp;
    const reached = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    this.report(Math.min(reached / this.mediaSeconds, 1));
  };

  end() {
    this.finishedShare += this.currentShare;
    this.currentShare = 0;
    this.report(0);
  }

  private report(stepProgress: number) {
    const total = this.finishedShare + this.currentShare * stepProgress;
    this.onProgress(Math.min(total, 1), this.phrase);
  }
}

interface AlternateSource {
  source: Blob;
  baseName: string;
  title: string;
}

function usableAlternates(tracks: AlternateAudioTracks | null): AlternateSource[] {
  const usable: AlternateSource[] = [];
  for (const { key, title } of ALTERNATE_TRACKS) {
    const source = tracks?.[key];
    if (!source || source.size === 0) {
      console.warn(`No ${title.toLowerCase()} track available, leaving it out of the MKV`);
      continue;
    }
    usable.push({ source, baseName: key, title });
  }
  return usable;
}

export interface CreateVideoOptions {
  accompaniment: string | Blob;
  subtitles: string;
  videoOptions: KaraokeOptions;
  metadata: VideoMetadata;
  fontMap: Record<string, string>;
  backgroundVideo?: Blob | null;
  audioDelay?: number;
  alternateTracks?: AlternateAudioTracks | null;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

async function createVideo({
  accompaniment,
  subtitles,
  videoOptions,
  metadata,
  fontMap,
  backgroundVideo = null,
  audioDelay = 0,
  alternateTracks = null,
  onProgress,
  signal,
}: CreateVideoOptions): Promise<Uint8Array> {
  // Create the video using ffmpeg.wasm v0.12
  const songFileName = "audio.mp4";
  const isMkv = videoOptions.outputFormat === "mkv";
  const backgroundColor = "0x" + videoOptions.color.background.toString().substring(1);
  const audioDelayMs = audioDelay * 1000;

  // Create FFmpeg instance and load multithread core

  // Most assets can be pulled from any origin, so let's use a CDN
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.9/dist/esm";
  // The root worker needs to be served from the same origin as the page to enable SharedArrayBuffer
  const workerBaseUrl = window.location.origin + "/static/ffmpeg";
  const ffmpeg = new FFmpeg();

  // Download most ffmpeg files to local blobs
  const [coreURL, wasmURL, workerURL] = await Promise.all([
    toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript").catch((error) => {
      console.error(`Failed to fetch FFmpeg core from: ${baseURL}/ffmpeg-core.js`, error);
      throw error;
    }),
    toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm").catch((error) => {
      console.error(`Failed to fetch FFmpeg WASM from: ${baseURL}/ffmpeg-core.wasm`, error);
      throw error;
    }),
    toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript").catch((error) => {
      console.error(`Failed to fetch FFmpeg worker from: ${baseURL}/ffmpeg-core.worker.js`, error);
      throw error;
    }),
  ]);
  await ffmpeg.load({ coreURL, wasmURL, workerURL, classWorkerURL: `${workerBaseUrl}/worker.js` });

  ffmpeg.on("log", ({ message }) => console.log("ffmpeg output", message));

  // The core does not come back to JS mid-run,
  // so killing its worker is the only way to stop an encode that is already going.
  const terminate = () => ffmpeg.terminate();
  signal?.addEventListener("abort", terminate, { once: true });
  try {
    // Planned before anything runs, so the bar can weigh the whole job rather than restart
    // at each run.
    const alternates = isMkv ? usableAlternates(alternateTracks) : [];
    const renderStep: RenderStep = { phrase: "rendering the video", weight: STEP_WEIGHTS.render };
    const trackSteps: RenderStep[] = alternates.map(({ title }) => ({
      phrase: `encoding the ${title.toLowerCase()} track`,
      weight: STEP_WEIGHTS.alternateTrack,
    }));
    const muxStep: RenderStep = { phrase: "writing the MKV", weight: STEP_WEIGHTS.mux };
    const plan = isMkv ? [renderStep, ...trackSteps, muxStep] : [renderStep];
    const progress = onProgress
      ? new RenderProgress(plan, (metadata.duration ?? 0) + audioDelay, onProgress)
      : null;
    if (progress) {
      ffmpeg.on("log", progress.handleLog);
    }

    // Write audio to ffmpeg filesystem
    await ffmpeg.writeFile(songFileName, await fetchFile(accompaniment));

    // The ass filter indexes fontsdir by the family name inside each file,
    // so the filename only has to be path-safe, which a family name is not necessarily.
    const fontSource = fontMap[videoOptions.font.name];
    if (fontSource) {
      await ffmpeg.writeFile(
        `/tmp/${videoOptions.font.name.replace(/[^\w.-]+/g, "_")}.ttf`,
        await fetchFile(fontSource),
      );
    } else {
      console.warn(`No font file available for "${videoOptions.font.name}", falling back`);
    }

    await ffmpeg.writeFile("subtitles.ass", subtitles);

    if (backgroundVideo) {
      await ffmpeg.writeFile("video.mp4", await fetchFile(backgroundVideo));
    }

    const ffmpegParams = getFfmpegParams(
      Boolean(backgroundVideo),
      backgroundColor,
      audioDelayMs,
      metadata,
    );
    await runFfmpeg(ffmpeg, ffmpegParams, renderStep, progress, signal);

    if (!isMkv) {
      return (await ffmpeg.readFile(RENDERED_VIDEO_FILE)) as Uint8Array;
    }

    const encoded: EncodedTrack[] = [];
    for (const [index, { source, baseName, title }] of alternates.entries()) {
      const inputFile = withSourceExtension(baseName, source);
      const fileName = `${baseName}.m4a`;
      await ffmpeg.writeFile(inputFile, await fetchFile(source));
      await runFfmpeg(
        ffmpeg,
        getAlternateTrackParams(inputFile, audioDelayMs, fileName),
        trackSteps[index],
        progress,
        signal,
      );
      encoded.push({ fileName, title });
    }
    await runFfmpeg(ffmpeg, getMkvMuxParams(encoded, metadata), muxStep, progress, signal);

    return (await ffmpeg.readFile(MKV_FILE)) as Uint8Array;
  } catch (error) {
    // A terminated run surfaces as an ffmpeg failure, which is not what the caller asked for.
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", terminate);
    // Each run loads a core of its own, so without this every one leaks a worker holding 30-odd MB of wasm.
    ffmpeg.terminate();
  }
}

interface DownloadPollResponse {
  finishedDownloadURL: string;
}

async function isYouTubeError(response: Response, blob: Blob): Promise<string | null> {
  // Check if this is an error JSON response instead of a ZIP
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json") || blob.type === "application/json") {
    const text = await blob.text();
    try {
      const errorData = JSON.parse(text);
      if (!errorData.success && errorData.error) {
        return errorData.error;
      }
    } catch (parseError) {
      // If it's not valid JSON, continue as normal blob
    }
  }
  return null;
}

async function pollForVideoResult(url: string): Promise<Blob> {
  const POLL_INTERVAL = 10000; // 10 seconds
  while (true) {
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-cache",
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("pollForVideoResult fetch failed:", {
        url,
        error: err.message,
        errorType: err.constructor.name,
        stack: err.stack,
      });
      throw error;
    }

    // For video downloads, a 404 means it's still processing
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }

    if (response.status !== 200) {
      const errMsg = await response.text();
      throw new ApiError(url, errMsg, response.status);
    }

    const blob = await response.blob();

    // Check if this is an error response
    const errorMessage = await isYouTubeError(response, blob);
    if (errorMessage) {
      throw new ApiError(url, errorMessage);
    }

    return blob;
  }
}

export async function fetchYouTubeVideo(url: string): Promise<[Blob, Blob, Object]> {
  const apiPath = "/download_video?url=" + url;

  try {
    const response = await fetch(apiPath);
    if (response.status !== 200) {
      const errMsg = await response.text();
      throw new ApiError(apiPath, errMsg, response.status);
    }

    const contentType = response.headers.get("content-type");

    let zipContents: Blob;

    // The endpoint can return either a JSON response with a URL to poll for results or a direct ZIP file response
    if (contentType?.includes("application/json")) {
      const jsonResponse: DownloadPollResponse = await response.json();
      zipContents = await pollForVideoResult(jsonResponse.finishedDownloadURL);
    } else {
      zipContents = await response.blob();
    }

    const zip = await jszip.loadAsync(zipContents);
    const audioEntry = zip.file("audio.mp4");
    const videoEntry = zip.file("video.mp4");
    const metadataEntry = zip.file("metadata.json");
    if (!audioEntry || !videoEntry || !metadataEntry) {
      throw new Error("YouTube download archive is missing audio.mp4, video.mp4 or metadata.json");
    }

    const [audio, video, metadata] = await Promise.all([
      audioEntry.async("blob"),
      videoEntry.async("blob"),
      metadataEntry.async("string").then((md) => JSON.parse(md)),
    ]);

    // TODO return blob URLs instead
    return [audio, video, metadata];
  } catch (error) {
    console.error(`Failed to fetch YouTube video from URL: ${apiPath}`, error);
    throw error;
  }
}

// Parse a YouTube video title into song artist and title
export function parseYouTubeTitle(videoMetadata: any): [string, string] {
  if (videoMetadata.author && videoMetadata.title) {
    return [videoMetadata.author, videoMetadata.title];
  }
  return ["", videoMetadata.title];
}

function ffmpegMetadataArgs(metadata: VideoMetadata): string[] {
  let ffmpegArgs = [];
  if (metadata.artist) {
    ffmpegArgs.push("-metadata", `artist=${metadata.artist}`);
  }
  if (metadata.title) {
    ffmpegArgs.push("-metadata", `title=${metadata.title}`);
  }
  ffmpegArgs.push("-metadata", `description=Karaoke version created by the-tuul.com`);
  return ffmpegArgs;
}

export default { createVideo, fetchYouTubeVideo, parseYouTubeTitle };
