"""Tests for the local (no GCS bucket) separation job flow.

The client is handed a poll URL immediately and the separation runs in a
background task, so these cover what the client sees at each stage of a job.
"""

import asyncio
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
from api.helpers import cloud_storage, job_store, separation_queue
from api.karaoke.music_separation import SeparationResult
from api.main import app

SONG_CONTENT = b"test audio content"
MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"
OTHER_MODEL_NAME = "UVR-MDX-NET-Inst_HQ_3.onnx"


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

        with (
            mock.patch(
                "api.karaoke.music_separation.split_song",
                return_value=SeparationResult(
                    accompaniment=accomp_path, vocals=vocal_path
                ),
            ) as mock_split_song,
            mock.patch("api.helpers.zip_helper.create_zip_file", return_value=zip_path),
        ):
            yield mock_split_song


def post_song(client, model_name=MODEL_NAME):
    return client.post(
        "/separate_track",
        data={"modelName": model_name},
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


def test_running_job_reports_its_progress(client):
    """A job in flight reports how far along it is, for the client's bar."""
    job_store.mark_processing("e" * 64)
    job_store.mark_progress("e" * 64, 0.42, "separating the vocals")

    body = client.get(f"/separated_track/{'e' * 64}").json()

    assert body["progress"] == 0.42
    assert body["stage"] == "separating the vocals"


def test_unmeasurable_stage_is_reported_without_a_figure(client):
    """Loading the model has no progress to read, but the client can name it."""
    job_store.mark_processing("1" * 64)
    job_store.mark_progress("1" * 64, None, "loading the separation model")

    body = client.get(f"/separated_track/{'1' * 64}").json()

    assert body["stage"] == "loading the separation model"
    assert "progress" not in body


def test_unmeasurable_stage_keeps_the_last_figure(client):
    """The bar must not fall back to indeterminate once it has a figure."""
    job_store.mark_processing("2" * 64)
    job_store.mark_progress("2" * 64, 0.05, "downloading the separation model")
    job_store.mark_progress("2" * 64, None, "reading the song")

    body = client.get(f"/separated_track/{'2' * 64}").json()

    assert body["stage"] == "reading the song"
    assert body["progress"] == 0.05


def test_progress_does_not_revive_a_finished_job(client):
    """A report arriving after a failure must not reopen the job."""
    job_store.mark_failed("f" * 64, "boom")
    job_store.mark_progress("f" * 64, 0.9, "separating the vocals")

    body = client.get(f"/separated_track/{'f' * 64}").json()

    assert body["status"] == "error"


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


def test_another_model_gets_its_own_result(client, no_bucket, song_files):
    """The cache is keyed by model, so the same song can be tried against another one."""
    first = post_song(client).json()["finishedTrackURL"]

    second = post_song(client, model_name=OTHER_MODEL_NAME).json()["finishedTrackURL"]

    assert second != first
    assert song_files.call_count == 2
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


def test_cancelled_job_stops_and_reports_cancelled(client, no_bucket, song_files):
    """A cancelled job unwinds at its next progress report."""

    def cancel_then_report(*args, on_progress=None, **kwargs):
        job_store.request_cancel(cache_hash())
        on_progress(0.5, "separating the vocals")
        raise AssertionError("the separation should have been called off")

    song_files.side_effect = cancel_then_report

    poll_url = post_song(client).json()["finishedTrackURL"]

    assert client.get(poll_url).json()["status"] == "cancelled"


def test_cancel_asks_a_running_job_to_stop(client):
    """The job keeps its processing status until its worker notices."""
    job_store.mark_processing("9" * 64)

    response = client.post(f"/separated_track/{'9' * 64}/cancel")

    assert response.json() == {"cancelled": True}
    assert client.get(f"/separated_track/{'9' * 64}").json()["status"] == "processing"


def test_cancelling_a_job_that_is_not_running_is_harmless(client):
    """Nothing to call off is reported rather than treated as an error."""
    response = client.post(f"/separated_track/{'d' * 64}/cancel")

    assert response.status_code == 200
    assert response.json() == {"cancelled": False}


def test_superseded_run_cannot_record_its_outcome(client):
    """A worker still running past a cancel must not bury the run that replaced it."""
    superseded = job_store.mark_processing(cache_hash())
    current = job_store.mark_processing(cache_hash())

    job_store.mark_cancelled(cache_hash(), superseded)

    status = job_store.read_status(cache_hash())
    assert status["status"] == "processing"
    assert status["runId"] == current


def test_request_after_a_cancel_starts_a_fresh_job(client, no_bucket, song_files):
    """A cancelled song can be separated again."""
    job_store.mark_processing(cache_hash())
    client.post(f"/separated_track/{cache_hash()}/cancel")
    job_store.mark_cancelled(cache_hash(), job_store.read_status(cache_hash())["runId"])

    poll_url = post_song(client).json()["finishedTrackURL"]

    song_files.assert_called_once()
    assert client.get(poll_url).headers["content-type"] == "application/zip"


def test_queued_job_reports_the_songs_ahead(client):
    """A job waiting for a free slot tells the client where it stands."""
    run_id = job_store.mark_processing("3" * 64)
    job_store.mark_queued("3" * 64, run_id, 2)

    body = client.get(f"/separated_track/{'3' * 64}").json()

    assert body["status"] == "processing"
    assert body["songsAhead"] == 2
    assert body["stage"] == "waiting in line, 2 songs ahead"


def test_long_wait_in_line_is_not_mistaken_for_a_dead_worker(client, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_JOB_STALE_AFTER_SECONDS", 60)
    run_id = job_store.mark_processing("4" * 64)
    job_store.mark_queued("4" * 64, run_id, 1)
    status = job_store.read_status("4" * 64)
    job_store._write_status("4" * 64, {**status, "startTime": int(time.time()) - 3600})

    assert client.get(f"/separated_track/{'4' * 64}").json()["status"] == "processing"


def test_leaving_the_line_restarts_the_clock(client):
    """Staleness counts from the start of the separation, not the wait before it."""
    run_id = job_store.mark_processing("5" * 64)
    job_store.mark_queued("5" * 64, run_id, 1)
    status = job_store.read_status("5" * 64)
    job_store._write_status("5" * 64, {**status, "startTime": 0})

    assert job_store.mark_started("5" * 64, run_id)

    status = job_store.read_status("5" * 64)
    assert "songsAhead" not in status
    assert "stage" not in status
    assert status["startTime"] > 0


def test_superseded_run_does_not_start(client):
    superseded = job_store.mark_processing("6" * 64)
    job_store.mark_processing("6" * 64)

    assert not job_store.mark_started("6" * 64, superseded)


def test_cancelling_a_queued_job_takes_it_out_of_line(client, monkeypatch):
    """A song cancelled before its turn is recorded as cancelled at once."""

    async def scenario():
        from api import main

        queue = separation_queue.SeparationQueue(1)
        monkeypatch.setattr(main, "local_separations", queue)
        run_id = job_store.mark_processing(cache_hash())

        async with queue.slot("someone else"):
            waiting = asyncio.create_task(
                main.queue_track_separation_local(
                    cache_hash(), run_id, MODEL_NAME, SONG_CONTENT, "song.mp3"
                )
            )
            await asyncio.sleep(0)
            queued = job_store.read_status(cache_hash())
            await main.cancel_separated_track(cache_hash())
            await waiting

        return queued, job_store.read_status(cache_hash())

    queued, final = asyncio.run(scenario())

    assert queued["songsAhead"] == 1
    assert final["status"] == "cancelled"
