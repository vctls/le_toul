"""Tests for jobs that survive a restart of the web tier.

A job whose separation runs on a remote host records the remote task's ID.
After a restart, the master spares that job instead of failing it, and the
worker follows the task again from where the previous server left it. The
remote host here is the real /tasks router, so the whole path is exercised.
"""

import importlib.util
import io
import os
import threading
import time
import zipfile
from pathlib import Path
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import main
from api.helpers import job_store
from api.karaoke import separation_backends, separation_progress
from api.karaoke.separation_backends import (
    PassthroughBackend,
    RemoteBackend,
    is_resumable,
)
from api.separation_tasks import LocalTaskRunner, create_router

HASH = "a" * 64
MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"
SONG = b"song bytes"


class HeldBackend:
    """Reports once, then waits for release before reporting again and finishing."""

    name = "held"

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        on_progress(0.25, separation_progress.SEPARATING_STAGE)
        self.started.set()
        self.release.wait(5)
        on_progress(0.5, separation_progress.SEPARATING_STAGE)
        return PassthroughBackend().separate(songfile, song_dir, model_name)


@pytest.fixture(autouse=True)
def no_poll_wait():
    with mock.patch.object(separation_backends, "REMOTE_POLL_INTERVAL_SECONDS", 0):
        yield


def remote_host(backend) -> tuple[TestClient, LocalTaskRunner]:
    runner = LocalTaskRunner(backend)
    app = FastAPI()
    app.include_router(create_router(runner))
    return TestClient(app), runner


def submit(host: TestClient) -> str:
    response = host.post(
        "/tasks",
        data={"modelName": MODEL_NAME},
        files={"songFile": ("song.mp3", SONG, "audio/mpeg")},
    )
    return response.json()["task_id"]


def job_waiting_on(task_id: str) -> str:
    run_id = job_store.mark_processing(HASH)
    job_store.mark_submitted(HASH, run_id, task_id)
    return run_id


def restart(host: TestClient):
    """Run the master's startup sweep, then start the app as a fresh worker would."""
    spec = importlib.util.spec_from_file_location(
        "gunicorn_conf", Path(__file__).parents[2] / "gunicorn.conf.py"
    )
    gunicorn_conf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gunicorn_conf)
    gunicorn_conf.on_starting(mock.Mock())
    return mock.patch.object(
        separation_backends, "get_backend", return_value=RemoteBackend(host)
    )


def wait_for_outcome(client: TestClient) -> tuple[str, bytes | dict]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(job_store.poll_url(HASH))
        if response.headers["content-type"] == "application/zip":
            return "zip", response.content
        body = response.json()
        if body["status"] != job_store.STATUS_PROCESSING:
            return body["status"], body
        time.sleep(0.01)
    raise AssertionError("The job never ended")


@pytest.fixture
def remote_settings():
    with (
        mock.patch("api.settings.SEPARATION_BACKEND", "remote"),
        mock.patch("api.settings.SEPARATION_REMOTE_URL", "http://separator"),
        mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""),
    ):
        yield


def test_a_job_waiting_on_a_remote_task_is_followed_after_a_restart(remote_settings):
    host, _ = remote_host(PassthroughBackend())
    job_waiting_on(submit(host))

    with restart(host), TestClient(main.app) as client:
        outcome, content = wait_for_outcome(client)

    assert outcome == "zip"
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert {archive.read(name) for name in archive.namelist()} == {SONG}


def test_a_job_resumed_mid_separation_reports_its_progress(remote_settings):
    held = HeldBackend()
    host, _ = remote_host(held)
    job_waiting_on(submit(host))
    assert held.started.wait(5)

    with restart(host), TestClient(main.app) as client:
        deadline = time.monotonic() + 5
        while job_store.read_status(HASH).get("progress") != 0.25:
            assert time.monotonic() < deadline
            time.sleep(0.01)
        held.release.set()
        outcome, _ = wait_for_outcome(client)

    assert outcome == "zip"


def test_a_cancel_left_pending_by_the_restart_calls_off_the_remote_task(
    remote_settings,
):
    held = HeldBackend()
    host, _ = remote_host(held)
    task_id = submit(host)
    job_waiting_on(task_id)
    assert held.started.wait(5)
    job_store.request_cancel(HASH)

    with restart(host), TestClient(main.app) as client:
        outcome, _ = wait_for_outcome(client)
    held.release.set()

    assert outcome == job_store.STATUS_CANCELLED
    assert host.get(f"/tasks/{task_id}").json()["status"] == "cancelled"


def test_a_task_the_remote_host_lost_fails_the_job(remote_settings):
    host, _ = remote_host(PassthroughBackend())
    job_waiting_on("forgotten")

    with restart(host), TestClient(main.app) as client:
        outcome, body = wait_for_outcome(client)

    assert outcome == job_store.STATUS_ERROR
    assert "no longer knows this task" in body["error"]


def test_the_worker_that_resumes_a_job_becomes_its_owner(remote_settings):
    host, _ = remote_host(PassthroughBackend())
    run_id = job_waiting_on(submit(host))
    job_store._write_status(HASH, {**job_store.read_status(HASH), "pid": 1})

    job_store.adopt(HASH, run_id)

    assert job_store.read_status(HASH)["pid"] == os.getpid()


def test_a_backend_that_cannot_follow_a_task_fails_the_job_at_restart():
    job_waiting_on("t1")

    with mock.patch("api.settings.SEPARATION_BACKEND", "subprocess"):
        restart(mock.Mock())

    assert job_store.read_status(HASH)["error"] == job_store.INTERRUPTED_MESSAGE


def test_a_job_without_a_remote_task_is_still_failed_at_restart(remote_settings):
    job_store.mark_processing(HASH)

    restart(mock.Mock())

    assert job_store.read_status(HASH)["error"] == job_store.INTERRUPTED_MESSAGE


def test_only_the_current_run_records_its_task():
    superseded = job_store.mark_processing(HASH)
    job_store.mark_processing(HASH)

    job_store.mark_submitted(HASH, superseded, "t1")

    assert "taskId" not in job_store.read_status(HASH)
    assert job_store.remote_jobs() == []


def test_the_remote_backend_hands_over_its_task_id(tmp_path):
    host, runner = remote_host(PassthroughBackend())
    songfile = tmp_path / "song.mp3"
    songfile.write_bytes(SONG)
    submitted = []

    RemoteBackend(host).separate(
        songfile, tmp_path, MODEL_NAME, on_submitted=submitted.append
    )

    assert submitted == list(runner._tasks)


def test_only_the_remote_backend_can_resume():
    assert is_resumable("remote")
    assert not is_resumable("subprocess")
    assert not is_resumable("in_process")
    assert not is_resumable("nope")


def test_an_exited_worker_leaves_its_remote_jobs_to_its_replacement(remote_settings):
    job_waiting_on("t1")
    local = "b" * 64
    job_store.mark_processing(local)
    spec = importlib.util.spec_from_file_location(
        "gunicorn_conf", Path(__file__).parents[2] / "gunicorn.conf.py"
    )
    gunicorn_conf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gunicorn_conf)

    gunicorn_conf.child_exit(mock.Mock(), mock.Mock(pid=os.getpid()))

    assert job_store.read_status(HASH)["status"] == job_store.STATUS_PROCESSING
    assert job_store.read_status(local)["error"] == job_store.WORKER_EXITED_MESSAGE
