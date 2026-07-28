"""Filesystem-backed store for locally-processed separation jobs.

Used when no GCS bucket is configured (local development). A separation can run
for half an hour, which is far longer than a browser or a dev proxy will hold a
single request open, so the client is handed a poll URL immediately and the work
happens in the background. Results stay on disk, so re-running a song that has
already been separated is instant.

The layout under the job directory is one pair of files per cache hash:

    <hash>.json   job status, always present once a job has been created
    <hash>.zip    the separated tracks, present only once the job succeeded
"""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

import structlog

from .. import settings

logger = structlog.get_logger(__name__)

STATUS_PROCESSING = "processing"
STATUS_ERROR = "error"

# Advertised to the client in the status payload. Local jobs finish on the same
# machine, so there is no reason to wait as long between polls as the GCS path.
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

    The poll endpoint decides a job is finished by the presence of its zip, so a
    half-written result would be served as a corrupt download.
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


def mark_processing(cache_hash: str) -> None:
    """Record that a job has started."""
    _write_status(
        cache_hash, {"status": STATUS_PROCESSING, "startTime": int(time.time())}
    )


def mark_failed(cache_hash: str, error: str) -> None:
    """Record that a job failed so the client stops polling."""
    _write_status(
        cache_hash,
        {"status": STATUS_ERROR, "error": error, "endTime": int(time.time())},
    )


def read_status(cache_hash: str) -> Optional[dict]:
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

    A worker killed mid-job (a crash, or gunicorn's dev reloader restarting on a
    file edit) leaves its marker behind forever. Treating an over-age marker as
    dead is what stops the client polling for something nothing is working on.
    """
    if status.get("status") != STATUS_PROCESSING:
        return False
    age = time.time() - status.get("startTime", 0)
    return age > settings.LOCAL_JOB_STALE_AFTER_SECONDS


def store_result(cache_hash: str, zip_path: Path) -> Path:
    """File a finished zip under its cache hash and clear the status marker."""
    destination = result_path(cache_hash)
    _write_atomic(destination, zip_path.read_bytes())
    status_path(cache_hash).unlink(missing_ok=True)
    logger.info("job_result_stored", cache_hash=cache_hash, path=str(destination))
    return destination


def prune_expired_results() -> None:
    """Delete results past their TTL.

    Each result is roughly the size of two uncompressed WAVs, so without this the
    job directory grows without bound.
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
