# Timed Segments: Implementation Spec

Status: in progress. Phases 1-4 and 6 are **implemented**: the store holds `TimedSegment[]` per
voice, lyric edits reconcile instead of corrupting, holes interpolate at render time and show as
holes in Adjust, and the export carries segments. Phase 5 is largely subsumed (see _Phasing_).

## Goal

Replace the positionally-coupled timing array with one in which **lyrics and timings cannot
drift apart**, so a segment can be split or joined anywhere in the track without disturbing
the surrounding timings.

Three properties, in priority order:

1. **Manually complete.** Every capability below earns its place in the hand-timing
   workflow alone. Splitting a word into syllables after timing it, fixing a lyric typo
   without re-tapping, timing a hard line last. The app should do these because a person needs
   them, not because a machine will later.
2. **Always hand-fixable.** Any state the structure can hold must be editable in Adjust or
   Edit. There is no representation that only a machine can produce or repair.
3. **Automation is additive.** An automatic aligner fills the same structure a person fills
   by hand, through the same entry points. It is never a dependency: delete the feature and
   a fully capable manual app remains.

Automatic alignment itself is **out of scope here**. This spec only ensures the ground is
level for it, and gets better manual editing as the immediate payoff.

## Problem

### The join is positional

`lyricText` and the timing array are stored separately and associated **by ordinal
position**: the Nth `SEGMENT_START` belongs to the Nth segment out of `parseLyrics`
(`frontend/lib/timing.ts`). The lockstep walk is visible in both consumers.
`compileLyricTimings` (`frontend/lib/timing.ts`) pulls from a segment iterator as it
consumes events, and `serializeTimings` (`frontend/lib/timingFormat.ts`) increments
`segmentIndex` per start marker.

Timestamps are absolute and never move, so an edit to the lyrics doesn't _shift_ anything.
It **misattributes** everything after the edit point:

- **Insert** a `/` at segment _k_ -> every segment from _k_ on inherits its successor's
  timestamp, and the last one is left untimed. `areTimingsUsable`
  (`frontend/stores/timings.ts`) notices the count is short, but not that the
  assignments are wrong.
- **Delete** a separator -> the same skew the other way, plus a
  `"More SEGMENT_START events than lyric segments available"` console error
  (`frontend/lib/timing.ts`). `areTimingsUsable` only tests `<`, so it still reports
  usable.

Either way the render is silently wrong from the edit onward.

### Holes are unrepresentable

Because events and segments are consumed in lockstep, there is no way to express "segment 7
has no timing yet". A timing array is all-or-nothing up to wherever it stops.

That is the deeper blocker, and it's what rules out ordinary manual workflows:

- Time a chorus now, come back to a difficult verse later.
- Re-time one bad line without re-tapping everything after it.
- Split a word into syllables after timing it. The children have no times until you give them
  some, and there is nowhere to park that.

## Data model

The right structure already exists one layer down. `LyricSegment`
(`frontend/lib/timing.ts`) is `{ text, timestamp, endTimestamp? }`, the _compiled_
form. Promote it to the _stored_ form:

```ts
interface TimedSegment {
  text: string; // includes the trailing separator, as parseLyrics(..., true) yields it
  start?: number; // undefined = untimed
  end?: number; // undefined = runs up against the next segment
}
```

Three fields, no provenance. "This start was interpolated rather than entered" is already
derivable from `start === undefined`, so a stored flag would carry nothing the structure
doesn't. Anything an aligner needs beyond this is added when an aligner exists.

`timingsStore` stores `TimedSegment[]` per voice in place of `Timings`.

The join problem does not get solved so much as **deleted**: the text lives inside the
record, so there is no ordinal correspondence left to break. Splitting a segment splices one
element into two and touches nothing else, because nothing downstream refers to position.

`end` keeps its old meaning exactly: `undefined` means open-ended, and the segment runs into
the next one.

Knock-on simplifications:

- `compileLyricTimings` stops iterating two sequences. It groups segments into lines and
  screens by their trailing `\n` / `\n\n` and nothing else. The count-mismatch error path at
  `timing.ts` becomes unreachable by construction.
- `timingForSegmentNum` (`stores/timings.ts`) and `setCurrentSegment`
  (`stores/timings.ts`), both index-walks over markers, collapse to array indexing.
- `areTimingsUsable` stops comparing two lengths that can disagree.

### Why not store the fused text instead

