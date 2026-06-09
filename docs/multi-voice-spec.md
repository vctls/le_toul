# Multi-Voice Lyrics — Implementation Spec

Status: design. The readable timing-format projection (see below) is **implemented**;
everything multi-voice is **planned**.

## Goal

One karaoke project, **multiple voices** from a **single lyrics input**, where voices may
**overlap in time arbitrarily** (call-and-response, simultaneous lines, unison). Voices are
identified by **arbitrary-string tags**. Each voice is timed, controlled, and styled **fully
independently**. When there is more than one voice, a **voice selector** appears next to the
title in the Song Timing, Adjust, and Edit tabs.

Priority is correctness across *all* scenarios (including overlap), not authoring
convenience for the simple duet case.

## Mental model: a voice is an independent single-voice project

The key simplification from the agreed semantics:

- Each voice has its **own lyric subset** (the lines tagged for it), its **own timings**,
  and its **own per-tab control state**.
- Voices are never reconciled against each other. Overlap "just works" because each voice
  is timed on its own pass over the same audio.

So multi-voice = **N independent instances of the existing single-voice pipeline**, sharing
only the audio and (later) compositing into one rendered video. The existing
`compileLyricTimings` / `denormalizeTimestamps` / `createScreens` run **per voice,
unchanged**. There is no shared layout to reconcile.

## Annotation syntax (single input)

Sticky bracket tags at the start of a physical line:

```
[Anna]    When I find myself in times of trouble
          Mother Mary comes to me            ← still Anna (sticky)
[Ben]     Whisper words of wisdom
[Anna+Ben] Let it be, let it be              ← duplicated into BOTH Anna and Ben
```

Rules:

- A leading tag `[...]` sets the active voice membership for that line and **persists** to
  following lines (including across blank-line screen breaks) until the next tag.
- The tag content is an **arbitrary string**, trimmed (anything except `]` or newline).
  `+` is the **only** special character: it separates **members**.
- **`+` is a duplication shorthand, not a combined voice.** `[Anna+Ben]` puts the line into
  *both* Anna's stream and Ben's stream, exactly as if it had been written twice. There is
  no "Anna+Ben" voice; it never appears in the selector. Consequently an individual voice
  name cannot contain `+` (everything else is allowed, including spaces).
- The set of voices is the set of **atoms**: split every tag on `+`, trim, take the union,
  ordered by first appearance.
- Untagged leading content belongs to a single **default voice** (`DEFAULT_VOICE_ID`). If
  the lyrics have no tags at all, that default voice is the only voice and the selector is
  hidden — the single-voice experience is unchanged.
- The tag is **stripped in a pre-pass** before the existing `parseLyrics` runs, so all
  intra-line markup (`_`, `/`, `\n`, `\n\n`) and existing behavior are untouched.
- Voice assignment granularity is the **physical line**.

### Parser pre-pass

```ts
parseAnnotatedLyrics(text): {
  voices: VoiceId[];                       // first-appearance order
  lyricTextByVoice: Record<VoiceId, string>;  // each a normal lyric string
}
```

1. Walk physical lines, tracking the sticky current membership set (a line's leading tag,
   split on `+`).
2. Append each line's cleaned text (tag removed) to the buffer of **every** member voice,
   preserving line breaks; a `\n\n` screen break is reflected in a voice's buffer when it
   falls between two of *that voice's* lines.
3. Each `lyricTextByVoice[v]` is then an ordinary lyric string that feeds the existing
   `parseLyrics` / pipeline verbatim.

`VoiceId = string` (the tag atom — voices are self-naming, so the earlier "name-readiness"
indirection is no longer needed).

## Data model

### `lyricsStore`

Keeps the single `lyricText` as the source of truth; adds derived getters:

- `voices: VoiceId[]`
- `lyricTextForVoice(v): string`
- `segmentsForVoice(v)` (via `parseLyrics(lyricTextForVoice(v), true)`)

### `timingsStore`

```ts
// was: _timings: Array<[number, number]>
_timings: Record<VoiceId, Array<[number, number]>>
```

