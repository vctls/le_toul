// Prints a project's timings as JSON for `scripts/align.py`, read by the app's own parsers.
// Usage: node scripts/timings-to-json.mjs <timings.txt | timings.json> [lyrics.txt]
//
// A `timings.json` of the older shapes holds only times, so it needs the lyrics.
// The parsers are loaded through Vite rather than tsx, since the modules they import read
// `import.meta.env` and the `@/` alias, which only Vite provides.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [timingsPath, lyricsPath] = process.argv.slice(2);
if (!timingsPath) {
  console.error(
    "Usage: node scripts/timings-to-json.mjs <timings.txt | timings.json> [lyrics.txt]",
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
  const text = readFileSync(timingsPath, "utf8");
  const lyrics = lyricsPath ? readFileSync(lyricsPath, "utf8") : "";
  const voices = await readVoices(text, lyrics);
  const output = Object.fromEntries(
    Object.entries(voices).map(([voice, segments]) => [
      voice,
      segments.map((segment) => ({
        text: displayText(segment.text).replace(/\n+$/, ""),
        endsLine: segment.text.endsWith("\n"),
        start: segment.start ?? null,
        end: segment.end ?? null,
      })),
    ]),
  );
  console.log(JSON.stringify(output));
} finally {
  await server.close();
}

/**
 * Read every voice's segments from any timings file the app loads.
 */
async function readVoices(text, lyrics) {
  const { isTimingsText, parseTimingsText } = await server.ssrLoadModule(
    "/frontend/lib/timingsText.ts",
  );
  if (isTimingsText(text)) {
    return parseTimingsText(text).voices;
  }
  const { fromEvents, isTimingsFile } = await server.ssrLoadModule(
    "/frontend/lib/timedSegments.ts",
  );
  const { DEFAULT_VOICE_ID, parseAnnotatedLyrics } =
    await server.ssrLoadModule("/frontend/lib/voices.ts");
  const parsed = JSON.parse(text);
  if (isTimingsFile(parsed)) {
    return parsed.voices;
  }
  const lyricsByVoice = parseAnnotatedLyrics(lyrics).lyricTextByVoice;
  const eventsByVoice = Array.isArray(parsed) ? { [DEFAULT_VOICE_ID]: parsed } : parsed;
  const lyricVoices = Object.keys(lyricsByVoice);
  const timedVoices = Object.keys(eventsByVoice);
  return Object.fromEntries(
    timedVoices.map((voice) => {
      // Older exports key the only voice as "1". The app treats that as a rename.
      const lyricsVoice =
        voice in lyricsByVoice || lyricVoices.length !== 1 || timedVoices.length !== 1
          ? voice
          : lyricVoices[0];
      return [voice, fromEvents(lyricsByVoice[lyricsVoice] ?? "", eventsByVoice[voice])];
    }),
  );
}
