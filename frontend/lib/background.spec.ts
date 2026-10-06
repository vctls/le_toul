import { describe, expect, test } from "vitest";
import { backgroundKind, isBackgroundFile } from "./background";

describe("backgroundKind", () => {
  test.each([
    [new File(["x"], "sunset.png", { type: "image/png" }), "image"],
    [new File(["x"], "sunset.WEBP"), "image"],
    [new Blob(["x"], { type: "image/jpeg" }), "image"],
    [new File(["x"], "clip.mkv", { type: "video/x-matroska" }), "video"],
    [new File(["x"], "video.mp4"), "video"],
    // What older versions saved from a YouTube download.
    [new Blob(["x"]), "video"],
  ])("tells %o is a %s", (background, kind) => {
    expect(backgroundKind(background)).toBe(kind);
  });
});

describe("isBackgroundFile", () => {
  test.each([
    ["clip.mov", "", true],
    ["still.jpg", "", true],
    ["unnamed", "video/webm", true],
    ["vector.svg", "image/svg+xml", false],
    ["song.mp3", "audio/mpeg", false],
  ])("takes %s of type %j: %s", (name, type, expected) => {
    expect(isBackgroundFile(new File(["x"], name, { type }))).toBe(expected);
  });
});