- Every getter/action operates on a given voice (or the active voice). The existing
  per-stream logic (`add`, `handleConflictWithPreviousSegment`, `setCurrentSegment`,
  `timingForSegmentNum`, `areTimingsUsable`, `areTimingsFinished`, `subtitles`) is correct
  *within* a voice — it just becomes voice-scoped.
- **Migration:** on load, a legacy array becomes `{ [DEFAULT_VOICE_ID]: <array> }`.

### Active voice (global)

A single app-wide `activeVoice: VoiceId` (small UI store, or on `timingsStore`). Shared
across the Song Timing, Adjust, and Edit tabs — switching it anywhere changes it
everywhere.

### Per-voice control state

Per the "keep it simple, everything per voice" decision, each of the three tabs keeps its
local control state keyed by voice (e.g. `Record<VoiceId, {...}>`) and indexes by
`activeVoice`. Switching voice swaps the whole tab context:

- **Song Timing** — `currentSegment`, playback position, playback rate.
- **Adjust** — zoom, playback rate, preroll, shift.
- **Edit** — the editable draft text.

## Voice selector

A reusable `<voice-selector>` **dropdown** bound to the global `activeVoice`, rendered
next to the `<h2 class="title">` in Song Timing, Adjust, and Edit. **Hidden when
`voices.length <= 1`.** (Layout precedent: the mobile help button already sits beside the
title in `SongTimingTab`.) Dropdown over chips because tags are arbitrary strings and can
be long / numerous.

```
┌───────────────────────────────────────────────┐
│  Song Timing                  Voice: [ Anna ▾ ] │
└───────────────────────────────────────────────┘
```

## Styling (per voice)

Each voice gets its own style: `resolve(v) = merge(base, voiceOverrides[v])`. Define one
`LyricStyle` interface, starting with a **limited subset** (additive later):

| Field | ASS property |
|---|---|
| `fontName` | `Fontname` |
| `fontSize` | `Fontsize` |
| `bold` | `Bold` |
| `italic` | `Italic` |
| `primary` | `PrimaryColour` |
| `secondary` | `SecondaryColour` |
| `outline` | `OutlineColour` |

Settings: `base: LyricStyle` (today's flat font/color migrates here) +
`voiceOverrides: Record<VoiceId, Partial<LyricStyle>>`. No unison/group cascade — there is
no group voice. A `[Anna+Ben]` line, having been duplicated, renders **once per member** in
that member's style (an accepted consequence).

## Render (last phase)

Run the existing `createScreens(lyricTextForVoice(v), _timings[v], …)` per voice; emit one
ASS `Style:` per voice (named `styleName(v)`, sanitized to a valid ASS name); concatenate
all voices' `Dialogue` events into one `[Events]` section (ASS handles overlapping events
natively). Open items for that phase:

- **Title / count-in / instrumental screens** must be computed **once**, not per voice, or
  they multiply.
- **Vertical positioning** per voice so simultaneous lines don't collide (the previous
  color + position discussion applies).

Single-voice render is unchanged until this phase.

## Readable, editable timing format (projection) — IMPLEMENTED

`frontend/lib/timingFormat.ts` (+ `timingFormat.spec.ts`) and the **Edit** tab
(`TimingEditTab.vue`, between Adjust and Submit) fuse lyrics + timings into editable text
with absolute `<MM:SS.cc>` tags. Already **voice-agnostic and pure**:

```ts
serializeTimings(lyricText: string, timings: LyricEvent[]): string
parseTimings(text: string): LyricEvent[]
```

Multi-voice wiring is therefore trivial: the Edit tab calls
`serializeTimings(lyricTextForVoice(activeVoice), _timings[activeVoice])` and applies back
to `_timings[activeVoice]`. Design guarantees that made this clean:

- Time tags use `<…>` only; `[…]` stays free for voice tags. No bracket collision.
- Time-parsing runs after voice-tag stripping (tabs operate on per-voice subsets, which are
  already tag-free).
