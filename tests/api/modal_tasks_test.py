"""Tests for the Modal runner, with fakes in place of Modal's Dict, Volume and GPU calls.

The fake files store is a directory, and the fake GPU calls only record what
they were asked. A test plays the GPU function by calling run_task itself, so
every point in a task's life is reachable without a thread.
"""

import io
import os
import shutil
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import modal_tasks
from api.karaoke.separation_backends import PassthroughBackend
from api.modal_tasks import ModalTaskRunner, prune_task_files, run_task
from api.separation_tasks import create_router

SONG = b"song bytes"
MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"


class DirectoryFiles:
    def __init__(self, root: Path):
        self.root = root
        self.downloads = 0

    def upload(self, source, path):
        destination = self.root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as out:
            shutil.copyfileobj(source, out)

    def download(self, path, destination):
        self.downloads += 1
        with (self.root / path).open("rb") as source:
            shutil.copyfileobj(source, destination)


class RecordedCalls:
    def __init__(self):
        self.spawned: list[tuple[str, str, str]] = []
        self.cancelled: list[str] = []
        self.failures: dict[str, str] = {}

    def spawn(self, task_id, song_name, model_name):
        self.spawned.append((task_id, song_name, model_name))
        return f"fc-{task_id}"

    def failure(self, call_id):
        return self.failures.get(call_id)

    def cancel(self, call_id):
        self.cancelled.append(call_id)


class ReportingBackend:
    """Reports each of its stages, then copies the song to both stems."""

    name = "reporting"

    def __init__(self, stages=("loading the model", "separating the vocals")):
        self.stages = stages

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        for i, stage in enumerate(self.stages):
            on_progress(i / len(self.stages), stage)
        return PassthroughBackend().separate(songfile, song_dir, model_name)


class FailingBackend:
    name = "failing"

    def separate(self, songfile, song_dir, model_name, on_progress=None):
        raise RuntimeError("CUDA out of memory")


@pytest.fixture
def records():
    return {}


@pytest.fixture
def files(tmp_path):
    root = tmp_path / "volume"
    root.mkdir()
    return DirectoryFiles(root)


@pytest.fixture
def calls():
    return RecordedCalls()


@pytest.fixture
def runner(records, files, calls, tmp_path):
    return ModalTaskRunner(records, files, calls, cache_dir=tmp_path / "cache")


@pytest.fixture
def client(runner):
    app = FastAPI()
    app.include_router(create_router(runner))
    return TestClient(app)


def submit(client) -> str:
    response = client.post(
        "/tasks",
        data={"modelName": MODEL_NAME},
        files={"songFile": ("song.mp3", SONG, "audio/mpeg")},
    )
    assert response.status_code == 202
    return response.json()["task_id"]


def play_gpu(records, files, calls, backend=None, commit=lambda: None):
    """Run the last spawned call the way the GPU function would."""
    task_id, song_name, model_name = calls.spawned[-1]
    run_task(
        records,
        task_id,
        files.root / task_id / song_name,
        model_name,
        backend or PassthroughBackend(),
        commit,
    )


def test_a_task_runs_to_done_and_serves_its_stems(client, records, files, calls):
    task_id = submit(client)
    assert client.get(f"/tasks/{task_id}").json()["status"] == "queued"
    assert calls.spawned == [(task_id, "song.mp3", MODEL_NAME)]
    assert (files.root / task_id / "song.mp3").read_bytes() == SONG

    play_gpu(records, files, calls)

    status = client.get(f"/tasks/{task_id}").json()
    assert status["status"] == "done"
    assert status["progress"] == 1.0
    for name in status["files"].values():
        download = client.get(f"/tasks/{task_id}/files/{name}")
        assert download.status_code == 200
        assert download.content == SONG
    assert not (files.root / task_id / "song.mp3").exists()


def test_the_stems_are_committed_before_the_task_is_done(records, files, calls, runner):
    task_id = runner.submit(io.BytesIO(SONG), "song.mp3", MODEL_NAME)
    seen_at_commit = []

    play_gpu(
        records,
        files,
        calls,
        commit=lambda: seen_at_commit.append(runner.status(task_id).status),
    )

    assert seen_at_commit == ["running"]
    assert runner.status(task_id).status == "done"


def test_a_stem_is_downloaded_from_the_store_once(client, records, files, calls):
    task_id = submit(client)
    play_gpu(records, files, calls)
    name = client.get(f"/tasks/{task_id}").json()["files"]["vocals"]

    client.get(f"/tasks/{task_id}/files/{name}")
    client.get(f"/tasks/{task_id}/files/{name}")

    assert files.downloads == 1


