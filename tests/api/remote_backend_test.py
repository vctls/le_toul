"""Tests for the remote backend, the client half of the /tasks job protocol.

Most run the backend against the real router in api/separation_tasks.py, so a
change on either side of the protocol that the other does not follow fails
here. A scripted transport covers what a real server cannot be made to do on
demand: stay queued, lose a task, or stop answering.
"""

import json
import threading
from pathlib import Path
from unittest import mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.helpers.job_store import JobCancelled
from api.karaoke import separation_backends, separation_progress
from api.karaoke.separation_backends import (
    PassthroughBackend,
    RemoteBackend,
    _remote_client,
    get_backend,
)
from api.separation_tasks import LocalTaskRunner, create_router

MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"
SONG = b"song bytes"


@pytest.fixture(autouse=True)
def no_poll_wait():
    with mock.patch.object(separation_backends, "REMOTE_POLL_INTERVAL_SECONDS", 0):
        yield


@pytest.fixture
def song(tmp_path: Path) -> Path:
    songfile = tmp_path / "song.mp3"
    songfile.write_bytes(SONG)
    return songfile


@pytest.fixture
def song_dir(tmp_path: Path) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    return out


def server(backend) -> tuple[TestClient, LocalTaskRunner]:
    runner = LocalTaskRunner(backend)
    app = FastAPI()
    app.include_router(create_router(runner))
    return TestClient(app), runner


class HeldBackend:
    """Reports once, then waits for release before reporting again and finishing."""

    name = "held"

    def __init__(self):
        self.release = threading.Event()

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        on_progress(0.25, separation_progress.SEPARATING_STAGE)
        self.release.wait(5)
        on_progress(0.5, separation_progress.SEPARATING_STAGE)
        return PassthroughBackend().separate(songfile, song_dir, model_name)


class FailingBackend:
    name = "failing"

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        raise RuntimeError("CUDA out of memory")


def scripted(statuses: list, files: dict[str, bytes] | None = None) -> httpx.Client:
    """A client whose server answers each poll with the next of `statuses`.

    An exception in the list is raised instead of answering.
    """
    polls = iter(statuses)

    def handle(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path == "/tasks":
            return httpx.Response(202, json={"task_id": "t1"})
        if request.method == "POST" and path == "/tasks/t1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        if path.startswith("/tasks/t1/files/"):
            return httpx.Response(200, content=(files or {})[path.rsplit("/", 1)[1]])
        answer = next(polls)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, httpx.Response):
            return answer
        return httpx.Response(200, json=answer)

    return httpx.Client(
        base_url="http://separator", transport=httpx.MockTransport(handle)
    )


def status(state, progress=None, stage=None, files=None, error=None) -> dict:
    return {
        "status": state,
        "progress": progress,
        "stage": stage,
        "files": files or {},
        "error": error,
    }


def test_it_separates_through_the_protocol(song, song_dir):
    client, _ = server(PassthroughBackend())
    stages = []

    result = RemoteBackend(client).separate(
        song, song_dir, MODEL_NAME, lambda progress, stage: stages.append(stage)
    )

    assert result.accompaniment.parent == song_dir
    assert result.accompaniment.read_bytes() == SONG
    assert result.vocals.read_bytes() == SONG
    assert stages[0] == separation_progress.UPLOADING_STAGE
    assert stages[-1] == separation_progress.DOWNLOADING_STEMS_STAGE


def test_it_reports_a_queued_task_as_waiting_for_a_gpu(song, song_dir):
    files = {"accompaniment": "a.flac", "vocals": "v.flac"}
    client = scripted(
        [
            status("queued"),
            status("running", 0.4, separation_progress.SEPARATING_STAGE),
            status("done", 1.0, files=files),
        ],
        {"a.flac": b"accompaniment", "v.flac": b"vocals"},
    )
    reports = []

    result = RemoteBackend(client).separate(
        song, song_dir, MODEL_NAME, lambda *report: reports.append(report)
    )

    assert reports == [
        (None, separation_progress.UPLOADING_STAGE),
        (None, separation_progress.WAITING_FOR_GPU_STAGE),
        (0.4, separation_progress.SEPARATING_STAGE),
        (None, separation_progress.DOWNLOADING_STEMS_STAGE),
    ]
    assert result.accompaniment == song_dir / "a.flac"
    assert result.vocals.read_bytes() == b"vocals"


def test_it_raises_the_error_the_server_recorded(song, song_dir):
    client, _ = server(FailingBackend())

    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME)


def test_a_cancelled_job_cancels_the_remote_task_too(song, song_dir):
    held = HeldBackend()
    client, runner = server(held)

    def cancel_once_running(progress, stage):
        if progress is not None:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME, cancel_once_running)
    held.release.set()

    [task_id] = runner._tasks
    assert client.get(f"/tasks/{task_id}").json()["status"] == "cancelled"


