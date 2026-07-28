"""Tests for the local (no GCS bucket) separation job flow.

The client is handed a poll URL immediately and the separation runs in a
background task, so these cover what the client sees at each stage of a job.
"""

import os
import tempfile
import time
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api import settings
from api.helpers import cloud_storage, job_store
from api.main import app

SONG_CONTENT = b"test audio content"
MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def no_bucket():
    """Run with GCS caching disabled, which selects the local job store."""
    with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""):
        yield


@pytest.fixture
def song_files():
    """Stub out the separation itself, yielding the zip it would have produced."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        accomp_path = temp_dir_path / "accompaniment.wav"
        vocal_path = temp_dir_path / "vocals.wav"
        zip_path = temp_dir_path / "split_song.zip"

        accomp_path.write_bytes(b"accompaniment content")
        vocal_path.write_bytes(b"vocals content")
        with zipfile.ZipFile(zip_path, "w") as zip_file:
            zip_file.write(accomp_path, "accompaniment.wav")
            zip_file.write(vocal_path, "vocals.wav")

        with mock.patch(
            "api.karaoke.music_separation.split_song",
            return_value=(accomp_path, vocal_path),
        ) as mock_split_song:
            with mock.patch(
                "api.helpers.zip_helper.create_zip_file", return_value=zip_path
            ):
                yield mock_split_song


def post_song(client):
    return client.post(
        "/separate_track",
        data={"modelName": MODEL_NAME},
        files={"songFile": ("test_song.mp3", SONG_CONTENT, "audio/mpeg")},
    )


def cache_hash():
    return cloud_storage.get_cache_hash(MODEL_NAME, SONG_CONTENT)


def test_finished_job_serves_the_zip(client, no_bucket, song_files):
    """A completed job serves a zip containing both stems."""
    poll_url = post_song(client).json()["finishedTrackURL"]

    response = client.get(poll_url)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(BytesIO(response.content)) as zip_file:
        assert sorted(zip_file.namelist()) == ["accompaniment.wav", "vocals.wav"]


def test_running_job_reports_processing_with_poll_interval(client):
    """A job still in flight reports its status and how long to wait."""
    job_store.mark_processing("a" * 64)

    response = client.get(f"/separated_track/{'a' * 64}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert body["status"] == "processing"
    assert body["pollIntervalSeconds"] == job_store.POLL_INTERVAL_SECONDS


def test_failed_job_reports_the_error(client, no_bucket):
    """A separation that raises is recorded, so the client stops polling."""
    with mock.patch(
        "api.karaoke.music_separation.split_song", side_effect=RuntimeError("boom")
    ):
        poll_url = post_song(client).json()["finishedTrackURL"]

    response = client.get(poll_url)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert body["status"] == "error"
    assert "boom" in body["error"]


def test_job_abandoned_by_a_dead_worker_reports_an_error(client, monkeypatch):
    """A processing marker older than any plausible run is treated as dead.

    Without this the client would poll forever for a job whose worker was killed.
    """
    monkeypatch.setattr(settings, "LOCAL_JOB_STALE_AFTER_SECONDS", 60)
    job_store.mark_processing("b" * 64)
    job_store._write_status(
        "b" * 64, {"status": "processing", "startTime": int(time.time()) - 3600}
    )

    body = client.get(f"/separated_track/{'b' * 64}").json()

    assert body["status"] == "error"


def test_unknown_job_is_not_found(client):
    """A hash with no job behind it is a 404 rather than an empty download."""
    assert client.get(f"/separated_track/{'c' * 64}").status_code == 404


@pytest.mark.parametrize(
    "bad_hash",
    [
        "../../etc/passwd",
        "not-a-hash",
        "A" * 64,  # uppercase is not produced by hexdigest
        "a" * 63,
    ],
)
def test_hash_that_is_not_a_digest_is_rejected(client, bad_hash):
    """The hash builds a filename, so anything but a sha256 digest is refused."""
    assert client.get(f"/separated_track/{bad_hash}").status_code in (404, 422)


def test_repeat_request_reuses_the_stored_result(client, no_bucket, song_files):
    """Re-separating the same song with the same model does no work twice."""
    first = post_song(client).json()["finishedTrackURL"]
    assert song_files.call_count == 1

    second = post_song(client).json()["finishedTrackURL"]

    assert second == first
    assert song_files.call_count == 1
    assert client.get(second).headers["content-type"] == "application/zip"


def test_request_for_a_running_job_does_not_start_a_second_one(
    client, no_bucket, song_files
):
    """A duplicate request joins the running job instead of separating again."""
    job_store.mark_processing(cache_hash())

    response = post_song(client)

    assert response.json()["finishedTrackURL"] == job_store.poll_url(cache_hash())
    song_files.assert_not_called()


def test_request_after_a_failure_starts_a_fresh_job(client, no_bucket, song_files):
    """A failed job must not block later attempts at the same song."""
    job_store.mark_failed(cache_hash(), "boom")

    poll_url = post_song(client).json()["finishedTrackURL"]

    song_files.assert_called_once()
    assert client.get(poll_url).headers["content-type"] == "application/zip"


def test_request_after_a_dead_worker_starts_a_fresh_job(
    client, no_bucket, song_files, monkeypatch
):
    """An abandoned processing marker must not block later attempts either."""
    monkeypatch.setattr(settings, "LOCAL_JOB_STALE_AFTER_SECONDS", 60)
    job_store._write_status(
        cache_hash(), {"status": "processing", "startTime": int(time.time()) - 3600}
    )

    poll_url = post_song(client).json()["finishedTrackURL"]

    song_files.assert_called_once()
    assert client.get(poll_url).headers["content-type"] == "application/zip"


def test_expired_results_are_pruned(client, monkeypatch, local_job_dir):
    """Old results are deleted so the job directory does not grow without bound."""
    monkeypatch.setattr(settings, "LOCAL_JOB_RESULT_TTL_SECONDS", 60)
    stale = job_store.result_path("d" * 64)
    stale.write_bytes(b"old result")
    old = time.time() - 3600
    os.utime(stale, (old, old))

    job_store.prune_expired_results()

    assert not stale.exists()
