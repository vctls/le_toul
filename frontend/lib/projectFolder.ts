// Loading a project back from an extracted folder of the files the Submit tab exports.
//
// The folder is whatever the user points at, so classification is lenient: the names the exporter writes win,
// an unfamiliar name falls back to its extension, and anything left over is listed rather than refused.
// Lyrics and timings are matched by name only, since both can be `.txt`, and so can any notes beside them.
// A folder holding only some of the files loads those.

export interface ProjectFolder {
  song?: File;
  backing?: File;
  vocals?: File;
  lyrics?: File;
  timings?: File;
  settings?: File;
  font?: File;
  // Paths of the files that matched nothing, or a slot already taken.
  ignored: string[];
}

type Slot = Exclude<keyof ProjectFolder, "ignored">;

const SONG_STEM = "song";

// The stems the exporter writes, whose container is a backend setting rather
// than a fixed extension.
const NAMED_STEMS: Record<string, Slot> = {
  [SONG_STEM]: "song",
  accompaniment: "backing",
  vocals: "vocals",
};

const NAMED_SLOTS: Record<string, Slot> = {
  "lyrics.txt": "lyrics",
  "timings.txt": "timings",
  "timings.json": "timings",
  "settings.yaml": "settings",
  "settings.yml": "settings",
};

// The legacy name, which gives way to the current one whichever sorts first.
const SUPERSEDED_BY: Record<string, string> = { "timings.json": "timings.txt" };

// Rebuilt from the lyrics and timings, so there is nothing to load back.
const DERIVED_NAMES = ["subtitles.ass"];

// What an unrecognized name falls back to. Video extensions are deliberately absent:
// the rendered karaoke video sits in the same folder, and the source song is matched by name.
const EXTENSION_SLOTS: Record<string, Slot> = {
  yaml: "settings",
  yml: "settings",
  ttf: "font",
  otf: "font",
  ttc: "font",
  mp3: "song",
  wav: "song",
  m4a: "song",
  aac: "song",
  flac: "song",
  ogg: "song",
  opus: "song",
  aiff: "song",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

// The name the exporter gives the source song,
// which is what tells it apart from the rendered karaoke video sitting beside it.
export function projectSongEntryName(sourceName: string): string {
  const extension = extensionOf(sourceName);
  return extension ? `${SONG_STEM}.${extension}` : SONG_STEM;
}

export function classifyProjectFolder(files: File[]): ProjectFolder {
  const project: ProjectFolder = { ignored: [] };
  // A directory picker hands its files over in whatever order it walked them.
  // Sort to make "the first candidate wins" mean the same thing twice running.
  const ordered = [...files].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));

  for (const file of ordered) {
    const name = file.name.toLowerCase();
    if (name.startsWith(".") || DERIVED_NAMES.includes(name)) {
      continue;
    }
    // A .kbp loads through its own input only. Without this, song.kbp would take the song slot,
    // since the stems are matched by name whatever their extension.
    if (extensionOf(name) === "kbp") {
      project.ignored.push(pathOf(file));
      continue;
    }
    const slot =
      NAMED_SLOTS[name] ?? NAMED_STEMS[stemOf(name)] ?? EXTENSION_SLOTS[extensionOf(name)];
    const taken = slot ? project[slot] : undefined;
    if (slot && taken && SUPERSEDED_BY[taken.name.toLowerCase()] === name) {
      project.ignored.push(pathOf(taken));
      project[slot] = file;
      continue;
    }
    if (!slot || taken) {
      project.ignored.push(pathOf(file));
      continue;
    }
    project[slot] = file;
  }
  return project;
}
