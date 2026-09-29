"""Syncing lyrics to a vocals track, done the same way whatever the aligner.

The aligner only places segments in the audio it is handed. This module decides which
audio that is, checks what comes back, and takes the ends from the vocals track.
"""

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from api.karaoke.aligners import Aligner, AlignerSegment
from api.karaoke.separation_progress import ProgressCallback

# A syllable is released where the vocals fall this far below their loud level.
# Lower thresholds wait for the reverb the separation leaves in, and end too late.
RELEASE_BELOW_DB = -12.0
# The vocals must stay that quiet this long. A stop consonant is silent for about 0.1 s,
# and a shorter minimum ends words like "tiques" on their "t".
RELEASE_MIN_QUIET_SECONDS = 0.3
# An end closer than this to the next start is left open, as a person tapping would.
OPEN_END_GAP_SECONDS = 0.3
# The rest of a line after an anchor is looked for this soon after it,
# so a voice whose next line is far off isn't placed on another singer's lines.
# No hand-timed line of 863 ran longer than this allows.
LINE_WINDOW_SECONDS_PER_SYLLABLE = 1.0
LINE_WINDOW_MARGIN_SECONDS = 2.0
# A soft anchor's segment is looked for this close to it, on either side.
SOFT_ANCHOR_MARGIN_SECONDS = 1.0

_LOUDNESS_HOP_SECONDS = 0.01
# The loud level is taken high in the range, since most of a vocals track is silence.
_LOUD_PERCENTILE = 95


@dataclass(frozen=True)
class SyncSegment:
    text: str
    ends_line: bool
    # False for a segment kept as it is, whose times bound the windows around it.
    sync: bool
    start: float | None = None
    end: float | None = None
    # A rough start for a segment to sync, such as a line start from LRCLIB.
    near: float | None = None


@dataclass
class SyncedSegment:
    start: float | None = None
    end: float | None = None
    doubtful: bool = False
    # It is only for measuring. The job sends `doubtful`, never the aligner's own scale.
    confidence: float | None = None


def load_audio(path: Path, sample_rate: int) -> np.ndarray:
    """Read a track as mono float samples at sample_rate."""
    import librosa

    audio, _ = librosa.load(path, sr=sample_rate, mono=True)
    return audio


def sync(
    aligner: Aligner,
    audio: np.ndarray,
    segments: list[SyncSegment],
    on_progress: ProgressCallback | None = None,
) -> list[SyncedSegment]:
    """Place every segment marked for syncing, and leave the others empty.

    Each run of segments to sync is aligned only against the audio between the kept
    segments on either side of it. A segment with a rough start begins a run of its own,
    looked for around that start.
    """
    sample_rate = aligner.sample_rate
    duration = len(audio) / sample_rate
    results = [SyncedSegment() for _ in segments]
    runs = _runs(segments)
    # Soft windows overlap, so a run may not place a start before the previous run's.
    placed = 0.0
    for count, (first, last) in enumerate(runs):
        low = _window_start(segments, first)
        high = _window_end(segments, last, duration)
        if segments[first].near is not None:
            low = max(low, segments[first].near - SOFT_ANCHOR_MARGIN_SECONDS)
        following = segments[last] if last < len(segments) else None
        if following is not None and following.near is not None:
            high = min(high, following.near + SOFT_ANCHOR_MARGIN_SECONDS)
        if _continues_a_line(segments, first, last):
            high = min(
                high,
                low
                + (last - first) * LINE_WINDOW_SECONDS_PER_SYLLABLE
                + LINE_WINDOW_MARGIN_SECONDS,
            )
        if high <= low:
            continue

        def report(fraction: float | None, stage: str, count: int = count) -> None:
            if on_progress:
                on_progress((count + (fraction or 0)) / len(runs), stage)

        window = audio[round(low * sample_rate) : round(high * sample_rate)]
        alignments = aligner.align(
            window,
            [AlignerSegment(s.text, s.ends_line) for s in segments[first:last]],
            report,
        )
        if len(alignments) != last - first:
            raise ValueError(
                f"The {aligner.name} aligner returned {len(alignments)} alignments "
                f"for {last - first} segments"
            )

        previous = max(low, placed)
        for result, alignment in zip(results[first:last], alignments, strict=True):
            if alignment.start is None:
                continue
            start = alignment.start + low
            # A start out of order would draw a region out of order,
            # and a hole is fixable.
            if start < previous or start >= high:
                continue
            previous = placed = start
            result.start = start
            result.end = None if alignment.end is None else alignment.end + low
            result.confidence = alignment.confidence
            result.doubtful = (
                alignment.confidence is not None
                and alignment.confidence < aligner.doubtful_below
            )

    _set_ends(segments, results, _Loudness(audio, sample_rate), duration)
    return results


