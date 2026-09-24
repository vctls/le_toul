"""Where a separation runs.

One interface over the several places the work can happen: in this process, in
a child of it, on a remote GPU service, or behind a long-running daemon. The
deployment picks one with SEPARATION_BACKEND, so moving separation off the web
server is a setting rather than a rewrite.

Progress is part of the interface. A backend that cannot report a fraction
still reports its stage, and the client falls back to an elapsed-time estimate.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import IO, Protocol

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

_WORKER_MODULE = "api.karaoke.separation_worker"
_REPO_ROOT = Path(__file__).resolve().parents[2]


class SeparationBackend(Protocol):
    name: str

    def separate(
        self,
        songfile: Path,
        song_dir: Path,
        model_name: str,
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
    ) -> SeparationResult:
        return music_separation.split_song(
            songfile,
            song_dir,
            model_name,
            host=settings.SEPARATOR_HOST,
            port=settings.SEPARATOR_PORT,
            on_progress=on_progress,
        )


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
    PassthroughBackend.name: PassthroughBackend,
}

_REQUIRED_SETTING = {
    ModalBackend.name: (
        "SEPARATOR_MODAL_API_URL",
        lambda: settings.SEPARATOR_MODAL_API_URL,
    ),
    TcpBackend.name: ("SEPARATOR_HOST", lambda: settings.SEPARATOR_HOST),
}


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

    required = _REQUIRED_SETTING.get(name)
    if required and not required[1]():
        setting_name = required[0]
        raise ValueError(f"SEPARATION_BACKEND={name} requires {setting_name} to be set")

    return backend_class()
