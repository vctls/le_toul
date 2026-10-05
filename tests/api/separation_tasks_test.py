"""Tests for the separation job protocol and the runner that serves it locally.

The backends here stand in for a real separation. One copies the song to both
stems at once, and one holds its task open until the test lets it go, so each
stage a client can observe is reachable on demand.
"""

import json
import threading
import time
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import separation_tasks
from api.karaoke.separation_backends import PassthroughBackend
from api.separation_tasks import LocalTaskRunner, create_router

SONG = b"song bytes"
MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"


class HeldBackend:
    """Reports once, then waits for release before reporting again and finishing."""

    name = "held"

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        self.calls += 1
        on_progress(0.25, "separating the vocals")
        self.started.set()
        self.release.wait(5)
        on_progress(0.5, "separating the vocals")
        return PassthroughBackend().separate(songfile, song_dir, model_name)


class FailingBackend:
    name = "failing"

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        raise RuntimeError("CUDA out of memory")


def client_for(backend) -> TestClient:
    app = FastAPI()
    app.include_router(create_router(LocalTaskRunner(backend)))
    return TestClient(app)


def submit(client, model_name=MODEL_NAME, headers=None):
    return client.post(
        "/tasks",
        data={"modelName": model_name},
        files={"songFile": ("song.mp3", SONG, "audio/mpeg")},
        headers=headers,
    )


def wait_for(client, task_id, states=("done", "error", "cancelled")):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        status = client.get(f"/tasks/{task_id}").json()
        if status["status"] in states:
            return status
        time.sleep(0.01)
    raise AssertionError(f"Task {task_id} never reached {states}")


def test_a_task_runs_to_done_and_serves_its_stems():
    client = client_for(PassthroughBackend())

    response = submit(client)
    assert response.status_code == 202
    task_id = response.json()["task_id"]

    status = wait_for(client, task_id)
    assert status["status"] == "done"
    assert status["progress"] == 1.0
    assert set(status["files"]) == {"accompaniment", "vocals"}

    for name in status["files"].values():
        download = client.get(f"/tasks/{task_id}/files/{name}")
        assert download.status_code == 200
        assert download.content == SONG


def test_a_running_task_reports_its_progress():
    backend = HeldBackend()
    client = client_for(backend)
    task_id = submit(client).json()["task_id"]
    assert backend.started.wait(5)

    status = client.get(f"/tasks/{task_id}").json()

    assert status == {
        "status": "running",
        "progress": 0.25,
        "stage": "separating the vocals",
        "files": {},
        "error": None,
    }
    backend.release.set()


def test_a_second_task_queues_behind_the_first():
    backend = HeldBackend()
    client = client_for(backend)
    submit(client)
    assert backend.started.wait(5)

    second = submit(client).json()["task_id"]

    assert client.get(f"/tasks/{second}").json()["status"] == "queued"
    backend.release.set()
    assert wait_for(client, second)["status"] == "done"


def test_a_failed_task_reports_the_error():
    client = client_for(FailingBackend())
    task_id = submit(client).json()["task_id"]

    status = wait_for(client, task_id)

    assert status["status"] == "error"
    assert status["error"] == "CUDA out of memory"


def test_cancelling_a_running_task_stops_it_at_its_next_report():
    backend = HeldBackend()
    client = client_for(backend)
    task_id = submit(client).json()["task_id"]
    assert backend.started.wait(5)

    response = client.post(f"/tasks/{task_id}/cancel")
    backend.release.set()

    assert response.json() == {"cancelled": True}
    assert client.get(f"/tasks/{task_id}").json()["status"] == "cancelled"
    # The stems a cancelled run might still write are never offered.
    time.sleep(0.05)
    status = client.get(f"/tasks/{task_id}").json()
    assert status["status"] == "cancelled"
    assert status["files"] == {}


def test_cancelling_a_queued_task_keeps_it_from_starting():
    backend = HeldBackend()
    client = client_for(backend)
    first = submit(client).json()["task_id"]
    assert backend.started.wait(5)
    second = submit(client).json()["task_id"]

    client.post(f"/tasks/{second}/cancel")
    backend.release.set()
    wait_for(client, first)
    time.sleep(0.05)

    assert backend.calls == 1
    assert client.get(f"/tasks/{second}").json()["status"] == "cancelled"


def test_a_finished_task_cannot_be_cancelled():
    client = client_for(PassthroughBackend())
    task_id = submit(client).json()["task_id"]
    wait_for(client, task_id)

    response = client.post(f"/tasks/{task_id}/cancel")

    assert response.json() == {"cancelled": False}
    assert client.get(f"/tasks/{task_id}").json()["status"] == "done"


def test_an_unknown_model_is_rejected_before_the_upload_is_kept():
    client = client_for(PassthroughBackend())

    response = submit(client, model_name="nope.onnx")

    assert response.status_code == 400
    assert "nope.onnx" in response.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/tasks/missing"),
        ("get", "/tasks/missing/files/vocals.wav"),
        ("post", "/tasks/missing/cancel"),
    ],
)
def test_an_unknown_task_is_a_404(method, path):
    client = client_for(PassthroughBackend())

    assert getattr(client, method)(path).status_code == 404


@pytest.mark.parametrize("name", ["song.mp3", "..%2Fsong.mp3", "other.wav"])
def test_only_the_named_stems_can_be_downloaded(name):
    client = client_for(PassthroughBackend())
    task_id = submit(client).json()["task_id"]
    wait_for(client, task_id)

    assert client.get(f"/tasks/{task_id}/files/{name}").status_code == 404


