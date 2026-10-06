import { describe, it, expect, vi } from "vitest";
import {
  BackgroundVideo,
  MAX_DRIFT_SECONDS,
  SYNC_TOLERANCE_SECONDS,
  syncBackgroundVideo,
} from "./backgroundVideo";

class FakeVideo implements BackgroundVideo {
  paused = true;
  seeking = false;
  playbackRate = 1;
  duration: number;
  seeks: number[] = [];
  private position = 0;

  constructor(duration = 60) {
    this.duration = duration;
  }

  get currentTime() {
    return this.position;
  }

  set currentTime(time: number) {
    this.position = time;
    this.seeks.push(time);
  }

  // Playback moves the position without seeking.
  advance(seconds: number) {
    this.position += seconds;
  }

  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });
}

const PLAYING = { audioDelay: 0, isPlaying: true };
const PAUSED = { audioDelay: 0, isPlaying: false };

describe("syncBackgroundVideo", () => {
  it("starts the video at the playhead when the audio plays", () => {
    const video = new FakeVideo();

    syncBackgroundVideo(video, 12, PLAYING);

    expect(video.seeks).toEqual([12]);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("lets a playing video run without seeking it to each playhead", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);

    for (let frame = 1; frame <= 60; frame++) {
      video.advance(1 / 60);
      syncBackgroundVideo(video, 12 + frame / 60, PLAYING);
    }

    expect(video.seeks).toEqual([12]);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.playbackRate).toBe(1);
  });

  it("closes a small drift by playing the video faster or slower", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);

    syncBackgroundVideo(video, 12.2, PLAYING);
    expect(video.playbackRate).toBeGreaterThan(1);

    syncBackgroundVideo(video, 11.8, PLAYING);
    expect(video.playbackRate).toBeLessThan(1);

    syncBackgroundVideo(video, 12 + SYNC_TOLERANCE_SECONDS / 2, PLAYING);
    expect(video.playbackRate).toBe(1);
    expect(video.seeks).toEqual([12]);
  });

  it("closes a drift by playing faster until the video has caught up", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);
    let audioTime = 12.3;

    for (let step = 0; step < 30; step++) {
      syncBackgroundVideo(video, audioTime, PLAYING);
      video.advance((1 / 15) * video.playbackRate);
      audioTime += 1 / 15;
    }

    expect(Math.abs(video.currentTime - audioTime)).toBeLessThan(SYNC_TOLERANCE_SECONDS);
    expect(video.seeks).toEqual([12]);
  });

  it("seeks a playing video that has drifted far from the audio", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);

    syncBackgroundVideo(video, 12 + MAX_DRIFT_SECONDS + 0.1, PLAYING);

    expect(video.seeks).toEqual([12, 12 + MAX_DRIFT_SECONDS + 0.1]);
  });

  it("leaves a video alone while it seeks", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);
    video.seeking = true;

    syncBackgroundVideo(video, 12 + MAX_DRIFT_SECONDS + 0.1, PLAYING);

    expect(video.seeks).toEqual([12]);
    expect(video.playbackRate).toBe(1);
  });

  it("starts at the audio's speed after a catch-up was cut short", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);
    syncBackgroundVideo(video, 12.2, PLAYING);
    syncBackgroundVideo(video, 12.2, PAUSED);

    syncBackgroundVideo(video, 12.2, PLAYING);

    expect(video.playbackRate).toBe(1);
  });

  it("pauses the video and seeks it once to the playhead when the audio stops", () => {
    const video = new FakeVideo();
    syncBackgroundVideo(video, 12, PLAYING);
    video.advance(0.1);

    syncBackgroundVideo(video, 12.13, PAUSED);
    syncBackgroundVideo(video, 12.13, PAUSED);

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.seeks).toEqual([12, 12.13]);
  });

  it("holds the first frame during the title delay, then plays from the start", () => {
    const video = new FakeVideo();
    video.currentTime = 30;
    video.seeks = [];
    const options = { audioDelay: 5, isPlaying: true };

    syncBackgroundVideo(video, 2, options);
    syncBackgroundVideo(video, 4, options);

    expect(video.seeks).toEqual([0]);
    expect(video.play).not.toHaveBeenCalled();

    syncBackgroundVideo(video, 5.02, options);

    expect(video.seeks).toEqual([0, 5.02 - 5]);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("loops a video shorter than the song", () => {
    const video = new FakeVideo(10);

    syncBackgroundVideo(video, 23, PAUSED);

    expect(video.seeks).toEqual([3]);
  });

  it("measures the drift across the end of a looping video", () => {
    const video = new FakeVideo(10);
    syncBackgroundVideo(video, 9.95, PLAYING);
    video.advance(0.03);

    // The audio has wrapped to 0.05 while the video is still at 9.98, 0.07 behind.
    syncBackgroundVideo(video, 10.05, PLAYING);

    expect(video.seeks).toEqual([9.95]);
    expect(video.playbackRate).toBeGreaterThan(1);
  });

  it("uses the playhead as it is until the video knows its length", () => {
    const video = new FakeVideo(NaN);

    syncBackgroundVideo(video, 23, PAUSED);

    expect(video.seeks).toEqual([23]);
  });
});
