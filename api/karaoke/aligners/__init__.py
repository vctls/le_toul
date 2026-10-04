"""Aligners place lyrics that are already known in a vocals track, one module per model.

Nothing outside this package knows which model runs. It hands an aligner segments and
audio, and gets back times in seconds, so replacing the model means adding a module
here and changing ALIGNMENT_MODEL.
"""

from __future__ import annotations

import importlib
import importlib.util
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from api.karaoke.separation_progress import ProgressCallback

# A web server that syncs on another host may not have numpy, and still reads this.
if TYPE_CHECKING:
    import numpy as np


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


# Each aligner's class, and the modules it needs beyond the shared steps'.
# Modules are imported only when selected, so listing the aligners never imports torch.
_ALIGNERS = {
    "fake": ("api.karaoke.aligners.fake:FakeAligner", ()),
    "mms_fa": (
        "api.karaoke.aligners.mms_fa:MmsFaAligner",
        ("torch", "torchaudio", "uroman"),
    ),
}

# What the shared steps in alignment.py need, whichever aligner runs.
_SHARED_DEPENDENCIES = ("numpy", "librosa")


def aligner_names() -> list[str]:
    return list(_ALIGNERS)


def _entry(name: str) -> tuple[str, tuple[str, ...]]:
    try:
        return _ALIGNERS[name]
    except KeyError:
        raise ValueError(
            f"Unknown aligner {name!r}. Known aligners: {', '.join(_ALIGNERS)}"
        ) from None


def aligner_class(name: str) -> type[Aligner]:
    """Return the class registered under name, without building an aligner."""
    module_name, class_name = _entry(name)[0].split(":")
    return getattr(importlib.import_module(module_name), class_name)


def get_aligner(name: str) -> Aligner:
    """Instantiate the aligner registered under name."""
    return aligner_class(name)()


def missing_dependencies(name: str) -> list[str]:
    """Return the modules syncing with the named aligner needs and can't find."""
    return [
        module
        for module in (*_SHARED_DEPENDENCIES, *_entry(name)[1])
        if importlib.util.find_spec(module) is None
    ]