def _runs(segments: list[SyncSegment]) -> list[tuple[int, int]]:
    """Return the start and end indices of each run of segments to sync."""
    runs = []
    first = None
    for i, segment in enumerate(segments + [SyncSegment("", False, sync=False)]):
        if first is not None and (not segment.sync or segment.near is not None):
            runs.append((first, i))
            first = None
        if segment.sync and first is None:
            first = i
    return runs


def _continues_a_line(segments: list[SyncSegment], first: int, last: int) -> bool:
    """Return whether the run finishes the line of the kept segment before it.

    A run that crosses a line end may span an instrumental break, which no length per
    syllable predicts.
    """
    if first == 0 or segments[first - 1].ends_line:
        return False
    return not any(segment.ends_line for segment in segments[first : last - 1])


def _window_start(segments: list[SyncSegment], first: int) -> float:
    """Return where the timed kept segment before the run releases, or else starts."""
    for segment in reversed(segments[:first]):
        if not segment.sync and segment.start is not None:
            return segment.end if segment.end is not None else segment.start
    return 0.0


def _window_end(segments: list[SyncSegment], last: int, duration: float) -> float:
    """Return where the nearest timed kept segment after the run starts."""
    for segment in segments[last:]:
        if not segment.sync and segment.start is not None:
            return min(segment.start, duration)
    return duration


def _set_ends(
    segments: list[SyncSegment],
    results: list[SyncedSegment],
    loudness: "_Loudness",
    duration: float,
) -> None:
    """Give each synced segment the aligner's end, or else the release in the vocals."""
    for i, (segment, result) in enumerate(zip(segments, results, strict=True)):
        if not segment.sync or result.start is None:
            continue
        next_start = _next_start(segments, results, i)
        limit = duration if next_start is None else next_start
        end = result.end
        if end is None:
            end = loudness.release(result.start, limit)
        elif end <= result.start:
            end = None
        else:
            end = min(end, limit)
        if (
            end is not None
            and next_start is not None
            and next_start - end < OPEN_END_GAP_SECONDS
        ):
            end = None
        result.end = end


def _next_start(
    segments: list[SyncSegment], results: list[SyncedSegment], i: int
) -> float | None:
    for segment, result in zip(segments[i + 1 :], results[i + 1 :], strict=True):
        start = result.start if segment.sync else segment.start
        if start is not None:
            return start
    return None


class _Loudness:
    """Which stretches of the vocals are quiet, in 10 ms frames."""

    def __init__(self, audio: np.ndarray, sample_rate: int):
        self._hop = round(_LOUDNESS_HOP_SECONDS * sample_rate)
        self._seconds_per_frame = self._hop / sample_rate
        count = len(audio) // self._hop
        frames = audio[: count * self._hop].reshape(count, self._hop)
        decibels = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-10)
        loud_level = np.percentile(decibels, _LOUD_PERCENTILE) if count else 0.0
        self._quiet = decibels < loud_level + RELEASE_BELOW_DB

    def release(self, start: float, limit: float) -> float | None:
        """Return where the vocals first fall quiet after sounding, from start to limit.

        The search begins at the first loud frame, so a start placed just before the
        singing doesn't read the silence ahead of it as a release.
        """
        low = math.ceil(start / self._seconds_per_frame)
        high = min(math.floor(limit / self._seconds_per_frame), len(self._quiet))
        loud = np.flatnonzero(~self._quiet[low:high])
        if not len(loud):
            return None
        sounding = low + loud[0]
        needed = math.ceil(RELEASE_MIN_QUIET_SECONDS / self._seconds_per_frame)
        quiet = self._quiet[sounding:high].astype(int)
        if len(quiet) < needed:
            return None
        counts = np.convolve(quiet, np.ones(needed, dtype=int), mode="valid")
        full = np.flatnonzero(counts == needed)
        if not len(full):
            return None
        return (sounding + full[0]) * self._seconds_per_frame
