// What the preview needs of its background video element.
export interface BackgroundVideo {
  currentTime: number;
  playbackRate: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  play(): Promise<void>;
  pause(): void;
}

// Every seek decodes from the keyframe before it, so a playing video is only seeked once it is
// this far from the audio. A smaller drift is made up by playing the video faster or slower.
export const MAX_DRIFT_SECONDS = 1;
export const SYNC_TOLERANCE_SECONDS = 0.03;
// The rate changes by this much per second of drift, so the drift shrinks by half in about
// a third of a second.
const CATCH_UP_GAIN = 2;
const MAX_RATE_CHANGE = 0.5;

/**
 * Keeps the background video at the point the render would show for the audio's playhead.
 * While the audio plays, the video plays along rather than being seeked to every playhead.
 */
export function syncBackgroundVideo(
  video: BackgroundVideo,
  playhead: number,
  {
    audioDelay,
    videoOffset = 0,
    isPlaying,
  }: { audioDelay: number; videoOffset?: number; isPlaying: boolean },
): void {
  const videoTime = playhead - audioDelay - videoOffset;
  // A negative offset skips the video's start, as the render trims it.
  const start = Math.max(0, -videoOffset);
  // The render loops a video shorter than the song.
  const hasLength = Number.isFinite(video.duration) && video.duration > 0;
  const target = hasLength
    ? Math.max(videoTime, start) % video.duration
    : Math.max(videoTime, start);
  // The render repeats the video's first frame during the title delay and any delay of its own.
  if (videoTime < start) {
    holdAt(video, target);
    return;
  }
  if (!isPlaying) {
    holdAt(video, target);
    return;
  }
  if (video.paused) {
    seekTo(video, target);
    video.playbackRate = 1;
    video.play().catch((error: unknown) => {
      // A pause before playback starts rejects the play() it interrupts.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Could not play the background video:", error);
      }
    });
    return;
  }
  // A seek reports its target as the current time while the audio moves on.
  if (video.seeking) {
    return;
  }
  // Positive when the video is ahead of the audio.
  let drift = video.currentTime - target;
  if (hasLength && Math.abs(drift) > video.duration / 2) {
    drift -= Math.sign(drift) * video.duration;
  }
  if (Math.abs(drift) > MAX_DRIFT_SECONDS) {
    video.currentTime = target;
  } else if (Math.abs(drift) > SYNC_TOLERANCE_SECONDS) {
    const change = Math.max(-MAX_RATE_CHANGE, Math.min(MAX_RATE_CHANGE, -drift * CATCH_UP_GAIN));
    video.playbackRate = 1 + change;
  } else {
    video.playbackRate = 1;
  }
}

function holdAt(video: BackgroundVideo, time: number): void {
  if (!video.paused) {
    video.pause();
  }
  seekTo(video, time);
}

function seekTo(video: BackgroundVideo, time: number): void {
  if (video.currentTime !== time) {
    video.currentTime = time;
  }
}
