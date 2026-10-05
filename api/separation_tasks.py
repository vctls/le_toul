"""The job protocol for separations and syncs, served by whatever host holds the GPU.

A client uploads a song, gets a task ID back at once, and polls for progress
until the stems are ready to download. Nothing is held open for the length of
a separation, so neither a slow model nor a cold start meets a request timeout.
A sync goes the same way, with a vocals track and its request in, and one JSON
file out.

The router is shared by every host that speaks the protocol. What differs
between hosts is the TaskRunner: where a task runs and where its record lives.
"""

import hmac
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, Literal, Protocol, runtime_checkable

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
from pydantic import BaseModel, ValidationError

from api import settings
from api.karaoke import aligners, alignment_backends
from api.karaoke.alignment_backends import AlignmentBackend, AlignmentRequest
from api.karaoke.music_separation import AVAILABLE_MODELS
from api.karaoke.separation_backends import InProcessBackend, SeparationBackend
from api.karaoke.separation_progress import ProgressCallback

logger = structlog.get_logger(__name__)

TaskState = Literal["queued", "running", "done", "error", "cancelled"]

TaskKind = Literal["separate", "align"]

FINISHED_STATES: tuple[TaskState, ...] = ("done", "error", "cancelled")

# A client downloads the stems as soon as it sees `done`, so an hour is only a
# margin for a client that restarted in between.
TASK_TTL_SECONDS = 60 * 60

_SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,10}$")


def song_file_name(filename: str, stem: str = "song") -> str:
    """Name a task's upload after the uploaded file's extension, if it has a plausible one.

    ffmpeg and libsndfile sniff the content, so the name matters only to a
    reader of the logs.
    """
    suffix = Path(filename).suffix
    return f"{stem}{suffix if _SAFE_SUFFIX.match(suffix) else ''}"


class TaskStatus(BaseModel):
    status: TaskState
    progress: float | None = None
    stage: str | None = None
    # File names by role once the task is done: "accompaniment" and "vocals" for a
    # separation, "alignment" for a sync.
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


@runtime_checkable
class AlignmentRunner(Protocol):
    """A runner that syncs as well as separates."""

    def submit_alignment(self, vocals: BinaryIO, filename: str, request: dict) -> str:
        """Start a sync, raising CannotSync if this host can't run one."""
        ...


class CannotSync(Exception):
    """Raised by a runner whose host is missing what a sync needs."""


class _TaskCancelled(Exception):
    """Raised out of a running task that was cancelled."""


# Runs a task on its upload, reporting progress, and returns its files by role.
Work = Callable[[Path, ProgressCallback], dict[str, str]]


def separation_work(backend: SeparationBackend, model_name: str) -> Work:
    """Separate an uploaded song beside it, offering both stems."""

    def separate(songfile: Path, report: ProgressCallback) -> dict[str, str]:
        result = backend.separate(
            songfile, songfile.parent, model_name, on_progress=report
        )
        return {
            "accompaniment": result.accompaniment.name,
            "vocals": result.vocals.name,
        }

    return separate


def alignment_work(backend: AlignmentBackend, request: dict) -> Work:
    """Sync an uploaded vocals track, offering the result as a JSON file beside it."""

    def align(vocalsfile: Path, report: ProgressCallback) -> dict[str, str]:
        result = backend.align(
            vocalsfile, request, vocalsfile.parent, on_progress=report
        )
        destination = vocalsfile.parent / alignment_backends.RESULT_FILE
        destination.write_text(json.dumps(result))
        return {"alignment": destination.name}

    return align


@dataclass
class _Task:
    directory: Path
    # "separation" or "alignment", which names the task in log events.
    kind: str
    work: Work
    status: TaskStatus = field(default_factory=lambda: TaskStatus(status="queued"))
    future: Future | None = None
    finished_at: float | None = None