def test_only_the_stems_of_a_done_task_are_served(client, records, files, calls):
    task_id = submit(client)

    assert client.get(f"/tasks/{task_id}/files/song.mp3").status_code == 404
    play_gpu(records, files, calls)
    assert client.get(f"/tasks/{task_id}/files/song.mp3").status_code == 404


def test_progress_reaches_the_record(records, files, calls, runner):
    task_id = runner.submit(io.BytesIO(SONG), "song.mp3", MODEL_NAME)
    seen = []

    class Watching(ReportingBackend):
        def separate(self, songfile, song_dir, model_name, on_progress=None):
            def watch(progress, stage):
                on_progress(progress, stage)
                seen.append(runner.status(task_id).stage)

            return super().separate(songfile, song_dir, model_name, watch)

    play_gpu(records, files, calls, Watching())

    assert seen == ["loading the model", "separating the vocals"]


def test_reports_within_a_stage_are_written_at_most_once_an_interval(
    records, files, calls, runner, monkeypatch
):
    task_id = runner.submit(io.BytesIO(SONG), "song.mp3", MODEL_NAME)
    monkeypatch.setattr(modal_tasks, "REPORT_INTERVAL_SECONDS", 60)
    seen = []

    class Chatty:
        name = "chatty"

        def separate(self, songfile, song_dir, model_name, on_progress=None):
            for progress in (0.1, 0.2, 0.3):
                on_progress(progress, "separating the vocals")
                seen.append(runner.status(task_id).progress)
            return PassthroughBackend().separate(songfile, song_dir, model_name)

    play_gpu(records, files, calls, Chatty())

    assert seen == [0.1, 0.1, 0.1]


def test_a_failed_separation_records_its_error(client, records, files, calls):
    task_id = submit(client)

    play_gpu(records, files, calls, FailingBackend())

    status = client.get(f"/tasks/{task_id}").json()
    assert status["status"] == "error"
    assert status["error"] == "CUDA out of memory"


def test_a_call_that_died_without_recording_fails_its_task(client, calls):
    task_id = submit(client)
    calls.failures[f"fc-{task_id}"] = "The separation stopped without finishing"

    status = client.get(f"/tasks/{task_id}").json()

    assert status["status"] == "error"
    assert status["error"] == "The separation stopped without finishing"


def test_a_finished_task_does_not_ask_after_its_call(client, records, files, calls):
    task_id = submit(client)
    play_gpu(records, files, calls)
    calls.failures[f"fc-{task_id}"] = "The separation stopped without finishing"

    assert client.get(f"/tasks/{task_id}").json()["status"] == "done"


def test_cancelling_records_it_and_calls_off_the_gpu(client, calls):
    task_id = submit(client)

    response = client.post(f"/tasks/{task_id}/cancel")

    assert response.json() == {"cancelled": True}
    assert calls.cancelled == [f"fc-{task_id}"]
    assert client.get(f"/tasks/{task_id}").json()["status"] == "cancelled"


def test_a_task_cancelled_before_it_started_never_runs(client, records, files, calls):
    task_id = submit(client)
    client.post(f"/tasks/{task_id}/cancel")

    play_gpu(records, files, calls, FailingBackend())

    assert client.get(f"/tasks/{task_id}").json()["status"] == "cancelled"


def test_a_running_task_stops_at_its_next_report(records, files, calls, runner):
    task_id = runner.submit(io.BytesIO(SONG), "song.mp3", MODEL_NAME)
    reached = []

    class CancelledMidway:
        name = "cancelled-midway"

        def separate(self, songfile, song_dir, model_name, on_progress=None):
            on_progress(0.25, "separating the vocals")
            runner.cancel(task_id)
            on_progress(0.5, "reading the stems")
            reached.append("the end")

    play_gpu(records, files, calls, CancelledMidway())

    assert reached == []
    assert runner.status(task_id).status == "cancelled"


def test_a_finished_task_cannot_be_cancelled(client, records, files, calls):
    task_id = submit(client)
    play_gpu(records, files, calls)

    assert client.post(f"/tasks/{task_id}/cancel").json() == {"cancelled": False}
    assert calls.cancelled == []


def test_an_unknown_task_is_a_404(client):
    assert client.get("/tasks/nope").status_code == 404
    assert client.post("/tasks/nope/cancel").status_code == 404


def test_pruning_deletes_only_the_old_task_directories(tmp_path):
    old, recent = tmp_path / "old", tmp_path / "recent"
    for directory in (old, recent):
        directory.mkdir()
        (directory / "vocals.flac").write_bytes(SONG)
    day_ago = time.time() - 24 * 60 * 60
    os.utime(old, (day_ago, day_ago))

    prune_task_files(tmp_path, 60 * 60)

    assert not old.exists()
    assert recent.exists()
