"""Tests for the sync routes, with the aligner that needs no model.

TestClient runs a background task before it returns the response, so a sync has
finished by the time the post comes back, unless the test holds the queue.
"""

import asyncio
import json
import wave
from io import BytesIO
from unittest import mock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.helpers import job_queue, job_store
from api.karaoke.aligners.fake import FakeAligner
from api.main import app

SAMPLE_RATE = 16000

REQUEST = {
    "segments": [
        {"text": "Went ", "endsLine": False, "sync": True},
        {"text": "out", "endsLine": True, "sync": False, "start": 2.0},
        {"text": "last ", "endsLine": False, "sync": True},
        {"text": "night", "endsLine": True, "sync": True},
    ]
}


def vocals_wav(seconds: float = 4.0) -> bytes:
    times = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    samples = (0.3 * np.sin(2 * np.pi * 220 * times) * 32767).astype(np.int16)
    out = BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(samples.tobytes())
    return out.getvalue()


VOCALS = vocals_wav()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("api.settings.ALIGNMENT_BACKEND", "in_process")
    monkeypatch.setattr("api.settings.ALIGNMENT_MODEL", "fake")
    return TestClient(app)


def post_sync(client, request=REQUEST, vocals=VOCALS):
    return client.post(
        "/align_track",
        data={"request": json.dumps(request)},
        files={"vocalsFile": ("vocals.wav", vocals, "audio/wav")},
    )


def test_a_sync_runs_and_its_result_is_polled(client):
    response = post_sync(client)
    assert response.status_code == 200
    url = response.json()["finishedTrackURL"]
    assert url.startswith("/alignment/")

    result = client.get(url)

    assert result.headers["content-type"] == "application/json"
    body = result.json()
    # A status always has one, so the poller tells a result by its absence.
    assert "status" not in body
    assert body["aligner"] == "fake@1"
    assert [bool(entry) for entry in body["segments"]] == [True, False, True, True]
    assert body["segments"][0]["start"] < 2.0 <= body["segments"][2]["start"]


def test_the_same_sync_is_served_from_its_result(client):
    first = post_sync(client).json()["finishedTrackURL"]

    with mock.patch.object(job_store.alignments, "mark_processing") as started:
        second = post_sync(client).json()["finishedTrackURL"]

    assert second == first
    started.assert_not_called()


def test_a_new_aligner_version_is_a_new_job(client):
    first = post_sync(client).json()["finishedTrackURL"]

    with mock.patch.object(FakeAligner, "version", "2"):
        second = post_sync(client).json()["finishedTrackURL"]

    assert second != first


def test_changed_anchors_are_a_new_job(client):
    moved = json.loads(json.dumps(REQUEST))
    moved["segments"][1]["start"] = 2.5

    assert (
        post_sync(client).json()["finishedTrackURL"]
        != post_sync(client, moved).json()["finishedTrackURL"]
    )


def test_a_lead_starts_the_synced_segments_earlier_in_a_job_of_its_own(client):
    plain = post_sync(client).json()["finishedTrackURL"]
    led = post_sync(client, {**REQUEST, "lead": 0.19}).json()["finishedTrackURL"]

    assert led != plain
    plain_start = client.get(plain).json()["segments"][3]["start"]
    led_start = client.get(led).json()["segments"][3]["start"]
    assert led_start == pytest.approx(plain_start - 0.19)


@pytest.mark.parametrize(
    "request_body",
    [
        "not json",
        json.dumps({"segments": []}),
        json.dumps({"segments": [{"text": "a", "endsLine": True}]}),
        json.dumps(
            {"segments": [{"text": "a", "endsLine": True, "sync": True, "x": 1}]}
        ),
        json.dumps(
            {"segments": [{"text": "a", "endsLine": True, "sync": False, "start": -1}]}
        ),
        json.dumps({**REQUEST, "lead": -0.1}),
        json.dumps({**REQUEST, "lead": 5}),
    ],
)
def test_a_malformed_request_is_refused(client, request_body):
    response = client.post(
        "/align_track",
        data={"request": request_body},
        files={"vocalsFile": ("vocals.wav", VOCALS, "audio/wav")},
    )

    assert response.status_code == 400


def test_a_request_with_nothing_to_sync_is_refused(client):
    kept = {"segments": [{"text": "a", "endsLine": True, "sync": False, "start": 1.0}]}

    response = post_sync(client, kept)

    assert response.status_code == 400
    assert response.json()["detail"] == "No segment is marked to sync."


def test_a_failed_sync_is_reported_to_the_poller(client):
    with mock.patch(
        "api.karaoke.alignment_backends.InProcessBackend.align",
        side_effect=RuntimeError("the vocals are silent"),
    ):
        url = post_sync(client).json()["finishedTrackURL"]

    status = client.get(url).json()

    assert status["status"] == job_store.STATUS_ERROR
    assert status["error"] == "the vocals are silent"


def test_an_unknown_sync_is_not_found(client):
    assert client.get("/alignment/" + "a" * 64).status_code == 404


def test_a_sync_waits_in_line_behind_a_separation(client, monkeypatch):
    """Both kinds share the queue, since they share the machine."""

    async def scenario():
        from api import main

        queue = job_queue.JobQueue(1)
        monkeypatch.setattr(main, "local_jobs", queue)
        cache_hash = "b" * 64
        run_id = job_store.alignments.mark_processing(cache_hash)

        async with queue.slot("a separation"):
            waiting = asyncio.create_task(
                main._queue_local_job(
                    job_store.alignments,
                    cache_hash,
                    run_id,
                    main.process_alignment_local,
                    VOCALS,
                    "vocals.wav",
                    REQUEST,
                )
            )
            await asyncio.sleep(0)
            queued = job_store.alignments.read_status(cache_hash)
            cancelled = await main.cancel_alignment(cache_hash)
            await waiting

        return queued, cancelled, job_store.alignments.read_status(cache_hash)

    queued, cancelled, final = asyncio.run(scenario())

    assert queued["songsAhead"] == 1
    assert cancelled == {"cancelled": True}
    assert final["status"] == job_store.STATUS_CANCELLED
    assert final["error"] == "Syncing was cancelled."


def test_syncing_off_refuses_a_sync(client, monkeypatch):
    monkeypatch.setattr("api.settings.ALIGNMENT_BACKEND", "none")

    assert post_sync(client).status_code == 404


def test_a_restart_fails_the_syncs_it_interrupted():
    job_store.alignments.mark_processing("c" * 64)
    job_store.alignments.store_result("d" * 64, _result_file())

    job_store.fail_interrupted_jobs()

    status = job_store.alignments.read_status("c" * 64)
    assert status["status"] == job_store.STATUS_ERROR
    assert status["error"] == "Syncing was interrupted by a server restart."
    # A result is JSON too, and must not be read as a job.
    assert job_store.alignments.result_path("d" * 64).exists()


def _result_file():
    path = job_store.alignments.job_dir() / "upload.json"
    path.write_text(json.dumps({"aligner": "fake@1", "segments": [{}]}))
    return path


@pytest.mark.parametrize(
    ("backend", "available"), [("in_process", True), ("none", False)]
)
def test_the_frontend_can_ask_whether_syncing_is_available(
    client, monkeypatch, backend, available
):
    monkeypatch.setattr("api.settings.ALIGNMENT_BACKEND", backend)

    assert client.get("/alignment/available").json() == {"available": available}
