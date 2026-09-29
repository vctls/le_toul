"""An aligner with no model, for tests and as the floor for real aligners."""

import numpy as np

from api.karaoke.aligners import AlignerSegment, SegmentAlignment
from api.karaoke.separation_progress import ProgressCallback


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
