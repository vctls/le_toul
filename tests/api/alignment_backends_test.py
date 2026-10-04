"""Tests for where a sync runs, and for the settings that choose it.

A misconfigured backend or aligner must fail at resolution, and an unset backend must
never turn on syncing where it can't run, such as in an image built without torch.
"""

import json
import wave
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

from api.karaoke import alignment_backends
from api.karaoke.alignment_backends import (
    NONE,
    InProcessBackend,
    SubprocessBackend,
    configured_name,
    get_backend,
)

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


@pytest.mark.parametrize("separation", ["remote", "passthrough"])
def test_an_unset_backend_is_off_where_separation_is_not_local(
    fake_aligner, separation
):
    alignment_setting, separation_setting = settings_for("", separation)
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