class LocalTaskRunner:
    """Runs tasks one at a time in this process, keeping their records in memory.

    One at a time because the host has one GPU, and two tasks on it would share
    it and run out of its memory sooner. The records live in this process, so the
    server must run a single worker.
    """

    def __init__(
        self,
        backend: SeparationBackend | None = None,
        alignment_backend: AlignmentBackend | None = None,
    ):
        self._backend = backend or InProcessBackend()
        self._alignment_backend = (
            alignment_backend or alignment_backends.InProcessBackend()
        )
        self._root = Path(tempfile.mkdtemp(prefix="tuul_tasks_"))
        self._tasks: dict[str, _Task] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="task")

    def submit(self, song: BinaryIO, filename: str, model_name: str) -> str:
        task_id = self._add(
            "separation",
            song,
            song_file_name(filename),
            separation_work(self._backend, model_name),
        )
        logger.info("separation_task_submitted", task_id=task_id, model=model_name)
        return task_id

    def submit_alignment(self, vocals: BinaryIO, filename: str, request: dict) -> str:
        missing = aligners.missing_dependencies(settings.ALIGNMENT_MODEL)
        if missing:
            raise CannotSync(f"This host can't sync without {', '.join(missing)}.")
        task_id = self._add(
            "alignment",
            vocals,
            song_file_name(filename, stem="vocals"),
            alignment_work(self._alignment_backend, request),
        )
        logger.info("alignment_task_submitted", task_id=task_id)
        return task_id

    def _add(self, kind: str, upload: BinaryIO, upload_name: str, work: Work) -> str:
        """Store a task's upload in a directory of its own, and queue the task."""
        self._prune()
        task_id = uuid.uuid4().hex
        directory = self._root / task_id
        directory.mkdir()

        uploaded = directory / upload_name
        with uploaded.open("wb") as destination:
            shutil.copyfileobj(upload, destination)

        task = _Task(directory=directory, kind=kind, work=work)
        with self._lock:
            self._tasks[task_id] = task
            task.future = self._executor.submit(self._run, task_id, task, uploaded)
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
        report, which is the only point the work hands control back.
        """
        with self._lock:
            task = self._tasks.get(task_id)
            if not task or task.status.status in FINISHED_STATES:
                return False
            self._finish(task, TaskStatus(status="cancelled"))
            if task.future:
                task.future.cancel()
        logger.info(f"{task.kind}_task_cancelled", task_id=task_id)
        return True

    def _run(self, task_id: str, task: _Task, uploaded: Path) -> None:
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
            files = task.work(uploaded, report)
        except _TaskCancelled:
            logger.info(f"{task.kind}_task_stopped", task_id=task_id)
            return
        except Exception as e:
            logger.exception(f"{task.kind}_task_failed", task_id=task_id)
            with self._lock:
                self._finish(task, TaskStatus(status="error", error=str(e)))
            return
        finally:
            uploaded.unlink(missing_ok=True)

        with self._lock:
            self._finish(task, TaskStatus(status="done", progress=1.0, files=files))
        logger.info(f"{task.kind}_task_done", task_id=task_id)

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


def _submit_alignment(runner: TaskRunner, vocals: UploadFile, request: str) -> str:
    """Start a sync on a runner that can run one, refusing it with a 400 otherwise."""
    if not isinstance(runner, AlignmentRunner):
        raise HTTPException(status_code=400, detail="This host doesn't sync.")
    try:
        body = AlignmentRequest.model_validate_json(request)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors(include_url=False)) from e
    try:
        return runner.submit_alignment(
            vocals.file, vocals.filename or "vocals", body.model_dump(exclude_none=True)
        )
    except CannotSync as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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
            raise HTTPException(status_code=404, detail="Unknown task")
        return status

    @router.post("", status_code=202)
    def submit_task(
        kind: TaskKind = Form("separate"),
        songFile: UploadFile | None = File(None),
        modelName: str | None = Form(None),
        vocalsFile: UploadFile | None = File(None),
        request: str | None = Form(None),
    ) -> SubmittedTask:
        """Start a task, and return its ID at once.

        A separation takes `songFile` and `modelName`. A sync takes `vocalsFile` and the
        JSON `request` that /align_track takes.
        """
        if kind == "align":
            if vocalsFile is None or request is None:
                raise HTTPException(
                    status_code=400, detail="A sync needs vocalsFile and request."
                )
            return SubmittedTask(task_id=_submit_alignment(runner, vocalsFile, request))

        if songFile is None or modelName is None:
            raise HTTPException(
                status_code=400, detail="A separation needs songFile and modelName."
            )
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