def test_a_rejected_credential_names_the_settings_to_check(song, song_dir):
    with (
        mock.patch("api.settings.SEPARATOR_SERVER_KEY", "wk-id"),
        mock.patch("api.settings.SEPARATOR_SERVER_SECRET", "ws-secret"),
    ):
        client, _ = server(PassthroughBackend())

        with pytest.raises(RuntimeError, match="SEPARATION_REMOTE_KEY"):
            RemoteBackend(client).separate(song, song_dir, MODEL_NAME)


def test_the_configured_credentials_are_sent():
    with (
        mock.patch("api.settings.SEPARATION_REMOTE_URL", "http://separator:8001"),
        mock.patch("api.settings.SEPARATION_REMOTE_KEY", "wk-id"),
        mock.patch("api.settings.SEPARATION_REMOTE_SECRET", "ws-secret"),
    ):
        client = _remote_client()

    assert str(client.base_url) == "http://separator:8001"
    assert client.headers["Modal-Key"] == "wk-id"
    assert client.headers["Modal-Secret"] == "ws-secret"


def test_no_credentials_are_sent_when_none_are_configured():
    with mock.patch("api.settings.SEPARATION_REMOTE_URL", "http://separator:8001"):
        client = _remote_client()

    assert "Modal-Key" not in client.headers


def test_a_task_the_server_lost_fails_the_job(song, song_dir):
    client = scripted([status("running"), httpx.Response(404, json={})])

    with pytest.raises(RuntimeError, match="no longer knows this task"):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME)


def test_a_few_failed_polls_are_waited_out(song, song_dir):
    files = {"accompaniment": "a.flac", "vocals": "v.flac"}
    client = scripted(
        [
            httpx.ConnectError("refused"),
            httpx.ReadTimeout("slow"),
            status("done", 1.0, files=files),
        ],
        {"a.flac": b"a", "v.flac": b"v"},
    )

    result = RemoteBackend(client).separate(song, song_dir, MODEL_NAME)

    assert result.vocals.read_bytes() == b"v"


def test_a_run_of_failed_polls_fails_the_job(song, song_dir):
    client = scripted([httpx.ConnectError("refused")] * 3)

    with (
        mock.patch.object(RemoteBackend, "MAX_CONSECUTIVE_POLL_FAILURES", 3),
        pytest.raises(RuntimeError, match="stopped answering: refused"),
    ):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME)


def test_a_server_error_carries_its_detail(song, song_dir):
    client = scripted([httpx.Response(500, json={"detail": "disk full"})])

    with pytest.raises(RuntimeError, match="answered 500: disk full"):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME)


def test_a_file_name_cannot_escape_the_song_directory(song, song_dir):
    files = {"accompaniment": "../a.flac", "vocals": "v.flac"}
    client = scripted(
        [status("done", 1.0, files=files)], {"a.flac": b"a", "v.flac": b"v"}
    )

    result = RemoteBackend(client).separate(song, song_dir, MODEL_NAME)

    assert result.accompaniment == song_dir / "a.flac"


class TestSelection:
    def test_it_requires_a_url(self):
        with (
            mock.patch("api.settings.SEPARATION_REMOTE_URL", ""),
            pytest.raises(ValueError, match="requires SEPARATION_REMOTE_URL"),
        ):
            get_backend(RemoteBackend.name)

    def test_a_key_without_a_secret_is_refused(self):
        with (
            mock.patch("api.settings.SEPARATION_REMOTE_URL", "http://separator"),
            mock.patch("api.settings.SEPARATION_REMOTE_KEY", "wk-id"),
            mock.patch("api.settings.SEPARATION_REMOTE_SECRET", ""),
            pytest.raises(ValueError, match="to be set together"),
        ):
            get_backend(RemoteBackend.name)

    def test_it_resolves_when_configured(self):
        with mock.patch("api.settings.SEPARATION_REMOTE_URL", "http://separator"):
            assert isinstance(get_backend(RemoteBackend.name), RemoteBackend)


def test_separate_track_refuses_an_unknown_model():
    from api.main import app

    response = TestClient(app).post(
        "/separate_track",
        data={"modelName": "nope.onnx"},
        files={"songFile": ("song.mp3", SONG, "audio/mpeg")},
    )

    assert response.status_code == 400
    assert (
        json.loads(response.content)["detail"] == "Unknown separation model nope.onnx"
    )


def test_an_unreachable_service_is_named_in_the_error(song, song_dir):
    def refuse(request):
        raise httpx.ConnectError("Name or service not known")

    client = httpx.Client(
        base_url="http://separator:8001", transport=httpx.MockTransport(refuse)
    )

    with pytest.raises(RuntimeError, match="separator:8001 is unreachable"):
        RemoteBackend(client).separate(song, song_dir, MODEL_NAME)
