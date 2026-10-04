// MP3 durations read from metadata can be off by a few hundredths of a second,
// while a track cut or padded at the start is usually off by far more.
export const LENGTH_TOLERANCE_SECONDS = 0.5;

const METADATA_TIMEOUT_MS = 5000;

/**
 * The track's duration as the browser reads it from the file's metadata, or null if it can't.
 */
export function audioDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(blob);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = (duration: number | null) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    timeout = setTimeout(() => done(null), METADATA_TIMEOUT_MS);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

/**
 * The names of the tracks whose length differs from the song's. A track whose length can't be read
 * is left out.
 */
export async function tracksOffLength(
  tracks: File[],
  songDuration: number,
  readDuration: (blob: Blob) => Promise<number | null> = audioDuration,
): Promise<string[]> {
  const durations = await Promise.all(tracks.map((track) => readDuration(track)));
  return tracks
    .filter((_track, index) => {
      const duration = durations[index];
      return duration !== null && Math.abs(duration - songDuration) > LENGTH_TOLERANCE_SECONDS;
    })
    .map((track) => track.name);
}