`serializeTimings` / `parseTimings` already produce `<00:01.00>al/<00:01.30>che/my`, where
adjacency _is_ the join, round-tripped under test. Storing that directly would also remove
the coupling, and it is diffable and pasteable.

Rejected as the **stored** form because it makes `lyricText` machine-managed: `parseLyrics`,
`parseAnnotatedLyrics`, `getCurrentWord` and `slashifyAllOccurences` would all have to strip
tags, and the Lyrics tab textarea would fill with timecodes while you are still writing
words. Two editing modes get conflated into one surface.

It stays the **interchange and hand-editing** format, which is where it is good. The two
representations are isomorphic, so nothing is lost: `serializeTimings` / `parseTimings`
become the serializer pair for `TimedSegment[]`, and both get simpler, since the lockstep
walk disappears from each.

## Reconciliation on lyric edits

`lyricText` remains the authoring surface. (The alternative, where segments own the text and
`lyricText` is derived, founders on `parseAnnotatedLyrics` splitting one blob into per-voice
blobs. You would have to reassemble a tagged blob from per-voice arrays.)

So each voice's `TimedSegment[]` is reconciled against `segmentsForVoice(voice)` whenever
the lyrics change:

```ts
reconcile(stored: TimedSegment[], current: Segment[]): TimedSegment[];
```

**No diff algorithm.** Because each segment carries its own text, divergence is detectable by
comparison, and the edits that actually occur are recognizable by string equality. Four
ordered rules, first match wins:

1. **Same segment count** -> relabel in place, every timing kept. This is the typo fix, and
   it is the common case.
2. Otherwise, **trim the common prefix and suffix** to find the changed window. Everything
   outside it keeps its timings by construction. Matched on the word without its trailing
   separator: the last segment of a lyric has none, so appending to the end rewrites it
   (`three` becomes `three_`) without changing the word, and an exact comparison would break the
   anchor and cost that segment its timing. A matched segment therefore takes its text from the
   lyrics and its timing from the store.
