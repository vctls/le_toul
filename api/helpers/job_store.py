"""Filesystem-backed store for locally-processed separation jobs.

Used when no GCS bucket is configured (local development).
A separation can run for half an hour,
which is far longer than a browser or a dev proxy will hold a single request open,
so the client is handed a poll URL immediately and the work happens in the background.
Results stay on disk, so re-running a song that has already been separated is instant.

The layout under the job directory is one pair of files per cache hash:

    <hash>.json   job status, always present once a job has been created
    <hash>.zip    the separated tracks, present only once the job succeeded
"""

import json
import os
import tempfile
import time
import uuid
from pathlib import Path

import structlog

from .. import settings

logger = structlog.get_logger(__name__)

STATUS_PROCESSING = "processing"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"

CANCELLED_MESSAGE = "Track separation was cancelled."
INTERRUPTED_MESSAGE = "Track separation was interrupted by a server restart."
WORKER_EXITED_MESSAGE = (
    "Track separation stopped because the server process running it exited. "
    "This usually means the server ran out of memory."
)


class JobCancelled(Exception):
    """Raised inside a worker that is no longer the job the client is waiting on."""


# Advertised to the client in the status payload.
# Local jobs finish on the same machine, so there is no reason to wait as long between polls as the GCS path.
POLL_INTERVAL_SECONDS = 3


