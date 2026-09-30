// The lyrics a timings.txt file carries, since each of its syllables holds its own text.

import { joinLyrics, parseLyrics } from "./timing";
import { TimedSegment } from "./timedSegments";
import { DEFAULT_VOICE_ID, VoiceId, parseAnnotatedLyrics } from "./voices";

/**
 * The lyric text the voices' segments were cut from. Each voice is tagged on a line of its own,
 * unless the default voice is the only one.
 */
export function lyricsOf(voices: Record<VoiceId, TimedSegment[]>): string {
  const entries = Object.entries(voices);
  if (entries.length === 1 && entries[0][0] === DEFAULT_VOICE_ID) {
    return joinLyrics(entries[0][1]);
  }
  return entries.map(([voice, segments]) => `[${voice}]\n${joinLyrics(segments)}`).join("\n\n");
}

/**
 * Whether the lyrics cut into the same segments as the voices, whatever their formatting.
 */
export function lyricsMatch(lyricText: string, voices: Record<VoiceId, TimedSegment[]>): boolean {
  const { voices: lyricVoices, lyricTextByVoice } = parseAnnotatedLyrics(lyricText);
  const timedVoices = Object.keys(voices);
  if (lyricVoices.length !== timedVoices.length) return false;
  return timedVoices.every((voice) => {
    const cut = parseLyrics(lyricTextByVoice[voice] ?? "", true);
    const segments = voices[voice];
    return (
      cut.length === segments.length &&
      cut.every(
        (segment, i) =>
          segment.text === segments[i].text &&
          (segment.spacersBefore ?? 0) === (segments[i].spacersBefore ?? 0) &&
          (segment.spacersAfter ?? 0) === (segments[i].spacersAfter ?? 0),
      )
    );
  });
}