3. Inside the window, if the two spell out the same words **as drawn** (`displayText`, so the
   `/` and `_` being added or removed don't count) -> a pure **split or join**. Apply the
   boundary rule: the first new segment takes the window's start, the last takes the window's
   end, the middles are untimed.
4. Otherwise, the window is untimed. Outside it, nothing moves.

Rule 4 degrades to holes, which the structure already supports and the user fixes by hand.
That is the stated goal rather than a fallback: good enough unattended, always repairable.

The function is pure, store-free and exhaustively testable, the same shape as
`timingFormat.ts`. It is installed by a
watcher on the lyrics, following the precedent of `setupVoiceReconciliation`
(`frontend/stores/timings.ts`).

A real LCS is deliberately avoided: it handles rule 1 worse (a one-character typo reads as
delete+insert, losing a timing that should obviously survive), and every branch above can be
explained to the user in the UI. If one is ever needed, `fast-array-diff` takes a custom
comparator, so don't hand-roll Myers.

Invariant, enforced on read: for every voice,
`timedSegments(voice)` and `segmentsForVoice(voice)` have equal length and equal texts.

### What reconciliation runs against

`reconcile` is lossy by design, since rule 4 exists. That makes it unsafe to feed its own
output. The store therefore keeps a second copy of each voice's segments, `_baselineByVoice`,
holding the last state that a lyric edit did not produce, and every keystroke reconciles from
there rather than from the previous keystroke's result.

The baseline advances only when something other than a lyric edit writes segments: tapping in
the Timing tab, dragging in Adjust, importing a file, or a reset. Those actions end with
`commitBaseline`. `reconcileSegments` never advances it.

Without this, a word typed one letter at a time passes through intermediates that match
nothing, and rule 4 destroys timings that the finished edit would have kept. Lyrics
`one_three`, both words timed, with the cursor after `one_` and the user typing `two_`:

```
chained from its own output:  "one_" @1   "two_" [untimed]   "three" [untimed]
reconciled from the baseline: "one_" @1   "two_" [untimed]   "three" @3
```

Inserting a word mid-line is an ordinary edit, and it used to cost the following word its
timing.

Two alternatives were considered and rejected. An **Apply button** in the Lyrics tab, mirroring
the one in Edit, would set the commit point manually, but Edit needs its button because its
draft is free text that can fail to parse, and the lyrics textarea has no invalid state.
`lyricText` also drives voices, the Timing tab and magic slashes, all live, so gating it would
either be a much larger change or leave the lyrics current while the timings lag. **Debouncing**
only narrows the window, since a pause mid-word still snapshots an intermediate, and it makes
the failure depend on timing. The baseline gives the Apply button's semantics with no button to
forget and nothing to leave stale.

### Explicit split and join

Originally planned as `splitSegment` / `joinSegments` store actions, so the common case would
not depend on inference. Rules 1-3 turned out to cover it: typing a `/` in the Lyrics tab is
already a split, and deleting one is already a join. Adding the actions would have given the
same edit two ways to happen, so they were dropped.

What they were for is still the point of the spec: subdividing a word you have already timed,
or undoing a subdivision that was too fine, without losing the work around it.

## Resolving holes

A hole must never block a render, or "time the chorus first" stops being a workflow.

`setSegmentEndTimes` already infers a missing `end` from the next segment's start.
`resolveStarts` is the mirror case, called by `createScreens`: a run of holes is spread between
the timed segments on either side, weighted by how much text each one draws.

The lower anchor is the previous segment's `end` where it has one, not its `start`. Anchoring on
the start places the hole inside a segment that is still sounding, and the region layer rejects
that as an overlap and drops the rectangle. The anchor is capped at the next start, so an end
already dragged past it cannot push the holes backwards through the track.

Only a hole timed on both sides is filled. An untimed head or tail is work not yet done rather
than a gap to guess at, and filling it would spread an untapped second half of a song across the
rest of the track.

Consequences:

- A partially-timed project always previews. You can watch what you have so far.
- `areTimingsUsable` means "every segment resolves a start, directly or by interpolation", so
  splitting a word you had already timed does not reopen the whole song.
- Resolved values are never written back. They live in the render path, so a hole stays visibly
  a hole in Adjust and Edit instead of quietly becoming a real timing.

## What automatic alignment would later plug into

Recorded to show the structure is sufficient, not as a commitment:

- An aligner returns `TimedSegment[]` for one voice, using the fused text as its wire format
  (no separate import path).
- **Re-align one line** is a slice replacement, possible only because nothing is
  positionally coupled.
- Trust markers (a per-segment confidence, so low-confidence spans can be flagged for
  review) get added to `TimedSegment` **at that point**, by whoever builds the aligner.

If none of that is ever built, everything above still stands on its own.

## Prior art

Checked before committing to any of this, so the next reader knows it was not invented here.

**The data model is the universal one.** Every karaoke format stores text inside the timing
record rather than beside it:

| format                    | unit                                              |
| ------------------------- | ------------------------------------------------- |
| UltraStar `.txt`          | `: startBeat length pitch Text`, one per syllable |
| Enhanced LRC (A2)         | `<mm:ss.xx>word` inline                           |
| ASS `\k`                  | `{\k15}Ne{\k14}ver`                               |
| TTML (Apple word-by-word) | `<span begin= end=>word</span>`                   |

None of them keeps a clean lyric blob beside a parallel positional time array. Today's
design is the outlier, so this change removes an idiosyncrasy rather than adding structure.
Two details land very close to ours: UltraStar encodes word boundaries as a trailing blank
inside the `Text` field (structurally our trailing `_` / `/`), and enhanced LRC is
start-only with the last word of a line carrying no explicit end (our `end?`).

**Split/join semantics match Aegisub.** Its join discards the text of all but the first and
spans first-start to last-end. Its split gives the first piece the original start and starts
each following piece at the previous one's end. Identical to the rules above, arrived at
independently, so there was no reason to invent our own.

**Holes are a named concept.** ELAN's _symbolic subdivision_ tier type is an annotation
subdivided into children that are explicitly **not linked to the time axis**. That is exactly
"split a word into syllables that aren't timed yet", in a two-decade-old standard.

**Not adopted:** `lyric-kit` and similar npm parsers model LRC/TTML shapes, which are
flatter than ours (no `_` vs `/` vs `\n` vs `\n\n` distinction, no screens, no voices), so
they would cost more to adapt than to skip. Worth noting for later, though: once segments
carry their own text, A2 `.lrc` export is nearly free, because `timingFormat.ts` is already A2 with
different brackets.

## Backward compatibility

`Array<[seconds, marker]>` survives as the shape older files and older builds speak:

```ts
fromEvents(lyricText: string, events: LyricEvent[]): TimedSegment[]  // the migration
toEvents(segments: TimedSegment[]): LyricEvent[]                     // lossy across holes
```

`fromEvents` is the join `compileLyricTimings` already performs. It runs once on
localStorage load, following the legacy-array migration precedent in `loadTimingsByVoice`
(`frontend/stores/timings.ts`).

`toEvents` cannot express holes, so it is for export and for the transitional `rawTimings`
getter only, never a round-trip through storage.

### The exported `timings.json`

The downloadable `timings.json` carries segments: `{ version: 2, voices: { <voice>: TimedSegment[] } }`.

It had to. The event form it used to carry cannot express a hole, so saving a partly-timed
project through it collapsed them, and reloading then misattributed every segment after the
first one: the original bug, reached through the front door. That never bit anyone only because
a fully timed project round-trips exactly, and until holes existed every project was fully timed.

`applyTimingsFile` reads all three shapes: a bare array, a per-voice map of event arrays, and the
versioned form. Reading stays permanent, and only writing moved. An older build cannot read a v2 file,
which is the deliberate cost of not losing holes.

No-regression acceptance test: a fully-timed single-voice project produces byte-identical
ASS output before and after.

## Phasing

1. ✅ `TimedSegment` type and the `fromEvents` / `toEvents` adapters
   (`frontend/lib/timedSegments.ts` + spec). `fromEvents` **pads rather than drops** when the
   events outrun the lyrics. Timings are entered before lyrics exist, and losing one is worse
   than carrying a textless segment for reconciliation to fill in.
2. ✅ Store state is `_segmentsByVoice: Record<VoiceId, TimedSegment[]>`, persisted under
   `timings._segments`. The pre-existing `timings._timings` is migrated on load and left in
   place, so a bad migration can't destroy anyone's timings. `rawTimings` is a computed
   `toEvents(...)`, so `TimingAdjuster`, `SongTimingTab`, `subtitles()` and
   `allVoicesSubtitles()` are untouched. `add` now writes by segment index instead of
   appending, which is what makes a hole representable. `voicesWithTimings` and
   `reconcileVoices` ask whether anything is _timed_ rather than whether the array is
   populated, since a voice can now hold untimed segments.
3. ✅ `compileLyricTimings(segments)` groups on the trailing separator alone. Lockstep
   iteration and the count-mismatch error path are gone. `createScreens`, `createAssFile` and
   `VoiceTrack` take segments, so `subtitles()`, `allVoicesSubtitles()` and `SubmitTab`'s
   `audioDelay` all feed segments straight through. Two things this turned up:
   - Stored text keeps its markup, but the renderer needs the drawn form, so
     `displayText()` (`frontend/lib/timing.ts`) applies what `parseLyrics(..., false)` used to:
     trailing `_` -> space, trailing `/` -> nothing. Without it the separators leak into the
     ASS output.
   - A textless segment (a timing with no lyric to hang it on) draws nothing, which keeps
     "a timings file loaded before any lyrics" rendering as a bare header.

   `serializeTimings(segments)` / `parseTimings(text) -> TimedSegment[]` re-point at the new
   type, and `parseTimings` now assigns each tag to **the segment it sits in** rather than
   routing through the ordinal join. Tags contain no separator character, so the ordinary
   split runs over the tagged text and adjacency survives, which is the entire reason this
   format exists. An untagged syllable in the middle now stays a hole instead of letting the
   next syllable inherit its timing. `TimingEditTab` commits via `resetSegments`.

   Not yet closed: a **lyric** edit made in the Edit tab updates the segments but not
   `lyricsStore.lyricText`. Phase 4's watcher is what reconciles the two.

4. ✅ `reconcile` (the four rules, `frontend/lib/timedSegments.ts`) +
   `setupSegmentReconciliation`, a watcher on `lyricText` registered after
   `setupVoiceReconciliation` so a tag rename settles first. **Editing lyrics after timing is no
   longer destructive**: adding a `/` keeps every other timing, removing one restores the whole
   word's start, and a typo costs nothing.
   - Rule 3 compares the window **as drawn** (via `displayText`), not as stored. A split inserts
     the very `/` being compared, so the raw texts never match and every split would have fallen
     through to rule 4. What has to be equal is the words, not the division markers.
   - A voice the lyrics no longer mention is left parked rather than reconciled against nothing,
     so retyping its tag still brings the timings back (`reconcileVoices`' contract).
   - The Edit tab now writes changed words back to `lyricsStore`, closing the phase-3 gap. It
     refuses the edit for a multi-voice song, where putting text back through the `[tag]` lines
     isn't implemented. That belongs with phase 5.
5. 🟡 Split and join. **Largely subsumed by phase 4**: typing a `/` in the Lyrics tab already
   _is_ a split, reconciled correctly, so `LyricEditor` needed no new operation and no
   `splitSegment` / `joinSegments` actions were added. `TimingAdjuster` is wired (see phase 6).
   **Remaining:** splitting from the Adjust view by dropping a divider on a region, for people
   who would rather work on the waveform than in the lyrics. The other is writing a word edit
   back through the `[tag]` lines of a multi-voice blob, which the Edit tab still refuses.
6. ✅ Interpolation and holes made visible.
   - `resolveStarts` (`frontend/lib/timing.ts`) spreads a run of holes between the timed
     segments on either side, weighted by the text each draws, and `createScreens` applies it.
     A word split after timing renders `one alchemy three` again instead of `one althree`.
   - Only holes bounded on **both** sides are filled. An untimed head or tail is work not yet
     done, not a gap to guess at. Filling those would spread an untapped second half of a song
     across the rest of the track.
   - Render-path only: nothing is written back, so a hole stays a hole in Adjust and Edit.
   - `areTimingsUsable` now asks whether every segment _resolves_ a start. Otherwise, splitting a
     word you had already timed put the song back to "unfinished" and closed Submit, despite
     rendering perfectly.
   - Adjust draws one region per segment, ids matching segment indices. A hole gets a region at
     its interpolated position in `--region-fill-hole`, and dragging it is how you pin it down.
     `clampSegmentOverlaps` replaces the event-based clamp, and `adjustSegmentTiming` is deleted.
   - The export carries segments: `{ version: 2, voices: { <voice>: TimedSegment[] } }`.
     `applyTimingsFile` reads all three shapes, so every older project still loads.

1-3 are mechanical and independently shippable. 4 carries the design risk. 5-6 are additive.

Undo/redo gets substantially cheaper after 2: every operation
becomes a discrete array transform to snapshot, rather than a splice into a positionally
coupled event stream.

## Decisions made

- Timings are stored **with** their text (`TimedSegment[]`), not joined to it by position.
- The fused `<MM:SS.cc>` text stays the interchange and hand-editing format, not the stored
  form.
- `lyricText` remains the authoring surface. Segments reconcile to it by prefix and suffix
  trimming and string equality, **not** by a diff algorithm.
- Reconciliation reads a committed baseline, never its own previous output, so editing stays
  live without an Apply button and without a debounce.
- Prefix and suffix match on the word without its trailing separator, so appending to the end
  of the lyrics does not cost the old last segment its timing.
- Untimed is a first-class state, resolved at render time and never written back.
- A hole is anchored to the previous segment's release, so it cannot land inside a segment that
  is still sounding.
- `timings.json` carries segments, not events, so a partly-timed project survives a save.
- No provenance fields until an aligner needs them.
- Per-voice storage, independent voices, and every other multi-voice decision in
  `docs/multi-voice-spec.md` are unchanged: this replaces what a voice stores, not how
  voices relate.

## Test coverage

- `reconcile`, one test per rule. A typo with an unchanged segment count keeps every timing.
  Split 1->N and join N->1 preserve the outer bounds. An insertion or deletion at the head
  leaves the tail's timings intact. An unrelated rewrite un-times only the changed window.
- `reconcile` at the end of the lyrics: appending a word or a line keeps the old last segment,
  and deleting the tail keeps the new one.
- The baseline. Typing a word one letter at a time keeps the timings on either side of it, and
  a drag in Adjust between two lyric edits survives the second edit.
- `fromEvents` and `toEvents` round-trip a fully-timed project. `toEvents` across a hole is
  documented as lossy.
- Migration: a stored legacy array loads as `TimedSegment[]` matching the old render, and the
  legacy key is left in place.
- Holes. A project with untimed segments in the middle renders. A hole after a release starts
  at the release rather than inside the segment before it. Nothing is persisted back.
- Existing projects: both older `timings.json` shapes still load, and a partly-timed project
  survives the v2 round trip.
- Backward compatibility: identical ASS output for a fully-timed single-voice project.
- End to end (`tests/e2e/adjust-persistence.spec.ts`): the playhead and the waveform scroll
  position both come back after a reload.
