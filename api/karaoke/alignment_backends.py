"""Where a sync runs.

The same choice separation_backends.py makes for separations, made apart so a
deployment can separate in one place and sync in another. ALIGNMENT_BACKEND picks
where, and ALIGNMENT_MODEL picks the aligner, which every backend runs the same way.

Nothing here imports the aligner's dependencies. A web server that only hands syncs
to a child process or another host, or doesn't sync at all, never loads torch.
"""

import contextlib
import json
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field

from api import settings
from api.karaoke import aligners, separation_backends, separation_progress, worker
from api.karaoke.separation_progress import ProgressCallback

# Syncing is off, and no control for it appears.
NONE = "none"

# The file a sync's result is written to, wherever it runs.
RESULT_FILE = "alignment.json"

# A song has hundreds of segments, rarely more than a couple of thousand.
MAX_ALIGNMENT_SEGMENTS = 20_000


class AlignmentSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The text as drawn, without the `_` and `/` markup.
    text: str = Field(max_length=1000)
    endsLine: bool
    # False for a segment kept as it is.
    sync: bool
    start: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    end: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class AlignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segments: list[AlignmentSegment] = Field(
        min_length=1, max_length=MAX_ALIGNMENT_SEGMENTS
    )


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


class RemoteBackend:
    """Syncs on the host that separates, over the job protocol of api/separation_tasks.py.

    It reaches the host the separation's remote backend does, with the same settings,
    and needs none of the aligner's dependencies here.
    """

    name = "remote"

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def align(
        self,
        vocals: Path,
        request: dict,
        work_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> dict:
        report = on_progress or (lambda progress, stage: None)
        # An injected client belongs to the caller, so only one made here is closed.
        owned = (
            contextlib.nullcontext(self._client)
            if self._client
            else separation_backends.remote_client()
        )
        with owned as client:
            report(None, separation_progress.UPLOADING_STAGE)
            try:
                with vocals.open("rb") as stem:
                    response = client.post(
                        "/tasks",
                        data={"kind": "align", "request": json.dumps(request)},
                        files={"vocalsFile": (vocals.name, stem)},
                    )
            except httpx.TransportError as e:
                raise RuntimeError(
                    f"The separation service at {client.base_url} is unreachable: {e}"
                ) from e
            separation_backends.raise_for_status(response)
            task_id = response.json()["task_id"]
            try:
                status = separation_backends.wait_for_task(client, task_id, report)
            except BaseException:
                separation_backends.cancel_task_quietly(client, task_id)
                raise
            result = separation_backends.download_task_file(
                client, task_id, status["files"]["alignment"], work_dir
            )
            return json.loads(result.read_text())


# The backends that sync in this container, which an unset ALIGNMENT_BACKEND can follow.
_LOCAL_BACKENDS: dict[str, type[AlignmentBackend]] = {
    InProcessBackend.name: InProcessBackend,
    SubprocessBackend.name: SubprocessBackend,
}

_BACKENDS: dict[str, type[AlignmentBackend]] = {
    **_LOCAL_BACKENDS,
    RemoteBackend.name: RemoteBackend,
}


def configured_name() -> str:
    """Return the backend syncing runs on, or NONE, raising if the settings can't work.

    Unset, it follows SEPARATION_BACKEND where that runs in this container, so a
    deployment that separates locally syncs locally the same way. It is NONE where the
    aligner's dependencies are missing, as in an image built without torch.

    It never follows a remote separation, since not every host that separates can sync.
    `remote` is set explicitly, and needs the aligner's dependencies only on that host.
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
        return follows if follows in _LOCAL_BACKENDS and not missing else NONE
    if name == RemoteBackend.name:
        problem = separation_backends.check_remote()
        if problem:
            raise ValueError(f"ALIGNMENT_BACKEND=remote {problem}")
        return name
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
