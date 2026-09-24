"""The job protocol's runner for Modal, written against three small interfaces.

The web function records each task in a shared store and hands the separation
to a GPU function, which reports into the same store. No web container holds
a task in memory, so any of them can answer any poll.

modal_app.py implements the interfaces with Modal's objects, and the tests with
fakes, so nothing here imports the Modal SDK.
"""

import os
import shutil
import tempfile
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, BinaryIO, Protocol

import structlog

from api.karaoke.separation_backends import SeparationBackend
from api.separation_tasks import (
    FINISHED_STATES,
    TASK_TTL_SECONDS,
    TaskStatus,
    song_file_name,
)

logger = structlog.get_logger(__name__)

# Each report costs the GPU function a read and a write of the shared store,
# on the thread that runs the model.
REPORT_INTERVAL_SECONDS = 1.0


class Records(Protocol):
    """A store shared by every container, such as a modal.Dict."""

    def get(self, key: str, default: Any = None) -> Any: ...

    def __setitem__(self, key: str, value: Any) -> None: ...


class Files(Protocol):
    """A file store shared by every container, such as a modal.Volume."""

    def upload(self, source: BinaryIO, path: str) -> None: ...

    def download(self, path: str, destination: BinaryIO) -> None: ...


class GpuCalls(Protocol):
    def spawn(self, task_id: str, song_name: str, model_name: str) -> str:
        """Start the GPU function on a task, returning the call's ID."""

    def failure(self, call_id: str) -> str | None:
        """Say why a call ended without recording an outcome.

        None while it runs, and once it has returned.
        """

    def cancel(self, call_id: str) -> None: ...


class _TaskCancelled(Exception):
    """Raised out of a running separation whose task was cancelled."""


def _call_key(task_id: str) -> str:
    return f"{task_id}:call"


def _record(records: Records, task_id: str, status: TaskStatus) -> None:
    records[task_id] = status.model_dump()


def _read(records: Records, task_id: str) -> TaskStatus | None:
    record = records.get(task_id)
    return TaskStatus.model_validate(record) if record is not None else None


class ModalTaskRunner:
    """Runs tasks on a GPU function, keeping their records in a shared store."""

    def __init__(
        self,
        records: Records,
        files: Files,
        calls: GpuCalls,
        cache_dir: Path | None = None,
    ):
        self._records = records
        self._files = files
        self._calls = calls
        self._cache = cache_dir or Path(tempfile.mkdtemp(prefix="tuul_stems_"))
        self._cache.mkdir(parents=True, exist_ok=True)

    def submit(self, song: BinaryIO, filename: str, model_name: str) -> str:
        prune_task_files(self._cache, TASK_TTL_SECONDS)
        task_id = uuid.uuid4().hex
        song_name = song_file_name(filename)
        self._files.upload(song, f"{task_id}/{song_name}")
        # Recorded before the spawn, which the GPU function could otherwise overtake.
        _record(self._records, task_id, TaskStatus(status="queued"))
        call_id = self._calls.spawn(task_id, song_name, model_name)
        self._records[_call_key(task_id)] = call_id
        logger.info(
            "separation_task_submitted",
            task_id=task_id,
            call_id=call_id,
            model=model_name,
        )
        return task_id

    def status(self, task_id: str) -> TaskStatus | None:
        """Read a task's record, failing it if its call died without a word.

        A container that runs out of memory or time records nothing, and its
        record would otherwise stay running until it expired.
        """
        status = _read(self._records, task_id)
        if status is None or status.status in FINISHED_STATES:
            return status
        call_id = self._records.get(_call_key(task_id))
        failure = self._calls.failure(call_id) if call_id else None
        if failure is None:
            return status
        logger.error("separation_call_died", task_id=task_id, failure=failure)
        status = TaskStatus(status="error", error=failure)
        _record(self._records, task_id, status)
        return status

    def file(self, task_id: str, name: str) -> Path | None:
        status = _read(self._records, task_id)
        if status is None or name not in status.files.values():
            return None
        local = self._cache / task_id / name
        if not local.exists():
            local.parent.mkdir(parents=True, exist_ok=True)
            # Concurrent requests for the same file each write their own copy.
            # The rename keeps a reader from seeing a partial one.
            with tempfile.NamedTemporaryFile(dir=local.parent, delete=False) as part:
                self._files.download(f"{task_id}/{name}", part)
            os.replace(part.name, local)
        return local

    def cancel(self, task_id: str) -> bool:
        """Call off a task, returning whether there was one to call off."""
        status = _read(self._records, task_id)
        if status is None or status.status in FINISHED_STATES:
            return False
        _record(self._records, task_id, TaskStatus(status="cancelled"))
        call_id = self._records.get(_call_key(task_id))
        if call_id:
            self._calls.cancel(call_id)
        logger.info("separation_task_cancelled", task_id=task_id)
        return True


def run_task(
    records: Records,
    task_id: str,
    songfile: Path,
    model_name: str,
    backend: SeparationBackend,
    commit: Callable[[], None],
) -> None:
    """Separate a task's song into its directory, recording progress and outcome.

    The GPU function's body. commit runs before the task is recorded as done,
    so that a client never sees done before the stems are there to download.
    """
    status = _read(records, task_id)
    if status is None or status.status != "queued":
        return
    status = TaskStatus(status="running")
    _record(records, task_id, status)
    last_report = 0.0

    def report(progress: float | None, stage: str) -> None:
        nonlocal last_report
        stage_changed = stage != status.stage
        status.stage = stage
        if progress is not None:
            status.progress = round(progress, 3)
        now = time.monotonic()
        if not stage_changed and now - last_report < REPORT_INTERVAL_SECONDS:
            return
        last_report = now
        current = _read(records, task_id)
        if current is None or current.status == "cancelled":
            raise _TaskCancelled()
        _record(records, task_id, status)

    try:
        result = backend.separate(
            songfile, songfile.parent, model_name, on_progress=report
        )
    except _TaskCancelled:
        logger.info("separation_task_stopped", task_id=task_id)
        return
    except Exception as e:
        logger.exception("separation_task_failed", task_id=task_id)
        _record(records, task_id, TaskStatus(status="error", error=str(e)))
        return
    finally:
        songfile.unlink(missing_ok=True)

    commit()
    files = {
        "accompaniment": result.accompaniment.name,
        "vocals": result.vocals.name,
    }
    _record(records, task_id, TaskStatus(status="done", progress=1.0, files=files))
    logger.info("separation_task_done", task_id=task_id)


def prune_task_files(root: Path, max_age_seconds: float) -> None:
    """Delete the task directories under root last changed longer ago than max_age_seconds."""
    cutoff = time.time() - max_age_seconds
    for directory in root.iterdir():
        if directory.is_dir() and directory.stat().st_mtime < cutoff:
            shutil.rmtree(directory, ignore_errors=True)
