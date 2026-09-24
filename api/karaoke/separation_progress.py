"""Real progress for a separation running in this process.

audio-separator 0.44 exposes no progress callback, but every architecture runs
its inference over a tqdm loop of known length, and the model download uses one
too, so substituting tqdm in those modules is the only place the work done so
far is observable. The substitution is process-wide while a separation runs, so
the bar classes resolve their tracker from a thread local: a concurrent
separation reports against its own job, and tqdm used anywhere else reports
nothing.
"""

import contextlib
import importlib
import threading
from collections.abc import Callable, Iterator

from tqdm import tqdm

# A report with no fraction names the stage only, for phases whose progress
# cannot be read.
ProgressCallback = Callable[[float | None, str], None]

CONVERTING_STAGE = "converting the song"
LOADING_STAGE = "loading the separation model"
DOWNLOAD_STAGE = "downloading the separation model"
READING_STAGE = "reading the song"
SEPARATING_STAGE = "separating the vocals"
PACKAGING_STAGE = "packaging the tracks"

# Share of the bar given to the model download. It happens only the first time a model is used,
# and the separation dwarfs it.
_DOWNLOAD_SHARE = 0.05

_DOWNLOAD_MODULE = "audio_separator.separator.separator"

# Every file gets its own bar, and the model index and configs are a few KB
# that finish first. Reporting them would fill the download share before the
# weights begin, since reported progress never moves backwards.
_MIN_REPORTED_DOWNLOAD_BYTES = 1_000_000

# Every reported figure is a file write the client polls for, so a chunk-level
# report on a long song would be thousands of writes no one can see.
_MIN_REPORTED_DELTA = 0.005

_active = threading.local()

_patch_lock = threading.Lock()
_patch_depth = 0
_originals: dict[str, object] = {}


class _Tracker:
    def __init__(self, on_progress: ProgressCallback):
        self._on_progress = on_progress
        self._last_reported = -1.0
        self._passes_done = 0
        self._pass_weights: tuple[float, ...] = (1.0,)

    def stage(self, stage: str) -> None:
        """Name a phase that runs outside any tqdm loop, so has no fraction."""
        self._on_progress(None, stage)

    def expect_passes(self, weights: tuple[float, ...]) -> None:
        if self._passes_done == 0:
            self._pass_weights = weights

    def downloaded(self, fraction: float) -> None:
        self._report(_DOWNLOAD_SHARE * fraction, DOWNLOAD_STAGE)

    def separated(self, fraction: float) -> None:
        index = min(self._passes_done, len(self._pass_weights) - 1)
        done = sum(self._pass_weights[:index]) + self._pass_weights[index] * fraction
        self._report_separation(done)

    def pass_finished(self) -> None:
        # tqdm stops calling update once its print interval stops elapsing, so
        # without a report here a pass ends a few chunks short of its share.
        self._passes_done = min(self._passes_done + 1, len(self._pass_weights))
        self._report_separation(
            sum(self._pass_weights[: self._passes_done]), force=True
        )

    def _report_separation(self, done: float, force: bool = False) -> None:
        self._report(
            _DOWNLOAD_SHARE + (1 - _DOWNLOAD_SHARE) * done, SEPARATING_STAGE, force
        )

    def _report(self, progress: float, stage: str, force: bool = False) -> None:
        progress = min(max(progress, 0.0), 1.0)
        if not force and progress - self._last_reported < _MIN_REPORTED_DELTA:
            return
        self._last_reported = progress
        self._on_progress(progress, stage)


def _tracker() -> _Tracker | None:
    return getattr(_active, "tracker", None)


def _fraction(bar: tqdm) -> float | None:
    if not bar.total:
        return None
    return bar.n / bar.total


class _ChunkBar(tqdm):
    """Reports the inference loop of one demixing pass.

    `pass_weights` is the share of the separation each loop takes in the
    architecture this class is patched into, in the order they run.
    """

    pass_weights: tuple[float, ...] = (1.0,)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        tracker = _tracker()
        if tracker:
            tracker.expect_passes(self.pass_weights)

    def update(self, n=1):
        result = super().update(n)
        tracker = _tracker()
        fraction = _fraction(self)
        if tracker and fraction is not None:
            tracker.separated(fraction)
        return result

    def close(self):
        # tqdm closes the bar from its own iteration teardown as well, and a
        # second close would count the pass twice.
        was_open = not self.disable
        super().close()
        tracker = _tracker()
        if tracker and was_open:
            tracker.pass_finished()


class _MdxChunkBar(_ChunkBar):
    # MDX demixes twice: once for the primary stem, then again in match_mix
    # mode to derive the secondary one. The second pass skips the model itself,
    # so it takes a small fraction of the time despite its comparable chunk count.
    pass_weights = (0.9, 0.1)


class _DownloadBar(tqdm):
    def update(self, n=1):
        result = super().update(n)
        tracker = _tracker()
        fraction = _fraction(self)
        if (
            tracker
            and fraction is not None
            and self.total >= _MIN_REPORTED_DOWNLOAD_BYTES
        ):
            # A gzipped response counts decompressed bytes against its
            # compressed content-length, so the count can pass the total.
            tracker.downloaded(min(fraction, 1.0))
        return result


# Architectures absent here (VR, Demucs) report no fraction at all, and the
# client falls back to its elapsed-time estimate.
_PATCHED_MODULES: dict[str, type] = {
    "audio_separator.separator.architectures.mdx_separator": _MdxChunkBar,
    "audio_separator.separator.architectures.mdxc_separator": _ChunkBar,
    _DOWNLOAD_MODULE: _DownloadBar,
}


def _install_patches() -> None:
    global _patch_depth
    with _patch_lock:
        _patch_depth += 1
        if _patch_depth > 1:
            return
        for module_name, bar_class in _PATCHED_MODULES.items():
            try:
                module = importlib.import_module(module_name)
            except ModuleNotFoundError:
                continue
            if not hasattr(module, "tqdm"):
                continue
            _originals[module_name] = module.tqdm
            module.tqdm = bar_class


def _remove_patches() -> None:
    global _patch_depth
    with _patch_lock:
        _patch_depth -= 1
        if _patch_depth > 0:
            return
        for module_name, original in _originals.items():
            module = importlib.import_module(module_name)
            module.tqdm = original
        _originals.clear()


def _ignore(progress: float | None, stage: str) -> None:
    pass


@contextlib.contextmanager
def reporting(on_progress: ProgressCallback | None) -> Iterator[_Tracker]:
    """Report separation progress to on_progress for the duration of the block.

    Yields the tracker, whose `stage` names the phases that run outside the
    loops this reports from.
    """
    if on_progress is None:
        yield _Tracker(_ignore)
        return

    tracker = _Tracker(on_progress)
    _active.tracker = tracker
    _install_patches()
    try:
        yield tracker
    finally:
        _remove_patches()
        del _active.tracker