def job_dir() -> Path:
    """Return the job directory, creating it if needed."""
    directory = Path(settings.LOCAL_JOB_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def status_path(cache_hash: str) -> Path:
    return job_dir() / f"{cache_hash}.json"


def result_path(cache_hash: str) -> Path:
    return job_dir() / f"{cache_hash}.zip"


def poll_url(cache_hash: str) -> str:
    """Return the URL the client polls for this job."""
    return f"/separated_track/{cache_hash}"


def _write_atomic(path: Path, data: bytes) -> None:
    """Write data to path so readers never observe a partial file.

    The poll endpoint decides a job is finished by the presence of its zip,
    so a half-written result would be served as a corrupt download.
    """
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def _write_status(cache_hash: str, status: dict) -> None:
    _write_atomic(status_path(cache_hash), json.dumps(status).encode("utf-8"))


def _write_run_outcome(cache_hash: str, run_id: str | None, outcome: dict) -> None:
    """Record how a run ended, unless a later one has taken over the hash."""
    status = read_status(cache_hash)
    if run_id and status and status.get("runId") not in (run_id, None):
        return
    _write_status(cache_hash, {**outcome, "endTime": int(time.time())})


def mark_processing(cache_hash: str) -> str:
    """Record that a job has started, returning the token identifying this run.

    A hash can be picked up again while an earlier worker is still alive
    (its marker went stale, or its run was cancelled and the song resubmitted),
    so every write a worker makes is against its own token.
    """
    run_id = uuid.uuid4().hex
    _write_status(
        cache_hash,
        {
            "status": STATUS_PROCESSING,
            "startTime": int(time.time()),
            "runId": run_id,
            # The run dies with this process, and is failed when the process exits.
            "pid": os.getpid(),
        },
    )
    return run_id


def is_current_run(cache_hash: str, run_id: str) -> bool:
    """Return whether this run is still the one the client is waiting on."""
    status = read_status(cache_hash)
    return bool(
        status
        and status.get("runId") == run_id
        and status.get("status") == STATUS_PROCESSING
        and not status.get("cancelRequested")
    )


def request_cancel(cache_hash: str) -> bool:
    """Ask a running job to stop, returning whether there was one to ask.

    The worker unwinds at its next progress report:
    the separation only returns to our code between those, so nothing can stop it sooner.
    """
    status = read_status(cache_hash)
    if not status or status.get("status") != STATUS_PROCESSING:
        return False
    _write_status(cache_hash, {**status, "cancelRequested": True})
    return True


def mark_cancelled(cache_hash: str, run_id: str) -> None:
    """Record that a run stopped at its client's request."""
    _write_run_outcome(
        cache_hash,
        run_id,
        {"status": STATUS_CANCELLED, "error": CANCELLED_MESSAGE},
    )


def mark_queued(cache_hash: str, run_id: str, ahead: int) -> None:
    """Record that a run is waiting in line behind `ahead` other songs."""
    if not is_current_run(cache_hash, run_id):
        return
    songs = "song" if ahead == 1 else "songs"
    _write_status(
        cache_hash,
        {
            **read_status(cache_hash),
            "stage": f"waiting in line, {ahead} {songs} ahead",
            "songsAhead": ahead,
        },
    )


def mark_started(cache_hash: str, run_id: str) -> bool:
    """Record that a run has left the line, returning whether it should go ahead.

    The start time is reset, so the wait in line does not count towards staleness.
    """
    if not is_current_run(cache_hash, run_id):
        return False
    status = read_status(cache_hash)
    status.pop("songsAhead", None)
    status.pop("stage", None)
    _write_status(cache_hash, {**status, "startTime": int(time.time())})
    return True


def mark_submitted(cache_hash: str, run_id: str, task_id: str) -> None:
    """Record the remote task a run is waiting on, so a restart can follow it."""
    if not is_current_run(cache_hash, run_id):
        return
    _write_status(cache_hash, {**read_status(cache_hash), "taskId": task_id})


def remote_jobs() -> list[tuple[str, dict]]:
    """Return every job still processing that waits on a remote task, with its status."""
    directory = Path(settings.LOCAL_JOB_DIR)
    if not directory.is_dir():
        return []
    jobs = []
    for path in sorted(directory.glob("*.json")):
        status = read_status(path.stem)
        if status and status.get("status") == STATUS_PROCESSING and "taskId" in status:
            jobs.append((path.stem, status))
    return jobs


def adopt(cache_hash: str, run_id: str) -> None:
    """Make this process the owner of a run a previous one left behind.

    A worker that exits fails the jobs recorded under its pid, so the run has to
    be recorded under the pid that now follows it.
    """
    status = read_status(cache_hash)
    if status and status.get("runId") == run_id:
        _write_status(cache_hash, {**status, "pid": os.getpid()})


def mark_progress(cache_hash: str, progress: float | None, stage: str) -> None:
    """Record how far along a running job is.

    A report with no fraction names the stage and leaves the last figure standing,
    so an unmeasurable phase does not send the client's bar backwards into indeterminate.

    Reports for a job that is no longer processing are dropped:
    a separation that failed on its way out must not be reopened by a late report.
    """
    status = read_status(cache_hash)
    if not status or status.get("status") != STATUS_PROCESSING:
        return
    update = {"stage": stage}
    if progress is not None:
        update["progress"] = round(progress, 3)
    _write_status(cache_hash, {**status, **update})


def mark_failed(cache_hash: str, error: str, run_id: str | None = None) -> None:
    """Record that a job failed so the client stops polling."""
    _write_run_outcome(cache_hash, run_id, {"status": STATUS_ERROR, "error": error})


def read_status(cache_hash: str) -> dict | None:
    """Return the recorded status for a job, or None if there is no such job."""
    path = status_path(cache_hash)
    try:
        return json.loads(path.read_bytes())
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        logger.warning("job_status_unreadable", cache_hash=cache_hash, path=str(path))
        return None


def is_stale(status: dict) -> bool:
    """Return whether a processing job has outlived any plausible run.

    Under gunicorn, the master fails a dead worker's jobs as soon as it exits.
    This is the fallback for a process nothing is watching,
    whose marker would otherwise be left behind forever.
    """
    if status.get("status") != STATUS_PROCESSING:
        return False
    # A song in line has no worker to die, and a restart fails it along with the rest.
    if "songsAhead" in status:
        return False
    age = time.time() - status.get("startTime", 0)
    return age > settings.LOCAL_JOB_STALE_AFTER_SECONDS


def fail_interrupted_jobs(spare_remote_jobs: bool = False) -> None:
    """Mark every job still processing as failed.

    Only safe before any worker has started, since nothing can be running then.
    Without it, a job killed by a restart blocks its song until its marker goes stale.
    With spare_remote_jobs, a job waiting on a remote task is left for a worker
    to pick up, since the task went on running while this server was down.
    """
    _fail_processing_jobs(INTERRUPTED_MESSAGE, spare_remote_jobs=spare_remote_jobs)


def fail_jobs_of_worker(pid: int, spare_remote_jobs: bool = False) -> None:
    """Mark every job still processing in the worker process `pid` as failed.

    Called once that process has exited, which leaves nothing to finish its jobs.
    With spare_remote_jobs, a job waiting on a remote task is left for the
    worker that replaces this one, which picks it up at startup.
    """
    _fail_processing_jobs(
        WORKER_EXITED_MESSAGE, pid=pid, spare_remote_jobs=spare_remote_jobs
    )


def _fail_processing_jobs(
    error: str, pid: int | None = None, spare_remote_jobs: bool = False
) -> None:
    directory = Path(settings.LOCAL_JOB_DIR)
    if not directory.is_dir():
        return
    for path in directory.glob("*.json"):
        cache_hash = path.stem
        status = read_status(cache_hash)
        if not status or status.get("status") != STATUS_PROCESSING:
            continue
        if pid is not None and status.get("pid") != pid:
            continue
        if spare_remote_jobs and "taskId" in status:
            continue
        mark_failed(cache_hash, error, status.get("runId"))
        logger.info("local_job_interrupted", cache_hash=cache_hash, pid=pid)


def store_result(cache_hash: str, zip_path: Path) -> Path:
    """File a finished zip under its cache hash and clear the status marker."""
    destination = result_path(cache_hash)
    _write_atomic(destination, zip_path.read_bytes())
    status_path(cache_hash).unlink(missing_ok=True)
    logger.info("job_result_stored", cache_hash=cache_hash, path=str(destination))
    return destination


def prune_expired_results() -> None:
    """Delete results past their TTL.

    Each result is roughly the size of two uncompressed WAVs,
    so without this the job directory grows without bound.
    """
    ttl = settings.LOCAL_JOB_RESULT_TTL_SECONDS
    if ttl <= 0:
        return

    cutoff = time.time() - ttl
    for path in job_dir().glob("*.zip"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                logger.info("job_result_pruned", path=str(path))
        except OSError:
            logger.warning("job_result_prune_failed", path=str(path))
