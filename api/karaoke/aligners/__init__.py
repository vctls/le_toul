"""Aligners place lyrics that are already known in a vocals track, one module per model.

Nothing outside this package knows which model runs. It hands an aligner segments and
audio, and gets back times in seconds, so replacing the model means adding a module
here and changing ALIGNMENT_MODEL.
"""

import importlib
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from api.karaoke.separation_progress import ProgressCallback


@dataclass(frozen=True)
class AlignerSegment:
    # The text as drawn, without the `_` and `/` markup.
    text: str
    ends_line: bool


@dataclass
class SegmentAlignment:
    start: float | None = None
    end: float | None = None
    # On the aligner's own scale, which its doubtful_below interprets.
    confidence: float | None = None


class Aligner(Protocol):
    name: str
    # Changes whenever the output can, so a job from an older aligner is never reused.
    version: str
    sample_rate: int
    doubtful_below: float

    def align(
        self,
        audio: np.ndarray,
        segments: list[AlignerSegment],
        on_progress: ProgressCallback | None = None,
    ) -> list[SegmentAlignment]:
        """Place the segments in mono audio at sample_rate.

        Returns one entry per segment, in order, in seconds from the start of the audio.
        Any field may be None, for a segment the aligner cannot place or an end it
        cannot measure.
        """
        ...


# Modules are imported only when selected, so listing the aligners never imports torch.
_ALIGNERS = {
    "fake": "api.karaoke.aligners.fake:FakeAligner",
    "mms_fa": "api.karaoke.aligners.mms_fa:MmsFaAligner",
}


def aligner_names() -> list[str]:
    return list(_ALIGNERS)


def get_aligner(name: str) -> Aligner:
    """Instantiate the aligner registered under name."""
    try:
        module_name, class_name = _ALIGNERS[name].split(":")
    except KeyError:
        raise ValueError(
            f"Unknown aligner {name!r}. Known aligners: {', '.join(_ALIGNERS)}"
        ) from None
    return getattr(importlib.import_module(module_name), class_name)()