def test_finished_tasks_are_pruned_once_their_time_is_up():
    client = client_for(PassthroughBackend())
    task_id = submit(client).json()["task_id"]
    wait_for(client, task_id)

    with mock.patch.object(separation_tasks, "TASK_TTL_SECONDS", -1):
        submit(client)

    assert client.get(f"/tasks/{task_id}").status_code == 404


def test_the_uploaded_song_is_deleted_after_the_separation():
    runner = LocalTaskRunner(PassthroughBackend())
    app = FastAPI()
    app.include_router(create_router(runner))
    client = TestClient(app)
    task_id = submit(client).json()["task_id"]
    files = wait_for(client, task_id)["files"]

    directory = runner._tasks[task_id].directory

    assert sorted(p.name for p in directory.iterdir()) == sorted(files.values())


class TestCredentials:
    @pytest.fixture(autouse=True)
    def credentials(self):
        with (
            mock.patch("api.settings.SEPARATOR_SERVER_KEY", "wk-id"),
            mock.patch("api.settings.SEPARATOR_SERVER_SECRET", "ws-secret"),
        ):
            yield

    def test_a_request_without_them_is_refused(self):
        client = client_for(PassthroughBackend())

        assert submit(client).status_code == 401

    def test_a_request_with_a_wrong_secret_is_refused(self):
        client = client_for(PassthroughBackend())
        headers = {"Modal-Key": "wk-id", "Modal-Secret": "wrong"}

        assert submit(client, headers=headers).status_code == 401

    def test_a_request_with_them_is_let_through(self):
        client = client_for(PassthroughBackend())
        headers = {"Modal-Key": "wk-id", "Modal-Secret": "ws-secret"}

        task_id = submit(client, headers=headers).json()["task_id"]

        assert client.get(f"/tasks/{task_id}", headers=headers).status_code == 200
        assert client.get(f"/tasks/{task_id}").status_code == 401


def test_a_key_without_a_secret_is_a_configuration_error():
    with (
        mock.patch("api.settings.SEPARATOR_SERVER_KEY", "wk-id"),
        mock.patch("api.settings.SEPARATOR_SERVER_SECRET", ""),
        pytest.raises(ValueError, match="must be set together"),
    ):
        create_router(LocalTaskRunner(PassthroughBackend()))


def test_the_separator_server_serves_the_job_protocol():
    from api.separator_server import app

    client = TestClient(app)
    paths = {route.path for route in app.routes}

    assert client.get("/health").status_code == 200
    assert {"/tasks", "/tasks/{task_id}"} <= paths


SYNC_REQUEST = {
    "segments": [
        {"text": "Went ", "endsLine": False, "sync": True},
        {"text": "out", "endsLine": True, "sync": True},
    ]
}


class FakeAlignmentBackend:
    """Times every segment at a second, as a stand-in for a real sync."""

    name = "fake"

    def align(self, vocals, request, work_dir, on_progress=None):
        segments = [{"start": 1.0, "doubtful": False} for _ in request["segments"]]
        return {"aligner": "fake@1", "segments": segments}


def submit_sync(client, request=SYNC_REQUEST):
    return client.post(
        "/tasks",
        data={"kind": "align", "request": json.dumps(request)},
        files={"vocalsFile": ("vocals.wav", b"vocals", "audio/wav")},
    )


def sync_client() -> TestClient:
    app = FastAPI()
    runner = LocalTaskRunner(PassthroughBackend(), FakeAlignmentBackend())
    app.include_router(create_router(runner))
    return TestClient(app)


def test_a_sync_task_runs_to_done_and_serves_its_result():
    client = sync_client()

    response = submit_sync(client)
    assert response.status_code == 202
    status = wait_for(client, response.json()["task_id"])

    assert status["status"] == "done"
    assert status["files"] == {"alignment": "alignment.json"}
    result = client.get(f"/tasks/{response.json()['task_id']}/files/alignment.json")
    assert result.json()["segments"] == [{"start": 1.0, "doubtful": False}] * 2


@pytest.mark.parametrize(
    "data",
    [
        {"kind": "align"},
        {"kind": "align", "request": "not json"},
        {"kind": "align", "request": json.dumps({"segments": [{"text": "a"}]})},
    ],
)
def test_a_malformed_sync_is_refused(data):
    response = sync_client().post(
        "/tasks",
        data=data,
        files={"vocalsFile": ("vocals.wav", b"vocals", "audio/wav")},
    )

    assert response.status_code == 400


def test_a_host_without_the_aligners_dependencies_refuses_a_sync(monkeypatch):
    monkeypatch.setattr(
        "api.separation_tasks.aligners.missing_dependencies", lambda name: ["torch"]
    )

    response = submit_sync(sync_client())

    assert response.status_code == 400
    assert response.json()["detail"] == "This host can't sync without torch."


def test_a_host_whose_runner_cannot_sync_refuses_a_sync():
    class SeparatingOnly:
        def submit(self, song, filename, model_name):
            raise AssertionError("A sync must not reach the separation")

    app = FastAPI()
    app.include_router(create_router(SeparatingOnly()))

    response = submit_sync(TestClient(app))

    assert response.status_code == 400
    assert response.json()["detail"] == "This host doesn't sync."
