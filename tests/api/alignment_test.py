"""Tests for the steps every sync goes through, whatever the aligner.

A stub aligner returns set answers, so each test states exactly what the model said
and checks what the shared steps make of it. The audio is a tone where the vocals
sound and silence elsewhere.
"""

import numpy as np
import pytest

from api.karaoke.aligners import AlignerSegment, SegmentAlignment
from api.karaoke.alignment import SyncSegment, sync

SAMPLE_RATE = 16000


class StubAligner:
    name = "stub"
    version = "1"
    sample_rate = SAMPLE_RATE
    doubtful_below = 0.5

    def __init__(self, *answers: list[SegmentAlignment]):
        self._answers = list(answers)
        self.calls: list[tuple[float, list[AlignerSegment]]] = []

    def align(self, audio, segments, on_progress=None):
        self.calls.append((len(audio) / self.sample_rate, segments))
        return self._answers.pop(0)


def _vocals(seconds: float, *sounding: tuple[float, float]) -> np.ndarray:
    """Return silence with a tone wherever the vocals sound."""
    audio = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    for begin, end in sounding:
        times = np.arange(int(begin * SAMPLE_RATE), int(end * SAMPLE_RATE))
        audio[times] = 0.5 * np.sin(2 * np.pi * 220 * times / SAMPLE_RATE)
    return audio


def _to_sync(*texts: str) -> list[SyncSegment]:
    return [SyncSegment(text, ends_line=False, sync=True) for text in texts]


def test_a_start_out_of_order_becomes_a_hole():
    aligner = StubAligner(
        [
            SegmentAlignment(start=2.0),
            SegmentAlignment(start=1.0),
            SegmentAlignment(start=3.0),
        ]
    )

    results = sync(aligner, _vocals(4), _to_sync("a", "b", "c"))

    assert [r.start for r in results] == [2.0, None, 3.0]


def test_a_missing_end_is_where_the_vocals_are_released():
    aligner = StubAligner([SegmentAlignment(start=1.0), SegmentAlignment(start=3.0)])

    results = sync(
        aligner, _vocals(4, (1.0, 2.0), (3.0, 3.5)), _to_sync("held", "next")
    )

    assert results[0].end == pytest.approx(2.0, abs=0.02)


def test_a_consonant_gap_is_not_a_release():
    aligner = StubAligner([SegmentAlignment(start=1.0), SegmentAlignment(start=3.0)])
    vocals = _vocals(4, (1.0, 1.5), (1.6, 2.0), (3.0, 3.5))

    results = sync(aligner, vocals, _to_sync("tiques", "next"))

    assert results[0].end == pytest.approx(2.0, abs=0.02)


def test_an_end_close_to_the_next_start_is_left_open():
    aligner = StubAligner([SegmentAlignment(start=1.0), SegmentAlignment(start=3.0)])

    results = sync(
        aligner, _vocals(4, (1.0, 2.8), (3.0, 3.5)), _to_sync("legato", "next")
    )

    assert results[0].end is None


def test_an_end_from_the_aligner_is_kept_and_capped_at_the_next_start():
    aligner = StubAligner(
        [
            SegmentAlignment(start=0.5, end=1.5),
            SegmentAlignment(start=2.0, end=3.5),
            SegmentAlignment(start=3.0, end=2.5),
        ]
    )

    results = sync(aligner, _vocals(4), _to_sync("a", "b", "c"))

    assert results[0].end == 1.5
    # Capped at the next start, which leaves it too close to that start to stand.
    assert results[1].end is None
    # An end before its own start is dropped.
    assert results[2].end is None


def test_only_the_audio_between_kept_segments_is_aligned():
    segments = [
        SyncSegment("kept", True, sync=False, start=1.0, end=2.0),
        SyncSegment("synced", True, sync=True),
        SyncSegment("kept", False, sync=False, start=6.0),
    ]
    aligner = StubAligner([SegmentAlignment(start=1.5)])

    results = sync(aligner, _vocals(8), segments)

    window, sent = aligner.calls[0]
    assert window == pytest.approx(4.0)
    assert [s.text for s in sent] == ["synced"]
    assert results[1].start == pytest.approx(3.5)
    assert results[0].start is None and results[2].start is None


def test_a_window_starts_at_the_kept_start_when_the_kept_segment_has_no_end():
    segments = [
        SyncSegment("kept", False, sync=False, start=1.0),
        SyncSegment("synced", False, sync=True),
    ]
    aligner = StubAligner([SegmentAlignment(start=0.5)])

    results = sync(aligner, _vocals(3), segments)

    assert aligner.calls[0][0] == pytest.approx(2.0)
    assert results[1].start == pytest.approx(1.5)


