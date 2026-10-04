import { describe, expect, test } from "vitest";
import { tracksOffLength } from "./trackLength";

const DURATIONS: Record<string, number | null> = {
  "same.mp3": 180.02,
  "short.mp3": 178,
  "long.mp3": 181,
  "unreadable.mp3": null,
};

const readDuration = async (blob: Blob) => DURATIONS[(blob as File).name];

describe("tracksOffLength", () => {
  test("names the tracks more than half a second off the song's length", async () => {
    const tracks = Object.keys(DURATIONS).map((name) => new File(["x"], name));

    expect(await tracksOffLength(tracks, 180, readDuration)).toEqual(["short.mp3", "long.mp3"]);
  });

  test("leaves out a track whose length can't be read", async () => {
    const tracks = [new File(["x"], "unreadable.mp3")];

    expect(await tracksOffLength(tracks, 180, readDuration)).toEqual([]);
  });
});
