// Turns lyrics into segments for `scripts/sync_project.py`, and its synced times back into a
// timings.json the app loads, through the app's own parsers.
// Usage: node scripts/sync-timings.mjs segments <lyrics.txt>
//        node scripts/sync-timings.mjs write <lyrics.txt> <synced.json>
//
// `segments` prints each voice's segments, untimed. `write` reads a start, an end and a doubtful
// flag per segment, and prints a version 2 timings.json in which each doubtful segment carries a
// "moved" review flag, so the app draws it as one to check.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [command, lyricsPath, syncedPath] = process.argv.slice(2);
if (
  !["segments", "write"].includes(command) ||
  !lyricsPath ||
  (command === "write") !== !!syncedPath
) {
  console.error(
    "Usage: node scripts/sync-timings.mjs segments <lyrics.txt>\n" +
      "       node scripts/sync-timings.mjs write <lyrics.txt> <synced.json>",
  );
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { "@": path.join(root, "frontend") } },
});
try {
  const { displayText } = await server.ssrLoadModule("/frontend/lib/timing.ts");
  const { fromEvents } = await server.ssrLoadModule("/frontend/lib/timedSegments.ts");
  const { parseAnnotatedLyrics } = await server.ssrLoadModule("/frontend/lib/voices.ts");
  const lyricsByVoice = parseAnnotatedLyrics(readFileSync(lyricsPath, "utf8")).lyricTextByVoice;
  const voices = Object.fromEntries(
    Object.entries(lyricsByVoice).map(([voice, lyrics]) => [voice, fromEvents(lyrics, [])]),
  );
  if (command === "segments") {
    const output = Object.fromEntries(
      Object.entries(voices).map(([voice, segments]) => [
        voice,
        segments.map((segment) => ({
          text: displayText(segment.text).replace(/\n+$/, ""),
          endsLine: segment.text.endsWith("\n"),
        })),
      ]),
    );
    console.log(JSON.stringify(output));
  } else {
    const synced = JSON.parse(readFileSync(syncedPath, "utf8"));
    for (const [voice, segments] of Object.entries(voices)) {
      const times = synced[voice] ?? [];
      if (times.length !== segments.length) {
        throw new Error(`${voice} has ${segments.length} segments but ${times.length} times`);
      }
      segments.forEach((segment, i) => {
        const { start, end, doubtful } = times[i];
        if (start !== null) segment.start = start;
        if (end !== null) segment.end = end;
        if (doubtful) segment.review = "moved";
      });
    }
    console.log(JSON.stringify({ version: 2, voices }, null, 1));
  }
} finally {
  await server.close();
}