- Timing-edit-only: lyrics stay owned by `lyricsStore`.
- Lossless to centisecond precision (the precision ASS itself uses).

## Backward compatibility

No tags → one default voice, selector hidden, legacy `_timings` array migrated, output
identical to today. This is the no-regression acceptance test.

## Phasing

1. ✅ **Annotated-lyrics parser** (`parseAnnotatedLyrics`, `frontend/lib/voices.ts`) +
   `lyricsStore` voice getters (`voices`, `lyricTextForVoice`, `segmentsForVoice`), with
   tests. No behavior change when there are no tags.
2. ✅ **`timingsStore` per voice** (`_timingsByVoice` + legacy-array migration; the
   single-array API now operates on `activeVoice`); global `activeVoice` (+ fallback);
   reusable `<voice-selector>` (`VoiceSelector.vue`, hidden for a single voice). Not yet
   placed in tabs — that's Phases 3/4.
3. ✅ **Song Timing** wired to the active voice: `<voice-selector>` by the title,
   lyric display driven by `segmentsForVoice(activeVoice)`, and per-voice control state
   (`currentSegment`, `playbackRate`, playhead) that swaps on voice change.
4. ✅ **Adjust** and **Edit** wired the same way: `<voice-selector>` by the title,
   per-voice lyric subset (`lyricTextForVoice`), active-voice timings, and per-voice
   control state (Adjust: zoom/rate/preroll/shift/track/playhead swapped on voice change;
   Edit: the draft reloads from the active voice's projection).
5. ✅ **Per-voice styling**: `VoiceStyleOverride` + `applyVoiceStyle` (`frontend/lib/voiceStyle.ts`),
   `voiceStyles` in the settings store (persisted, hex colors), the active voice's override
   applied in `timingsStore.subtitles`, bold/italic threaded through `createAssFile`, and a
   `VoiceStyleSettings` editor in Submit (shown when >1 voice). Limited subset: font
   name/size, bold, italic, primary/secondary/outline.
6. 🟡 **Multi-voice render compositing** — `createMultiVoiceAssFile` (one ASS `Style` per
   voice, all voices' events in one document; only the primary voice contributes the
   shared title/count-in/instrumental screens). `timingsStore.allVoicesSubtitles` feeds the
   Submit preview + final video; `audioDelay` derives from the primary voice. Count-ins are
   per voice; the title + instrumental-break screens are global (primary voice only);
   non-primary voices get `deferScreenStarts` so their text appears just before each line
   instead of from 0:00. `setSegmentEndTimes` clamps a segment's explicit end to the next
   segment's start (per voice), so an over-dragged release can't double-colour two lines.
   The downloadable `timings.json` is the full per-voice map (`allTimings`/`setAllTimings`;
   loader accepts the legacy array too). Overlap is blocked at three layers
   (`frontend/lib/timingValidation.ts`): the Edit tab validates and refuses to commit
   backwards timecodes, the Adjust tab clamps overlaps on commit, and the renderer clamps
   anything still present. **Remaining:** per-voice vertical positioning
   (simultaneous lines render centered and can overlap); truly union-based global
   instrumental breaks.

## Decisions made

- Single input; sticky **arbitrary-string** tags; `+` = duplication into member voices
  (no combined voice).
- Voices = tag atoms; **fully independent** per voice (timings, control state, styling).
- One pass per voice; overlap handled by independent passes.
- Global shared `activeVoice`; dropdown selector by the title in the three tabs, shown only
  when >1 voice.
- Per-voice styling via `base` + per-voice override (limited `LyricStyle` subset first); a
  duplicated `+` line renders once per member.

## Tests to add

- Parser: sticky carry; arbitrary-string tags; `+` duplication into multiple voice subsets;
  untagged → default voice; screen-break preservation within a voice's subset; tag
  stripping preserves `_`/`/`/`\n`/`\n\n`.
- `timingsStore`: per-voice scoping + legacy-array migration.
- Backward compatibility: untagged lyrics produce identical ASS output to today.
