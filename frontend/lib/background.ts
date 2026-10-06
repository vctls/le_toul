// What the background picker takes. SVG is left out, since the WASM FFmpeg may not decode it.
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export const BACKGROUND_EXTENSIONS = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)].map(
  (extension) => `.${extension}`,
);

export type BackgroundKind = "image" | "video";

function extensionOf(name: string): string {
  return name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1].toLowerCase() ?? "";
}

/**
 * Whether a background is a still or a video. One that is neither an image by type nor by name is a
 * video, as every background was before images, a YouTube download's among them.
 */
export function backgroundKind(background: Blob): BackgroundKind {
  if (background.type.startsWith("image/")) return "image";
  const name = background instanceof File ? background.name : "";
  return extensionOf(name) in IMAGE_TYPES ? "image" : "video";
}

/**
 * Whether the name ends in an extension the picker takes.
 */
export function hasBackgroundExtension(name: string): boolean {
  const extension = extensionOf(name);
  return extension in IMAGE_TYPES || extension in VIDEO_TYPES;
}

/**
 * Whether the picker would take this file, by type or by name.
 */
export function isBackgroundFile(file: File): boolean {
  const types = [...Object.values(IMAGE_TYPES), ...Object.values(VIDEO_TYPES)];
  return hasBackgroundExtension(file.name) || types.includes(file.type);
}

/**
 * The background's extension, from its name, or from its type when it has no name.
 */
export function backgroundExtension(background: Blob): string {
  const name = background instanceof File ? background.name : "";
  const fromName = extensionOf(name);
  if (fromName) return fromName;
  const types = { ...IMAGE_TYPES, ...VIDEO_TYPES };
  const fromType = Object.keys(types).find((extension) => types[extension] === background.type);
  return fromType ?? (backgroundKind(background) === "image" ? "png" : "mp4");
}
