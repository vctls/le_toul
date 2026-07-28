// Reading back the `settings.yaml` file the app exports (see SubmitTab.settingsYaml).
//
// The file is meant to be hand-editable as well as round-tripped, so parsing is
// deliberately lenient: an entry that is unknown or of the wrong type is skipped and
// reported as a warning rather than failing the whole load. Only a file that isn't a
// YAML mapping at all is rejected outright, since there is nothing to apply.

import yaml from "js-yaml";
import Color from "buefy/src/utils/color";
import { VerticalAlignment } from "@/lib/timing";
import { VoiceStyleOverride, VOICE_STYLE_COLOR_FIELDS } from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";
import { SeparationModel } from "@/types";
import {
  BACKING_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
} from "@/stores/media";
import type { VideoSettings } from "@/stores/settings";

export interface SettingsFileSong {
  title?: string;
  artist?: string;
  duration?: number;
  youtubeUrl?: string;
}

export interface ParsedSettingsFile {
  song: SettingsFileSong;
  separationModel?: SeparationModel;
  videoOptions: Partial<VideoSettings>;
  // Absent when the file says nothing about voice styles, so a caller can tell
  // "no opinion" (leave the current overrides alone) from "explicitly empty".
  voiceStyles?: Record<VoiceId, VoiceStyleOverride>;
  warnings: string[];
}

const SEPARATION_MODELS: readonly string[] = [
  BACKING_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
];

const BOOLEAN_OPTIONS = [
  "addTitleScreen",
  "addCountIns",
  "addInstrumentalScreens",
  "addStaggeredLines",
  "useBackgroundVideo",
] as const;

// The exporter writes the enum's numeric value, but a hand-written file is much clearer
// with a name, so accept either.
const ALIGNMENT_NAMES: Record<string, VerticalAlignment> = {
  top: VerticalAlignment.Top,
  middle: VerticalAlignment.Middle,
  bottom: VerticalAlignment.Bottom,
};

const KNOWN_VIDEO_OPTIONS = [
  ...BOOLEAN_OPTIONS,
  "verticalAlignment",
  "font",
  "color",
  "vocalSeparationModel",
];

