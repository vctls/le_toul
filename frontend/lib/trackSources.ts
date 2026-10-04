import type { TrackKind, TrackSource } from "@/types";

// How many uploaded files of each kind the dropdowns list, in case a folder holds a lot of them.
export const MAX_UPLOADED_TRACKS = 3;

/**
 * The source of one uploaded file, as the uploaded group of the dropdowns lists it.
 */
export function fileSource(kind: TrackKind, name: string): TrackSource {
  return `file:${kind}/${name}`;
}

/**
 * The kind and file name of an uploaded file's source, or null for a model's.
 */
export function parseFileSource(source: TrackSource): { kind: TrackKind; name: string } | null {
  const match = /^file:(backing|vocals)\/(.+)$/.exec(source);
  return match ? { kind: match[1] as TrackKind, name: match[2] } : null;
}