def test_each_run_between_kept_segments_is_aligned_on_its_own():
    segments = [
        SyncSegment("a", False, sync=True),
        SyncSegment("kept", False, sync=False, start=2.0, end=2.5),
        SyncSegment("b", False, sync=True),
    ]
    aligner = StubAligner([SegmentAlignment(start=0.5)], [SegmentAlignment(start=0.5)])

    results = sync(aligner, _vocals(4), segments)

    assert [call[0] for call in aligner.calls] == [
        pytest.approx(2.0),
        pytest.approx(1.5),
    ]
    assert results[0].start == pytest.approx(0.5)
    assert results[2].start == pytest.approx(3.0)


def test_a_segment_below_the_aligners_threshold_is_doubtful():
    aligner = StubAligner(
        [
            SegmentAlignment(start=0.5, confidence=0.9),
            SegmentAlignment(start=1.5, confidence=0.1),
            SegmentAlignment(start=2.5),
        ]
    )

    results = sync(aligner, _vocals(4), _to_sync("a", "b", "c"))

    assert [r.doubtful for r in results] == [False, True, False]


def test_an_aligner_breaking_the_contract_raises():
    aligner = StubAligner([SegmentAlignment(start=0.5)])

    with pytest.raises(ValueError, match="1 alignments for 2 segments"):
        sync(aligner, _vocals(4), _to_sync("a", "b"))


def test_progress_covers_every_run():
    segments = [
        SyncSegment("a", False, sync=True),
        SyncSegment("kept", False, sync=False, start=2.0),
        SyncSegment("b", False, sync=True),
    ]

    class Reporting(StubAligner):
        def align(self, audio, segments, on_progress=None):
            on_progress(1.0, "aligning the lyrics")
            return super().align(audio, segments)

    reports = []
    aligner = Reporting([SegmentAlignment()], [SegmentAlignment()])

    sync(
        aligner, _vocals(4), segments, lambda fraction, stage: reports.append(fraction)
    )

    assert reports == [0.5, 1.0]


def test_silent_vocals_give_no_ends():
    aligner = StubAligner([SegmentAlignment(start=1.0)])

    results = sync(aligner, _vocals(3), _to_sync("a"))

    assert results[0].end is None


def test_the_rest_of_a_line_is_looked_for_soon_after_its_anchor():
    segments = [
        SyncSegment("kept", False, sync=False, start=1.0),
        SyncSegment("b", False, sync=True),
        SyncSegment("c", True, sync=True),
        SyncSegment("next", False, sync=False, start=20.0),
    ]
    aligner = StubAligner([SegmentAlignment(), SegmentAlignment()])

    sync(aligner, _vocals(22), segments)

    # Two syllables at a second each, and two seconds of margin.
    assert aligner.calls[0][0] == pytest.approx(4.0)


def test_a_run_crossing_a_line_end_is_not_capped():
    segments = [
        SyncSegment("kept", False, sync=False, start=1.0),
        SyncSegment("b", True, sync=True),
        SyncSegment("c", True, sync=True),
        SyncSegment("next", False, sync=False, start=20.0),
    ]
    aligner = StubAligner([SegmentAlignment(), SegmentAlignment()])

    sync(aligner, _vocals(22), segments)

    assert aligner.calls[0][0] == pytest.approx(19.0)


def test_a_run_starting_a_line_is_not_capped():
    segments = [
        SyncSegment("kept", True, sync=False, start=1.0),
        SyncSegment("b", True, sync=True),
        SyncSegment("next", False, sync=False, start=20.0),
    ]
    aligner = StubAligner([SegmentAlignment()])

    sync(aligner, _vocals(22), segments)

    assert aligner.calls[0][0] == pytest.approx(19.0)


def test_a_soft_anchor_is_looked_for_around_its_start():
    segments = [
        SyncSegment("a", False, sync=True),
        SyncSegment("b", True, sync=True),
        SyncSegment("c", False, sync=True, near=5.0),
        SyncSegment("d", True, sync=True),
        SyncSegment("e", False, sync=True, near=12.0),
    ]
    aligner = StubAligner(
        [SegmentAlignment(start=1.0), SegmentAlignment(start=2.0)],
        [SegmentAlignment(start=0.5), SegmentAlignment(start=3.0)],
        [SegmentAlignment(start=0.5)],
    )

    results = sync(aligner, _vocals(14), segments)

    assert [call[0] for call in aligner.calls] == [
        pytest.approx(6.0),
        pytest.approx(9.0),
        pytest.approx(3.0),
    ]
    assert [r.start for r in results] == pytest.approx([1.0, 2.0, 4.5, 7.0, 11.5])


def test_a_start_before_the_previous_runs_is_a_hole():
    segments = [
        SyncSegment("a", False, sync=True),
        SyncSegment("b", False, sync=True, near=2.0),
    ]
    aligner = StubAligner([SegmentAlignment(start=2.5)], [SegmentAlignment(start=1.0)])

    results = sync(aligner, _vocals(5), segments)

    assert results[0].start == pytest.approx(2.5)
    assert results[1].start is None