const COLOR_FIELDS = ["background", "primary", "secondary"] as const;

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string, warnings: string[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${path}: expected text, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readNumber(value: unknown, path: string, warnings: string[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    warnings.push(`${path}: expected a number, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readBoolean(value: unknown, path: string, warnings: string[]): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    warnings.push(`${path}: expected true or false, ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  return value;
}

function readColor(value: unknown, path: string, warnings: string[]): Color | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${path}: expected a color like "#ff00ff", ignoring ${JSON.stringify(value)}`);
    return undefined;
  }
  try {
    return Color.parse(value);
  } catch (e) {
    warnings.push(`${path}: ${JSON.stringify(value)} is not a valid color, ignoring it`);
    return undefined;
  }
}

function readAlignment(
  value: unknown,
  path: string,
  warnings: string[]
): VerticalAlignment | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const named = ALIGNMENT_NAMES[value.trim().toLowerCase()];
    if (named === undefined) {
      warnings.push(`${path}: expected top, middle or bottom, ignoring ${JSON.stringify(value)}`);
      return undefined;
    }
    return named;
  }
  if (value === VerticalAlignment.Top || value === VerticalAlignment.Middle || value === VerticalAlignment.Bottom) {
    return value as VerticalAlignment;
  }
  warnings.push(`${path}: expected top, middle or bottom, ignoring ${JSON.stringify(value)}`);
  return undefined;
}

function readSeparationModel(
  value: unknown,
  path: string,
  warnings: string[]
): SeparationModel | undefined {
  const name = readString(value, path, warnings);
  if (name === undefined) return undefined;
  if (!SEPARATION_MODELS.includes(name)) {
    warnings.push(`${path}: unknown separation model ${JSON.stringify(name)}, ignoring it`);
    return undefined;
  }
  return name as SeparationModel;
}

function warnUnknownKeys(source: Record<string, unknown>, known: readonly string[], path: string, warnings: string[]) {
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) {
      warnings.push(`${path ? `${path}.${key}` : key}: unknown setting, ignoring it`);
    }
  }
}

function parseSong(raw: unknown, warnings: string[]): SettingsFileSong {
  const song: SettingsFileSong = {};
  if (raw === undefined || raw === null) return song;
  if (!isMapping(raw)) {
    warnings.push("song: expected a mapping, ignoring it");
    return song;
  }
  warnUnknownKeys(raw, ["title", "artist", "duration", "youtubeUrl"], "song", warnings);

  const title = readString(raw.title, "song.title", warnings);
  const artist = readString(raw.artist, "song.artist", warnings);
  const duration = readNumber(raw.duration, "song.duration", warnings);
  const youtubeUrl = readString(raw.youtubeUrl, "song.youtubeUrl", warnings);

  if (title !== undefined) song.title = title;
  if (artist !== undefined) song.artist = artist;
  if (duration !== undefined) song.duration = duration;
  if (youtubeUrl !== undefined) song.youtubeUrl = youtubeUrl;
  return song;
}

function parseVideoOptions(raw: unknown, warnings: string[]): Partial<VideoSettings> {
  const options: Partial<VideoSettings> = {};
  if (raw === undefined || raw === null) return options;
  if (!isMapping(raw)) {
    warnings.push("videoOptions: expected a mapping, ignoring it");
    return options;
  }
  warnUnknownKeys(raw, KNOWN_VIDEO_OPTIONS, "videoOptions", warnings);

  for (const key of BOOLEAN_OPTIONS) {
    const value = readBoolean(raw[key], `videoOptions.${key}`, warnings);
    if (value !== undefined) options[key] = value;
  }

  const alignment = readAlignment(raw.verticalAlignment, "videoOptions.verticalAlignment", warnings);
  if (alignment !== undefined) options.verticalAlignment = alignment;

  // The exporter writes the separation model at the top level, but accept the store's
  // own field name too, since that is what a settings dump from localStorage looks like.
  const model = readSeparationModel(
    raw.vocalSeparationModel,
    "videoOptions.vocalSeparationModel",
    warnings
  );
  if (model !== undefined) options.vocalSeparationModel = model;

  if (raw.font !== undefined && raw.font !== null) {
    if (isMapping(raw.font)) {
      warnUnknownKeys(raw.font, ["name", "size"], "videoOptions.font", warnings);
      const name = readString(raw.font.name, "videoOptions.font.name", warnings);
      const size = readNumber(raw.font.size, "videoOptions.font.size", warnings);
      const font: Partial<VideoSettings["font"]> = {};
      if (name !== undefined) font.name = name;
      if (size !== undefined) font.size = size;
      if (Object.keys(font).length > 0) options.font = font as VideoSettings["font"];
    } else {
      warnings.push("videoOptions.font: expected a mapping, ignoring it");
    }
  }

  if (raw.color !== undefined && raw.color !== null) {
    if (isMapping(raw.color)) {
      warnUnknownKeys(raw.color, COLOR_FIELDS, "videoOptions.color", warnings);
      const color: Partial<VideoSettings["color"]> = {};
      for (const field of COLOR_FIELDS) {
        const parsed = readColor(raw.color[field], `videoOptions.color.${field}`, warnings);
        if (parsed !== undefined) color[field] = parsed;
      }
      if (Object.keys(color).length > 0) options.color = color as VideoSettings["color"];
    } else {
      warnings.push("videoOptions.color: expected a mapping, ignoring it");
    }
  }

  return options;
}

function parseVoiceStyle(raw: Record<string, unknown>, path: string, warnings: string[]): VoiceStyleOverride {
  const style: VoiceStyleOverride = {};
  warnUnknownKeys(raw, ["fontName", "fontSize", "bold", "italic", ...VOICE_STYLE_COLOR_FIELDS], path, warnings);

  const fontName = readString(raw.fontName, `${path}.fontName`, warnings);
  const fontSize = readNumber(raw.fontSize, `${path}.fontSize`, warnings);
  const bold = readBoolean(raw.bold, `${path}.bold`, warnings);
  const italic = readBoolean(raw.italic, `${path}.italic`, warnings);

  if (fontName !== undefined) style.fontName = fontName;
  if (fontSize !== undefined) style.fontSize = fontSize;
  if (bold !== undefined) style.bold = bold;
  if (italic !== undefined) style.italic = italic;

  for (const field of VOICE_STYLE_COLOR_FIELDS) {
    const parsed = readColor(raw[field], `${path}.${field}`, warnings);
    if (parsed !== undefined) style[field] = parsed;
  }

  return style;
}

function parseVoiceStyles(
  raw: unknown,
  warnings: string[]
): Record<VoiceId, VoiceStyleOverride> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isMapping(raw)) {
    warnings.push("voiceStyles: expected a mapping of voice names to styles, ignoring it");
    return undefined;
  }
  const styles: Record<VoiceId, VoiceStyleOverride> = {};
  for (const [voice, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (!isMapping(value)) {
      warnings.push(`voiceStyles.${voice}: expected a mapping, ignoring it`);
      continue;
    }
    styles[voice] = parseVoiceStyle(value, `voiceStyles.${voice}`, warnings);
  }
  return styles;
}

// Parse the contents of a settings.yaml file. Throws only when the file cannot be
// understood as a settings mapping at all; everything else surfaces in `warnings`.
export function parseSettingsYaml(text: string): ParsedSettingsFile {
  let document: unknown;
  try {
    document = yaml.load(text);
  } catch (e) {
    throw new Error(`Could not parse the settings file: ${(e as Error).message}`);
  }
  if (document === undefined || document === null || document === "") {
    throw new Error("The settings file is empty.");
  }
  if (!isMapping(document)) {
    throw new Error("The settings file must be a YAML mapping of settings.");
  }

  const warnings: string[] = [];
  warnUnknownKeys(document, ["song", "separationModel", "videoOptions", "voiceStyles"], "", warnings);

  const videoOptions = parseVideoOptions(document.videoOptions, warnings);
  const parsed: ParsedSettingsFile = {
    song: parseSong(document.song, warnings),
    videoOptions,
    warnings,
  };

  const model =
    readSeparationModel(document.separationModel, "separationModel", warnings) ??
    videoOptions.vocalSeparationModel;
  if (model !== undefined) parsed.separationModel = model;

  const voiceStyles = parseVoiceStyles(document.voiceStyles, warnings);
  if (voiceStyles !== undefined) parsed.voiceStyles = voiceStyles;

  return parsed;
}
