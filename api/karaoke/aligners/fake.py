"""An aligner with no model, for tests and as the floor for real aligners."""

from __future__ import annotations

from typing import TYPE_CHECKING

from api.karaoke.aligners import AlignerSegment, SegmentAlignment
from api.karaoke.separation_progress import ProgressCallback

# A web server that syncs on another host may not have numpy, and still reads the version.
if TYPE_CHECKING:
    import numpy as np


class FakeAligner:
    name = "fake"
    version = "1"
    sample_rate = 16000
    doubtful_below = 0.0

    def align(
        self,
        audio: np.ndarray,
        segments: list[AlignerSegment],
        on_progress: ProgressCallback | None = None,
    ) -> list[SegmentAlignment]:
        """Spread the segments that have text evenly over the audio."""
        duration = len(audio) / self.sample_rate
        placed = [i for i, segment in enumerate(segments) if segment.text.strip()]
        alignments = [SegmentAlignment() for _ in segments]
        for rank, i in enumerate(placed):
            alignments[i].start = duration * rank / len(placed)
        return alignments
