"""Where a separation runs.

One interface over the several places the work can happen: in this process, in
a child of it, on a remote GPU service, or behind a long-running daemon. The
deployment picks one with SEPARATION_BACKEND, so moving separation off the web
server is a setting rather than a rewrite.

Progress is part of the interface. A backend that cannot report a fraction
still reports its stage, and the client falls back to an elapsed-time estimate.
"""

import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import IO, Protocol, runtime_checkable
from urllib.parse import quote

import httpx
import structlog

from api import settings
from api.karaoke import music_separation, separation_progress
from api.karaoke.music_separation import (
    SeparationMethod,
    SeparationResult,
    get_output_paths,
)
from api.karaoke.separation_progress import ProgressCallback

logger = structlog.get_logger(__name__)

PROGRESS_FD_ENV = "TUUL_PROGRESS_FD"

# Matches the interval the browser polls the job store at.
REMOTE_POLL_INTERVAL_SECONDS = 3

_WORKER_MODULE = "api.karaoke.separation_worker"
_REPO_ROOT = Path(__file__).resolve().parents[2]


# Called with the ID of a task that another host now runs, so a restart can find it again.
SubmittedCallback = Callable[[str], None]


class SeparationBackend(Protocol):
    name: str

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult: ...


@runtime_checkable
class ResumableBackend(Protocol):
    """A backend whose separations run elsewhere and outlive this process."""

    def resume(
        self,
        task_id: str,
        song_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> SeparationResult: ...


class InProcessBackend:
    """Runs the separation in the calling process, via the audio-separator API.

    Imports torch into whatever process this is, and keeps it there.
    """

    name = "in_process"

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        return music_separation.split_song(
            songfile,
            song_dir,
            model_name,
            method=SeparationMethod.API,
            on_progress=on_progress,
        )


class SubprocessBackend:
    """Runs another backend in a child process that exits when the job is done.

    The web server never imports torch, so what a separation allocates leaves
    with the child rather than staying resident for the life of the deployment.
    The child reports through a pipe of its own, so progress survives the
    process boundary.
    """

    name = "subprocess"

    def __init__(self, inner: str = InProcessBackend.name):
        self._inner = inner

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        return _run_worker(self._inner, songfile, song_dir, model_name, on_progress)


def _run_worker(
    inner: str,
    songfile: Path,
    song_dir: Path,
    model_name: str,
    on_progress: ProgressCallback | None,
) -> SeparationResult:
    read_fd, write_fd = os.pipe()
    command = [
        sys.executable,
        "-m",
        _WORKER_MODULE,
        inner,
        str(songfile),
        str(song_dir),
        model_name,
    ]

    # A second pipe would need a select loop to drain, and a stderr buffer
    # nobody reads fills up and blocks the child partway through.
    with (
        tempfile.TemporaryFile() as errors,
        os.fdopen(read_fd, "r") as reports,
    ):
        try:
            worker = subprocess.Popen(
                command,
                # `-m` resolves against the child's own sys.path, which starts at its cwd.
                cwd=_REPO_ROOT,
                env={**os.environ, PROGRESS_FD_ENV: str(write_fd)},
                pass_fds=(write_fd,),
                stdin=subprocess.DEVNULL,
                stderr=errors,
            )
        finally:
            # The parent's copy holds the pipe open, so the reads below would
            # never reach the end of the reports.
            os.close(write_fd)

        try:
            result = _forward_reports(reports, on_progress)
        except BaseException:
            # A cancelled job raises out of on_progress, and the child would
            # otherwise separate on for another quarter of an hour.
            worker.kill()
            worker.wait()
            raise

        if worker.wait() != 0:
            raise RuntimeError(_worker_error(worker.returncode, errors))

        if result is None:
            raise RuntimeError("The separation worker finished without a result.")

        return result


def _forward_reports(
    reports: IO[str], on_progress: ProgressCallback | None
) -> SeparationResult | None:
    result = None

    for line in reports:
        try:
            report = json.loads(line)
        except json.JSONDecodeError:
            # A child killed mid-write leaves a partial line,
            # and its exit status is the better error anyway.
            break

        if "result" in report:
            result = SeparationResult(
                accompaniment=Path(report["result"]["accompaniment"]),
                vocals=Path(report["result"]["vocals"]),
            )
        elif on_progress:
            on_progress(report["progress"], report["stage"])

    return result


def _worker_error(returncode: int, errors: IO[bytes]) -> str:
    errors.seek(0)
    stderr = errors.read().decode("utf-8", "replace")
    logger.error("separation_worker_failed", returncode=returncode, stderr=stderr)

    message = f"The separation worker exited with code {returncode}."
    raised = _raised_exception(stderr)
    return f"{message} {raised}" if raised else message


def _raised_exception(stderr: str) -> str:
    """The exception a child died of, or empty if it did not die of one.

    audio-separator logs at INFO and draws tqdm bars on stderr, so the last line
    is the error only where the child raised one. A child that was killed — the
    out-of-memory case — leaves whatever it happened to be drawing.
    """
    lines = [line for line in stderr.splitlines() if line.strip()]
    if not any(line.startswith("Traceback (most recent call last):") for line in lines):
        return ""
    return lines[-1].strip()


class ModalBackend:
    """Calls a remote audio-separator deployment over HTTP.

    Reports no fraction: the upstream client polls a status document this code
    does not read. Replaced by a backend that does, along with a separator
    speaking the same protocol.
    """

    name = "modal"

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        return music_separation.split_song(
            songfile,
            song_dir,
            model_name,
            method=SeparationMethod.MODAL_API,
            modal_api_url=settings.SEPARATOR_MODAL_API_URL,
            on_progress=on_progress,
        )


class TcpBackend:
    """Calls the separator daemon, which is how compose.gpu.yaml reaches a GPU."""

    name = "tcp"

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        return music_separation.split_song(
            songfile,
            song_dir,
            model_name,
            host=settings.SEPARATOR_HOST,
            port=settings.SEPARATOR_PORT,
            on_progress=on_progress,
        )


class RemoteBackend:
    """Separates on a host that speaks the job protocol of api/separation_tasks.py.

    The song is uploaded, the task polled until it ends, and the stems
    downloaded under the names the server gives them. Every poll passes through
    on_progress, whose cancel check is the only place a cancelled job unwinds,
    and the remote task is cancelled on the way out.
    """

    name = "remote"

    # A network failure can be a blip on the way to a GPU host, so only a run of
    # them fails the job. At the poll interval, this is about a minute.
    MAX_CONSECUTIVE_POLL_FAILURES = 20

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        report = on_progress or (lambda progress, stage: None)
        # An injected client belongs to the caller, so only one made here is closed.
        owned = (
            contextlib.nullcontext(self._client) if self._client else _remote_client()
        )
        with owned as client:
            report(None, separation_progress.UPLOADING_STAGE)
            try:
                with songfile.open("rb") as song:
                    response = client.post(
                        "/tasks",
                        data={"modelName": model_name},
                        files={"songFile": (songfile.name, song)},
                    )
            except httpx.TransportError as e:
                raise RuntimeError(
                    f"The separation service at {client.base_url} is unreachable: {e}"
                ) from e
            _raise_for_status(response)
            task_id = response.json()["task_id"]
            logger.info("remote_task_submitted", task_id=task_id)
            return self._follow(client, task_id, song_dir, report, on_submitted)

    def resume(
        self,
        task_id: str,
        song_dir: Path,
        on_progress: ProgressCallback | None = None,
    ) -> SeparationResult:
        """Follow a task submitted before this process started, through to its stems."""
        report = on_progress or (lambda progress, stage: None)
        owned = (
            contextlib.nullcontext(self._client) if self._client else _remote_client()
        )
        with owned as client:
            logger.info("remote_task_resumed", task_id=task_id)
            return self._follow(client, task_id, song_dir, report)

    def _follow(
        self,
        client: httpx.Client,
        task_id: str,
        song_dir: Path,
        report: ProgressCallback,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        try:
            if on_submitted:
                on_submitted(task_id)
            status = self._wait_for(client, task_id, report)
        except BaseException:
            _cancel_quietly(client, task_id)
            raise

        report(None, separation_progress.DOWNLOADING_STEMS_STAGE)
        stems = {
            role: _download(client, task_id, name, song_dir)
            for role, name in status["files"].items()
        }
        return SeparationResult(
            accompaniment=stems["accompaniment"], vocals=stems["vocals"]
        )

    def _wait_for(
        self, client: httpx.Client, task_id: str, report: ProgressCallback
    ) -> dict:
        failures = 0
        while True:
            try:
                response = client.get(f"/tasks/{task_id}")
            except httpx.TransportError as e:
                failures += 1
                logger.warning("remote_poll_failed", task_id=task_id, error=str(e))
                if failures >= self.MAX_CONSECUTIVE_POLL_FAILURES:
                    raise RuntimeError(
                        f"The separation service stopped answering: {e}"
                    ) from e
                time.sleep(REMOTE_POLL_INTERVAL_SECONDS)
                continue
            failures = 0

            if response.status_code == 404:
                raise RuntimeError(
                    "The separation service no longer knows this task. "
                    "It has probably restarted."
                )
            _raise_for_status(response)
            status = response.json()

            if status["status"] == "done":
                return status
            if status["status"] == "error":
                raise RuntimeError(status["error"] or "The separation failed.")
            if status["status"] == "cancelled":
                raise RuntimeError("The separation service cancelled the task.")

            if status["status"] == "queued":
                report(None, separation_progress.WAITING_FOR_GPU_STAGE)
            else:
                report(
                    status["progress"],
                    status["stage"] or separation_progress.LOADING_STAGE,
                )
            time.sleep(REMOTE_POLL_INTERVAL_SECONDS)


def _remote_client() -> httpx.Client:
    headers = {}
    if settings.SEPARATION_REMOTE_KEY:
        headers = {
            "Modal-Key": settings.SEPARATION_REMOTE_KEY,
            "Modal-Secret": settings.SEPARATION_REMOTE_SECRET,
        }
    # Every request returns at once except the transfers, and the timeout applies to
    # each read and write rather than to a whole transfer.
    return httpx.Client(
        base_url=settings.SEPARATION_REMOTE_URL,
        headers=headers,
        timeout=httpx.Timeout(60.0),
    )


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise RuntimeError(
            "The separation service rejected this server's credentials. "
            "Check SEPARATION_REMOTE_KEY and SEPARATION_REMOTE_SECRET."
        )
    if response.is_error:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        raise RuntimeError(
            f"The separation service answered {response.status_code}: {detail}"
        )


def _download(client: httpx.Client, task_id: str, name: str, song_dir: Path) -> Path:
    # The name comes from the server, and only its last component is trusted.
    destination = song_dir / Path(name).name
    with client.stream(
        "GET", f"/tasks/{task_id}/files/{quote(name, safe='')}"
    ) as response:
        if response.is_error:
            response.read()
        _raise_for_status(response)
        with destination.open("wb") as f:
            for chunk in response.iter_bytes():
                f.write(chunk)
    return destination


def _cancel_quietly(client: httpx.Client, task_id: str) -> None:
    """Ask the server to stop a task this side has given up on.

    Best effort: the job is already ending, and a failure here must not hide why.
    """
    try:
        client.post(f"/tasks/{task_id}/cancel")
        logger.info("remote_task_cancelled", task_id=task_id)
    except httpx.HTTPError:
        logger.warning("remote_task_cancel_failed", task_id=task_id)


class PassthroughBackend:
    """Copies the input to both stems, separating nothing.

    Lets tests exercise the surrounding job flow without paying for a real
    separation. Reachable only by name: nothing falls back to it, because a
    deployment that had quietly stopped separating would look like a working one.
    """

    name = "passthrough"

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
        on_progress: ProgressCallback | None = None,
        on_submitted: SubmittedCallback | None = None,
    ) -> SeparationResult:
        paths = get_output_paths(song_dir)
        shutil.copyfile(songfile, paths.accompaniment)
        shutil.copyfile(songfile, paths.vocals)
        if on_progress:
            on_progress(1.0, separation_progress.SEPARATING_STAGE)
        return paths


_BACKENDS: dict[str, type[SeparationBackend]] = {
    InProcessBackend.name: InProcessBackend,
    SubprocessBackend.name: SubprocessBackend,
    ModalBackend.name: ModalBackend,
    TcpBackend.name: TcpBackend,
    RemoteBackend.name: RemoteBackend,
    PassthroughBackend.name: PassthroughBackend,
}


def _requires(setting: str) -> Callable[[], str | None]:
    return lambda: (
        None if getattr(settings, setting) else f"requires {setting} to be set"
    )


def _check_remote() -> str | None:
    if not settings.SEPARATION_REMOTE_URL:
        return "requires SEPARATION_REMOTE_URL to be set"
    if bool(settings.SEPARATION_REMOTE_KEY) != bool(settings.SEPARATION_REMOTE_SECRET):
        return "requires SEPARATION_REMOTE_KEY and SEPARATION_REMOTE_SECRET to be set together"
    return None


# Each returns what is wrong with the backend's configuration, or None.
_CHECKS: dict[str, Callable[[], str | None]] = {
    ModalBackend.name: _requires("SEPARATOR_MODAL_API_URL"),
    TcpBackend.name: _requires("SEPARATOR_HOST"),
    RemoteBackend.name: _check_remote,
}


def is_resumable(name: str) -> bool:
    """Return whether the named backend can pick up a task after a restart."""
    backend_class = _BACKENDS.get(name)
    return backend_class is not None and issubclass(backend_class, ResumableBackend)


def get_backend(name: str | None = None) -> SeparationBackend:
    """Resolve the configured separation backend.

    Raises rather than falling back, so a misconfigured remote backend is a
    startup error instead of a separation that silently runs somewhere else.
    """
    name = name or settings.SEPARATION_BACKEND

    try:
        backend_class = _BACKENDS[name]
    except KeyError:
        raise ValueError(
            f"Unknown SEPARATION_BACKEND {name!r}. Available: {sorted(_BACKENDS)}"
        ) from None

    check = _CHECKS.get(name)
    problem = check() if check else None
    if problem:
        raise ValueError(f"SEPARATION_BACKEND={name} {problem}")

    return backend_class()
