"""Tests for where a sync runs, and for the settings that choose it.

A misconfigured backend or aligner must fail at resolution, and an unset backend must
never turn on syncing where it can't run, such as in an image built without torch.
"""

import json
import threading
import wave
from pathlib import Path
from unittest import mock

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.karaoke import alignment_backends, separation_backends
from api.karaoke.alignment_backends import (
    NONE,
    InProcessBackend,
    RemoteBackend,
    SubprocessBackend,
    configured_name,
    get_backend,
)
from api.karaoke.separation_backends import PassthroughBackend
from api.separation_tasks import LocalTaskRunner, create_router

SAMPLE_RATE = 16000

REQUEST = {
    "segments": [
        {"text": "Went ", "endsLine": False, "sync": True},
        {"text": "out ", "endsLine": False, "sync": True},
        {"text": "last ", "endsLine": False, "sync": False, "start": 3.0, "end": 3.4},
        {"text": "night", "endsLine": True, "sync": True},
    ]
}


def write_vocals(path: Path, seconds: float = 4.0) -> Path:
    times = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    samples = (0.3 * np.sin(2 * np.pi * 220 * times) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(samples.tobytes())
    return path


@pytest.fixture
def fake_aligner(monkeypatch):
    """Sync with the aligner that needs no model, in this process and its children."""
    monkeypatch.setenv("ALIGNMENT_MODEL", "fake")
    monkeypatch.setattr("api.settings.ALIGNMENT_MODEL", "fake")


def settings_for(alignment: str, separation: str = "in_process"):
    return (
        mock.patch("api.settings.ALIGNMENT_BACKEND", alignment),
        mock.patch("api.settings.SEPARATION_BACKEND", separation),
    )


@pytest.mark.parametrize("separation", ["in_process", "subprocess"])
def test_an_unset_backend_follows_a_local_separation(fake_aligner, separation):
    alignment_setting, separation_setting = settings_for("", separation)
    with alignment_setting, separation_setting:
        assert configured_name() == separation


def test_an_unset_backend_follows_a_remote_separation_without_the_aligner_here():
    alignment_setting, separation_setting = settings_for("", "remote")
    with (
        alignment_setting,
        separation_setting,
        mock.patch.object(
            alignment_backends.aligners, "missing_dependencies", return_value=["torch"]
        ),
    ):
        assert configured_name() == "remote"


def test_an_unset_backend_is_off_where_separation_only_pretends(fake_aligner):
    alignment_setting, separation_setting = settings_for("", "passthrough")
    with alignment_setting, separation_setting:
        assert configured_name() == NONE


def test_an_unset_backend_is_off_without_the_aligners_dependencies():
    """An image built without torch must start, with syncing off."""
    alignment_setting, separation_setting = settings_for("")
    with (
        alignment_setting,
        separation_setting,
        mock.patch.object(
            alignment_backends.aligners,
            "missing_dependencies",
            return_value=["torchaudio"],
        ),
    ):
        assert configured_name() == NONE


def test_a_backend_set_without_the_aligners_dependencies_raises():
    alignment_setting, separation_setting = settings_for("subprocess")
    with (
        alignment_setting,
        separation_setting,
        mock.patch.object(
            alignment_backends.aligners,
            "missing_dependencies",
            return_value=["torchaudio"],
        ),
        pytest.raises(ValueError, match="needs torchaudio"),
    ):
        configured_name()


def test_none_turns_syncing_off_even_where_it_could_run(fake_aligner):
    alignment_setting, separation_setting = settings_for(NONE)
    with alignment_setting, separation_setting:
        assert configured_name() == NONE


def test_an_unknown_backend_raises(fake_aligner):
    alignment_setting, separation_setting = settings_for("nope")
    with (
        alignment_setting,
        separation_setting,
        pytest.raises(ValueError, match="Unknown ALIGNMENT_BACKEND 'nope'"),
    ):
        configured_name()


def test_an_unknown_aligner_raises(monkeypatch):
    monkeypatch.setattr("api.settings.ALIGNMENT_MODEL", "nope")
    with pytest.raises(ValueError, match="Unknown aligner 'nope'"):
        configured_name()


def test_no_backend_is_built_while_syncing_is_off():
    with pytest.raises(ValueError, match="Syncing is off"):
        get_backend(NONE)


def test_in_process_returns_an_entry_per_segment(fake_aligner, tmp_path: Path):
    result = InProcessBackend().align(
        write_vocals(tmp_path / "vocals.wav"), REQUEST, tmp_path
    )

    assert result["aligner"] == "fake@1"
    entries = result["segments"]
    assert len(entries) == len(REQUEST["segments"])
    # A kept segment is the frontend's already, and comes back empty.
    assert entries[2] == {}
    assert entries[0]["start"] < entries[1]["start"] < 3.0
    assert entries[3]["start"] >= 3.4
    assert all(entry["doubtful"] is False for entry in entries if entry)


def test_subprocess_returns_what_the_child_synced(fake_aligner, tmp_path: Path):
    vocals = write_vocals(tmp_path / "vocals.wav")

    in_child = SubprocessBackend().align(vocals, REQUEST, tmp_path)

    assert in_child == InProcessBackend().align(vocals, REQUEST, tmp_path)
    assert json.loads((tmp_path / "alignment.json").read_text()) == in_child


def test_subprocess_forwards_progress_from_the_child(fake_aligner, tmp_path: Path):
    reported = []

    SubprocessBackend().align(
        write_vocals(tmp_path / "vocals.wav"),
        REQUEST,
        tmp_path,
        on_progress=lambda fraction, stage: reported.append(stage),
    )

    assert "reading the vocals" in reported


def test_subprocess_reports_what_the_child_failed_on(fake_aligner, tmp_path: Path):
    with pytest.raises(RuntimeError, match="The alignment worker exited with code 1"):
        SubprocessBackend(inner="nope").align(
            write_vocals(tmp_path / "vocals.wav"), REQUEST, tmp_path
        )


class HeldAligner:
    """Reports once, then waits for release before syncing in this process."""

    name = "held"

    def __init__(self):
        self.release = threading.Event()

    def align(self, vocals, request, work_dir, on_progress=None):
        on_progress(0.25, "aligning the lyrics")
        self.release.wait(5)
        on_progress(0.5, "aligning the lyrics")
        return InProcessBackend().align(vocals, request, work_dir)


def separator(alignment_backend=None) -> tuple[TestClient, LocalTaskRunner]:
    runner = LocalTaskRunner(PassthroughBackend(), alignment_backend)
    app = FastAPI()
    app.include_router(create_router(runner))
    return TestClient(app), runner


@pytest.fixture
def no_poll_wait():
    with mock.patch.object(separation_backends, "REMOTE_POLL_INTERVAL_SECONDS", 0):
        yield


def test_remote_returns_what_the_separator_synced(
    fake_aligner, no_poll_wait, tmp_path: Path
):
    vocals = write_vocals(tmp_path / "vocals.wav")
    client, _ = separator()
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    result = RemoteBackend(client).align(vocals, REQUEST, work_dir)

    assert result == InProcessBackend().align(vocals, REQUEST, tmp_path)


def test_remote_calls_off_the_separators_task_when_the_sync_is_cancelled(
    fake_aligner, no_poll_wait, tmp_path: Path
):
    held = HeldAligner()
    client, runner = separator(held)

    def cancel(fraction, stage):
        if stage == "aligning the lyrics":
            raise KeyboardInterrupt()

    try:
        with pytest.raises(KeyboardInterrupt):
            RemoteBackend(client).align(
                write_vocals(tmp_path / "vocals.wav"), REQUEST, tmp_path, cancel
            )
    finally:
        held.release.set()

    (task_id,) = runner._tasks
    assert runner.status(task_id).status == "cancelled"


def test_remote_needs_the_separators_address(fake_aligner, monkeypatch):
    monkeypatch.setattr("api.settings.ALIGNMENT_BACKEND", "remote")
    monkeypatch.setattr("api.settings.SEPARATION_REMOTE_URL", "")

    with pytest.raises(ValueError, match="requires SEPARATION_REMOTE_URL"):
        configured_name()


def test_remote_needs_none_of_the_aligners_dependencies_here(monkeypatch):
    """The web tier of a GPU or Modal deployment is built without torch."""
    monkeypatch.setattr("api.settings.ALIGNMENT_BACKEND", "remote")
    monkeypatch.setattr("api.settings.SEPARATION_REMOTE_URL", "http://separator:8001")

    with mock.patch.object(
        alignment_backends.aligners, "missing_dependencies", return_value=["torch"]
    ):
        assert configured_name() == "remote"
