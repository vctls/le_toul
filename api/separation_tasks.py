"""The separation job protocol, served by whatever host holds the GPU.

A client uploads a song, gets a task ID back at once, and polls for progress
until the stems are ready to download. Nothing is held open for the length of
a separation, so neither a slow model nor a cold start meets a request timeout.

The router is shared by every host that speaks the protocol. What differs
between hosts is the TaskRunner: where a task runs and where its record lives.
"""

import hmac
import re
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, Literal, Protocol

import structlog
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api import settings
from api.karaoke.music_separation import AVAILABLE_MODELS
from api.karaoke.separation_backends import InProcessBackend, SeparationBackend

logger = structlog.get_logger(__name__)

TaskState = Literal["queued", "running", "done", "error", "cancelled"]

FINISHED_STATES: tuple[TaskState, ...] = ("done", "error", "cancelled")

# A client downloads the stems as soon as it sees `done`, so an hour is only a
# margin for a client that restarted in between.
TASK_TTL_SECONDS = 60 * 60

_SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,10}$")


def song_file_name(filename: str) -> str:
    """Name a task's song after the uploaded file's extension, if it has a plausible one.

    ffmpeg and libsndfile sniff the content, so the name matters only to a
    reader of the logs.
    """
    suffix = Path(filename).suffix
    return f"song{suffix if _SAFE_SUFFIX.match(suffix) else ''}"


class TaskStatus(BaseModel):
    status: TaskState
    progress: float | None = None
    stage: str | None = None
    # File names by role, "accompaniment" and "vocals", once the task is done.
    files: dict[str, str] = {}
    error: str | None = None


class SubmittedTask(BaseModel):
    task_id: str


class CancelledTask(BaseModel):
    cancelled: bool


class TaskRunner(Protocol):
    def submit(self, song: BinaryIO, filename: str, model_name: str) -> str: ...

    def status(self, task_id: str) -> TaskStatus | None: ...

    def file(self, task_id: str, name: str) -> Path | None: ...

    def cancel(self, task_id: str) -> bool: ...


class _TaskCancelled(Exception):
    """Raised out of a running separation whose task was cancelled."""


@dataclass
class _Task:
    directory: Path
    model_name: str
    status: TaskStatus = field(default_factory=lambda: TaskStatus(status="queued"))
    future: Future | None = None
    finished_at: float | None = None


class LocalTaskRunner:
    """Runs tasks one at a time in this process, keeping their records in memory.

    One at a time because the host has one GPU, and two separations on it
    would share it and run out of its memory sooner. The records live in this
    process, so the server must run a single worker.
    """

    def __init__(self, backend: SeparationBackend | None = None):
        self._backend = backend or InProcessBackend()
        self._root = Path(tempfile.mkdtemp(prefix="tuul_tasks_"))
        self._tasks: dict[str, _Task] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="separation"
        )

    def submit(self, song: BinaryIO, filename: str, model_name: str) -> str:
        self._prune()
        task_id = uuid.uuid4().hex
        directory = self._root / task_id
        directory.mkdir()

        songfile = directory / song_file_name(filename)
        with songfile.open("wb") as destination:
            shutil.copyfileobj(song, destination)

        task = _Task(directory=directory, model_name=model_name)
        with self._lock:
            self._tasks[task_id] = task
            task.future = self._executor.submit(self._run, task_id, task, songfile)
        logger.info("separation_task_submitted", task_id=task_id, model=model_name)
        return task_id

    def status(self, task_id: str) -> TaskStatus | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return task.status.model_copy() if task else None

    def file(self, task_id: str, name: str) -> Path | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task or name not in task.status.files.values():
                return None
            return task.directory / name

    def cancel(self, task_id: str) -> bool:
        """Call off a task, returning whether there was one to call off.

        A queued task never starts. A running one stops at its next progress
        report, which is the only point the separation hands control back.
        """
        with self._lock:
            task = self._tasks.get(task_id)
            if not task or task.status.status in FINISHED_STATES:
                return False
            self._finish(task, TaskStatus(status="cancelled"))
            if task.future:
                task.future.cancel()
        logger.info("separation_task_cancelled", task_id=task_id)
        return True

    def _run(self, task_id: str, task: _Task, songfile: Path) -> None:
        with self._lock:
            if task.status.status != "queued":
                return
            task.status = TaskStatus(status="running")

        def report(progress: float | None, stage: str) -> None:
            with self._lock:
                if task.status.status == "cancelled":
                    raise _TaskCancelled()
                task.status.stage = stage
                if progress is not None:
                    task.status.progress = round(progress, 3)

        try:
            result = self._backend.separate(
                songfile, task.directory, task.model_name, on_progress=report
            )
        except _TaskCancelled:
            logger.info("separation_task_stopped", task_id=task_id)
            return
        except Exception as e:
            logger.exception("separation_task_failed", task_id=task_id)
            with self._lock:
                self._finish(task, TaskStatus(status="error", error=str(e)))
            return
        finally:
            songfile.unlink(missing_ok=True)

        files = {
            "accompaniment": result.accompaniment.name,
            "vocals": result.vocals.name,
        }
        with self._lock:
            self._finish(task, TaskStatus(status="done", progress=1.0, files=files))
        logger.info("separation_task_done", task_id=task_id)

    def _finish(self, task: _Task, status: TaskStatus) -> None:
        """Record how a task ended, unless it has already ended. The caller holds the lock."""
        if task.status.status in FINISHED_STATES:
            return
        task.status = status
        task.finished_at = time.time()

    def _prune(self) -> None:
        cutoff = time.time() - TASK_TTL_SECONDS
        with self._lock:
            expired = [
                task_id
                for task_id, task in self._tasks.items()
                if task.finished_at is not None and task.finished_at < cutoff
            ]
            for task_id in expired:
                task = self._tasks.pop(task_id)
                shutil.rmtree(task.directory, ignore_errors=True)


