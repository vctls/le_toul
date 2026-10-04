"""One job in a child process, reporting its progress over a pipe.

Torch is imported here rather than in the web server, so the memory a job
holds is given back when this exits. Progress is why this exists rather than
the stock audio-separator CLI, which reports nothing a caller can read.

Spawned by the subprocess backends as

    python -m api.karaoke.worker separate <backend> <songfile> <song_dir> <model>

with the writable end of a pipe inherited as TUUL_PROGRESS_FD. One JSON object
per line goes down it, a run of progress reports followed by a single result.
Everything else this has to say goes to stderr, which the parent reads only
when the exit status is non-zero.
"""

import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import IO

import structlog

from api.karaoke.separation_progress import ProgressCallback

logger = structlog.get_logger(__name__)

PROGRESS_FD_ENV = "TUUL_PROGRESS_FD"

_WORKER_MODULE = "api.karaoke.worker"
_REPO_ROOT = Path(__file__).resolve().parents[2]

# What each kind of job is called in an error.
_NOUNS = {"separate": "separation"}


def run(kind: str, args: list[str], on_progress: ProgressCallback | None) -> dict:
    """Run one job of the given kind in a child process, and return its result."""
    read_fd, write_fd = os.pipe()
    command = [sys.executable, "-m", _WORKER_MODULE, kind, *args]

    # A second pipe would need a select loop to drain, and a stderr buffer
    # nobody reads fills up and blocks the child partway through.
    with (
        tempfile.TemporaryFile() as errors,
        os.fdopen(read_fd, "r") as reports,
    ):
        try:
            worker = subprocess.Popen(
                command,
                # `-m` resolves against the child's sys.path, which starts at its cwd.
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
            # otherwise work on for another quarter of an hour.
            worker.kill()
            worker.wait()
            raise

        if worker.wait() != 0:
            raise RuntimeError(_worker_error(worker.returncode, errors, kind))

        if result is None:
            raise RuntimeError(f"The {_NOUNS[kind]} worker finished without a result.")

        return result


def _forward_reports(
    reports: IO[str], on_progress: ProgressCallback | None
) -> dict | None:
    result = None

    for line in reports:
        try:
            report = json.loads(line)
        except json.JSONDecodeError:
            # A child killed mid-write leaves a partial line,
            # and its exit status is the better error anyway.
            break

        if "result" in report:
            result = report["result"]
        elif on_progress:
            on_progress(report["progress"], report["stage"])

    return result


def _worker_error(returncode: int, errors: IO[bytes], kind: str = "separate") -> str:
    errors.seek(0)
    stderr = errors.read().decode("utf-8", "replace")
    logger.error(f"{_NOUNS[kind]}_worker_failed", returncode=returncode, stderr=stderr)

    message = f"The {_NOUNS[kind]} worker exited with code {returncode}."
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


def _separate(args: list[str], on_progress: ProgressCallback) -> dict:
    from api.karaoke.separation_backends import get_backend

    backend_name, songfile, song_dir, model_name = args
    result = get_backend(backend_name).separate(
        Path(songfile), Path(song_dir), model_name, on_progress=on_progress
    )
    return {"accompaniment": str(result.accompaniment), "vocals": str(result.vocals)}


# The backend modules import this one, so each kind imports its own when it runs.
_KINDS: dict[str, Callable[[list[str], ProgressCallback], dict]] = {
    "separate": _separate,
}


def main(argv: list[str]) -> None:
    kind, *args = argv

    with os.fdopen(int(os.environ[PROGRESS_FD_ENV]), "w") as reports:

        def send(report: dict) -> None:
            reports.write(json.dumps(report) + "\n")
            reports.flush()

        result = _KINDS[kind](
            args,
            lambda progress, stage: send({"progress": progress, "stage": stage}),
        )
        send({"result": result})


if __name__ == "__main__":
    main(sys.argv[1:])
