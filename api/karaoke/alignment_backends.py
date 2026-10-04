"""Where a sync runs.

The same choice separation_backends.py makes for separations, made apart so a
deployment can separate in one place and sync in another. ALIGNMENT_BACKEND picks
where, and ALIGNMENT_MODEL picks the aligner, which every backend runs the same way.

Nothing here imports the aligner's dependencies. A web server that only hands syncs
to a child process, or doesn't sync at all, never loads torch.
"""

import json
from pathlib import Path
from typing import Protocol

from api import settings
from api.karaoke import aligners, worker
from api.karaoke.separation_progress import ProgressCallback

# Syncing is off, and no control for it appears.
NONE = "none"


class AlignmentBackend(Protocol):
    name: str

    def align(
        self,
        vocals: Path,
        request: dict,
        work_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> dict:
        """Sync the request's segments to the vocals, returning the job's result.

        work_dir is scratch space the caller deletes afterwards.
        """
        ...


class InProcessBackend:
    """Syncs in the calling process, and keeps the model's memory there."""

    name = "in_process"

    def align(
        self,
        vocals: Path,
        request: dict,
        work_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> dict:
        from api.karaoke import alignment

        return alignment.align_track(
            settings.ALIGNMENT_MODEL,
            vocals,
            alignment.segments_from_request(request),
            on_progress,
        )


class SubprocessBackend:
    """Runs another backend in a child process that exits when the sync is done.

    Running out of memory then kills the child, not the web worker.
    """

    name = "subprocess"

    def __init__(self, inner: str = InProcessBackend.name):
        self._inner = inner

    def align(
        self,
        vocals: Path,
        request: dict,
        work_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> dict:
        request_path = work_dir / "request.json"
        request_path.write_text(json.dumps(request))
        result = worker.run(
            "align",
            [self._inner, str(vocals), str(request_path), str(work_dir)],
            on_progress,
        )
        return json.loads(Path(result["alignment"]).read_text())


_BACKENDS: dict[str, type[AlignmentBackend]] = {
    InProcessBackend.name: InProcessBackend,
    SubprocessBackend.name: SubprocessBackend,
}


def configured_name() -> str:
    """Return the backend syncing runs on, or NONE, raising if the settings can't work.

    Unset, it follows SEPARATION_BACKEND where that runs in this container, so a
    deployment that separates locally syncs locally the same way. It is NONE where the
    aligner's dependencies are missing, as in an image built without torch.
    """
    name = settings.ALIGNMENT_BACKEND
    if name and name != NONE and name not in _BACKENDS:
        raise ValueError(
            f"Unknown ALIGNMENT_BACKEND {name!r}. "
            f"Available: {sorted([*_BACKENDS, NONE])}"
        )
    missing = aligners.missing_dependencies(settings.ALIGNMENT_MODEL)

    if not name:
        follows = settings.SEPARATION_BACKEND
        return follows if follows in _BACKENDS and not missing else NONE
    if name != NONE and missing:
        raise ValueError(
            f"ALIGNMENT_BACKEND={name} needs {', '.join(missing)}, which the "
            f"{settings.ALIGNMENT_MODEL} aligner uses. "
            "Install the `ml` dependency group."
        )
    return name


def get_backend(name: str | None = None) -> AlignmentBackend:
    """Resolve the configured alignment backend.

    Raises when syncing is off, rather than syncing somewhere nobody chose.
    """
    name = name or configured_name()
    if name == NONE:
        raise ValueError("Syncing is off on this server.")
    try:
        return _BACKENDS[name]()
    except KeyError:
        raise ValueError(
            f"Unknown ALIGNMENT_BACKEND {name!r}. Available: {sorted(_BACKENDS)}"
        ) from None