def check_credentials(
    modal_key: str | None = Header(default=None, alias="Modal-Key"),
    modal_secret: str | None = Header(default=None, alias="Modal-Secret"),
) -> None:
    """Reject a request without the configured key and secret.

    The headers are the ones Modal's proxy auth reads, so one client serves
    both hosts. With no key configured, every request is let through.
    """
    key, secret = settings.SEPARATOR_SERVER_KEY, settings.SEPARATOR_SERVER_SECRET
    if not key:
        return
    if not (
        modal_key
        and modal_secret
        and hmac.compare_digest(modal_key.encode(), key.encode())
        and hmac.compare_digest(modal_secret.encode(), secret.encode())
    ):
        raise HTTPException(status_code=401, detail="Missing or wrong credentials")


def create_router(runner: TaskRunner) -> APIRouter:
    """Build the protocol's routes over a runner."""
    if bool(settings.SEPARATOR_SERVER_KEY) != bool(settings.SEPARATOR_SERVER_SECRET):
        raise ValueError(
            "SEPARATOR_SERVER_KEY and SEPARATOR_SERVER_SECRET must be set together"
        )

    router = APIRouter(prefix="/tasks", dependencies=[Depends(check_credentials)])

    def known_status(task_id: str) -> TaskStatus:
        status = runner.status(task_id)
        if status is None:
            raise HTTPException(status_code=404, detail="Unknown separation task")
        return status

    @router.post("", status_code=202)
    def submit_task(
        songFile: UploadFile = File(...), modelName: str = Form(...)
    ) -> SubmittedTask:
        if modelName not in AVAILABLE_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown model {modelName}. Available: {AVAILABLE_MODELS}",
            )
        task_id = runner.submit(songFile.file, songFile.filename or "song", modelName)
        return SubmittedTask(task_id=task_id)

    @router.get("/{task_id}")
    def task_status(task_id: str) -> TaskStatus:
        return known_status(task_id)

    @router.get("/{task_id}/files/{name}")
    def task_file(task_id: str, name: str) -> FileResponse:
        known_status(task_id)
        path = runner.file(task_id, name)
        if path is None:
            raise HTTPException(status_code=404, detail="No such file for this task")
        return FileResponse(path)

    @router.post("/{task_id}/cancel")
    def cancel_task(task_id: str) -> CancelledTask:
        known_status(task_id)
        return CancelledTask(cancelled=runner.cancel(task_id))

    return router
