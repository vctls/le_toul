import { describe, expect, test } from "vitest";
import { classifyProjectFolder, projectSongEntryName } from "./projectFolder";

function file(relativePath: string): File {
  const name = relativePath.split("/").pop() as string;
  const created = new File(["x"], name);
  Object.defineProperty(created, "webkitRelativePath", { value: relativePath });
  return created;
}

// A folder holding everything the Submit tab writes, for a song that came from YouTube.
const EXPORTED_FOLDER = [
  "Queen - Bohemian Rhapsody [karaoke].mp4",
  "subtitles.ass",
  "lyrics.txt",
  "timings.json",
  "settings.yaml",
  "MetalMania.ttf",
  "song.mp4",
  "vocals.wav",
  "accompaniment.wav",
].map((name) => file(`project/${name}`));

describe("classifyProjectFolder", () => {
  test("picks up every file an export writes", () => {
    const project = classifyProjectFolder(EXPORTED_FOLDER);

    expect(project.song?.name).toBe("song.mp4");
    expect(project.backing?.name).toBe("accompaniment.wav");
    expect(project.vocals?.name).toBe("vocals.wav");
    expect(project.lyrics?.name).toBe("lyrics.txt");
    expect(project.timings?.name).toBe("timings.json");
    expect(project.settings?.name).toBe("settings.yaml");
    expect(project.font?.name).toBe("MetalMania.ttf");
  });

  test("ignores the rendered video, and the subtitles it can rebuild", () => {
    const project = classifyProjectFolder(EXPORTED_FOLDER);

    expect(project.ignored).toEqual(["project/Queen - Bohemian Rhapsody [karaoke].mp4"]);
  });

  test("loads a partial folder, leaving the rest empty", () => {
    const project = classifyProjectFolder([file("lyrics.txt"), file("timings.json")]);

    expect(project.lyrics?.name).toBe("lyrics.txt");
    expect(project.timings?.name).toBe("timings.json");
    expect(project.song).toBeUndefined();
    expect(project.settings).toBeUndefined();
    expect(project.ignored).toEqual([]);
  });

  test("falls back to the extension for names it does not know", () => {
    const project = classifyProjectFolder([
      file("Bohemian Rhapsody.mp3"),
      file("my lyrics.TXT"),
      file("settings.yml"),
      file("Impact.otf"),
    ]);

    expect(project.song?.name).toBe("Bohemian Rhapsody.mp3");
    expect(project.lyrics?.name).toBe("my lyrics.TXT");
    expect(project.settings?.name).toBe("settings.yml");
    expect(project.font?.name).toBe("Impact.otf");
  });

  test("keeps the first candidate for a slot and reports the rest", () => {
    const project = classifyProjectFolder([file("b.mp3"), file("a.mp3")]);

    expect(project.song?.name).toBe("a.mp3");
    expect(project.ignored).toEqual(["b.mp3"]);
  });

  test("skips the files an extraction leaves behind", () => {
    const project = classifyProjectFolder([file(".DS_Store"), file("__MACOSX/._lyrics.txt")]);

    expect(project.lyrics).toBeUndefined();
    expect(project.ignored).toEqual([]);
  });

  test("places the stems whatever container they were separated into", () => {
    const project = classifyProjectFolder([file("accompaniment.flac"), file("vocals.flac")]);

    expect(project.backing?.name).toBe("accompaniment.flac");
    expect(project.vocals?.name).toBe("vocals.flac");
    expect(project.song).toBeUndefined();
  });

  test("reports what it could not place", () => {
    const project = classifyProjectFolder([file("project/notes.docx")]);

    expect(project.ignored).toEqual(["project/notes.docx"]);
  });
});

describe("projectSongEntryName", () => {
  test("keeps the extension, so the reader can tell audio from video", () => {
    expect(projectSongEntryName("Bohemian Rhapsody.mp3")).toBe("song.mp3");
    expect(projectSongEntryName("audio.mp4")).toBe("song.mp4");
    expect(projectSongEntryName("audio")).toBe("song");
  });
});
