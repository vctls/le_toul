// Multi-voice lyric annotation parsing.
//
// A single lyrics input can carry multiple voices, identified by sticky bracket tags at
// the start of a line (`[Anna]`, `[Ben]`, `[lead vocal]`). The tag content is an arbitrary
// string; `+` is the only special character and means "duplicate this line into each
// member voice" — `[Anna+Ben]` puts the line into BOTH Anna's and Ben's streams, exactly
// as if it had been written twice. There is no combined "Anna+Ben" voice.
//
// The result is, per voice, an ordinary lyric string (with the usual `_`, `/`, `\n`, `\n\n`
// markup) that feeds the existing single-voice pipeline unchanged. See
// docs/multi-voice-spec.md.
//
// Design choice: voices are kept COMPLETELY INDEPENDENT — each has its own lyric subset,
// its own timings, its own per-tab control state, and its own style. Nothing is shared
// except the audio. The reason is overlap: voices can sing at the same time (unison,
// simultaneous-but-different lines), and a single shared timeline cannot represent two
// voices singing different things at once. Treating each voice as its own self-contained
// single-voice project sidesteps that entirely — overlap "just works" because there is no
// shared timeline to reconcile, and the whole existing single-voice pipeline
// (compile -> denormalize -> render) can be reused per voice with no changes. The cost is
// that voices are timed in separate passes rather than together; we deliberately accept
// that to be able to handle every scenario. `+` is purely an authoring convenience to
// avoid writing a shared line twice; it expands to independent copies, so even unison
// stays "independent voices that happen to coincide", not a special shared entity.

export type VoiceId = string;

// The voice that owns untagged content (and the sole voice when the lyrics have no tags).
export const DEFAULT_VOICE_ID = "Voice 1";

// A leading tag: optional indent, `[...]`, optional single trailing space. The content is
// any run of characters that isn't `]`.
const TAG_PATTERN = /^\s*\[([^\]\n]+)\]\s?/;

export interface AnnotatedLyrics {
  // Distinct voices, in order of first appearance.
  voices: VoiceId[];
  // Each voice's lyric text — a normal lyric string ready for `parseLyrics`.
  lyricTextByVoice: Record<VoiceId, string>;
}

function parseMembers(tagContent: string): VoiceId[] {
  return tagContent
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseAnnotatedLyrics(text: string): AnnotatedLyrics {
  const order: VoiceId[] = [];
  const buffers: Record<VoiceId, string> = {};
  const hasContent: Record<VoiceId, boolean> = {};
  // Whether a blank (screen-break) line has been seen since a voice's last content line.
  const blankSince: Record<VoiceId, boolean> = {};

  let currentMembers: VoiceId[] = [DEFAULT_VOICE_ID];
  let sawAnyTag = false;

  for (const rawLine of text.split("\n")) {
    const match = rawLine.match(TAG_PATTERN);
    if (match) {
      sawAnyTag = true;
      const members = parseMembers(match[1]);
      if (members.length > 0) {
        currentMembers = members;
      }
    }
    const content = match ? rawLine.slice(match[0].length) : rawLine;

    if (content.trim() === "") {
      // A blank line is a screen break; record it for every voice already in play. A
      // tag-only line (e.g. "[Anna]") just switches the voice and contributes no content.
      if (!match) {
        for (const v of order) {
          blankSince[v] = true;
        }
      }
      continue;
    }

    for (const voice of currentMembers) {
      if (!(voice in buffers)) {
        buffers[voice] = "";
        hasContent[voice] = false;
        blankSince[voice] = false;
        order.push(voice);
      }
      if (hasContent[voice]) {
        buffers[voice] += (blankSince[voice] ? "\n\n" : "\n") + content;
      } else {
        buffers[voice] = content;
        hasContent[voice] = true;
      }
      blankSince[voice] = false;
    }
  }

  // With no tags at all there is a single default voice. Return the verbatim text so the
  // single-voice pipeline is byte-for-byte unchanged.
  if (!sawAnyTag) {
    if (text === "") {
      return { voices: [], lyricTextByVoice: {} };
    }
    return {
      voices: [DEFAULT_VOICE_ID],
      lyricTextByVoice: { [DEFAULT_VOICE_ID]: text },
    };
  }

  return { voices: order, lyricTextByVoice: buffers };
}
