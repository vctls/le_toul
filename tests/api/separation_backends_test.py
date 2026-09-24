"""Tests for backend selection and for running one backend inside another.

The point of the selection tests is that a misconfigured remote backend fails
loudly at resolution rather than quietly separating somewhere else.

The subprocess tests spawn a real child, with `passthrough` as the backend it
runs, so the worker protocol is exercised end to end without a separation.
"""

import io
from pathlib import Path
from unittest import mock

import pytest

from api.karaoke import separation_progress
from api.karaoke.separation_backends import (
    InProcessBackend,
    ModalBackend,
    PassthroughBackend,
    SubprocessBackend,
    TcpBackend,
    _forward_reports,
    _worker_error,
    get_backend,
)

MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"


@pytest.fixture
def song(tmp_path: Path) -> Path:
    songfile = tmp_path / "song.mp3"
    songfile.write_bytes(b"audio")
    return songfile


@pytest.fixture
def song_dir(tmp_path: Path) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    return out


def test_default_backend_is_in_process():
    assert isinstance(get_backend(), InProcessBackend)


def test_unknown_backend_raises():
    with pytest.raises(ValueError, match="Unknown SEPARATION_BACKEND 'nope'"):
        get_backend("nope")


def test_modal_backend_requires_its_url():
    with (
        mock.patch("api.settings.SEPARATOR_MODAL_API_URL", ""),
        pytest.raises(ValueError, match="requires SEPARATOR_MODAL_API_URL"),
    ):
        get_backend(ModalBackend.name)


def test_modal_backend_resolves_when_configured():
    with mock.patch("api.settings.SEPARATOR_MODAL_API_URL", "https://example.test"):
        assert isinstance(get_backend(ModalBackend.name), ModalBackend)


def test_tcp_backend_requires_a_host():
    with (
        mock.patch("api.settings.SEPARATOR_HOST", ""),
        pytest.raises(ValueError, match="requires SEPARATOR_HOST"),
    ):
        get_backend(TcpBackend.name)


def test_passthrough_produces_both_stems(tmp_path: Path):
    songfile = tmp_path / "song.mp3"
    songfile.write_bytes(b"audio")
    song_dir = tmp_path / "out"
    song_dir.mkdir()

    result = get_backend(PassthroughBackend.name).separate(
        songfile, song_dir, "UVR_MDXNET_KARA_2.onnx"
    )

    assert result.accompaniment.read_bytes() == b"audio"
    assert result.vocals.read_bytes() == b"audio"
    # The input survives, so a test can separate the same file twice.
    assert songfile.exists()


def test_passthrough_reports_progress(tmp_path: Path):
    songfile = tmp_path / "song.mp3"
    songfile.write_bytes(b"audio")
    song_dir = tmp_path / "out"
    song_dir.mkdir()
    reported = []

    get_backend(PassthroughBackend.name).separate(
        songfile,
        song_dir,
        "UVR_MDXNET_KARA_2.onnx",
        on_progress=lambda fraction, stage: reported.append((fraction, stage)),
    )

    assert reported


def test_subprocess_backend_returns_the_childs_stems(song: Path, song_dir: Path):
    """The paths the child wrote come back as paths the parent can read."""
    result = SubprocessBackend(inner=PassthroughBackend.name).separate(
        song, song_dir, MODEL_NAME
    )

    assert result.accompaniment.read_bytes() == b"audio"
    assert result.vocals.read_bytes() == b"audio"


def test_subprocess_backend_forwards_progress_from_the_child(
    song: Path, song_dir: Path
):
    """The acceptance test for the worker pipe: a fraction crosses the boundary."""
    reported = []

    SubprocessBackend(inner=PassthroughBackend.name).separate(
        song,
        song_dir,
        MODEL_NAME,
        on_progress=lambda fraction, stage: reported.append((fraction, stage)),
    )

    assert (1.0, separation_progress.SEPARATING_STAGE) in reported


def test_subprocess_backend_reports_what_the_child_failed_on(
    song: Path, song_dir: Path
):
    """A child that dies must name its own error rather than a missing file."""
    with pytest.raises(RuntimeError, match="Unknown SEPARATION_BACKEND 'nope'"):
        SubprocessBackend(inner="nope").separate(song, song_dir, MODEL_NAME)


def test_subprocess_backend_stops_the_child_when_the_job_is_called_off(
    song: Path, song_dir: Path
):
    """Cancellation raises out of on_progress, and must unwind the whole call."""

    def cancel(fraction, stage):
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        SubprocessBackend(inner=PassthroughBackend.name).separate(
            song, song_dir, MODEL_NAME, on_progress=cancel
        )


def test_a_stage_without_a_fraction_survives_the_pipe():
    """null on the wire is None to the callback, not a bar reset to zero."""
    reported = []

    _forward_reports(
        io.StringIO('{"progress": null, "stage": "loading the separation model"}\n'),
        lambda fraction, stage: reported.append((fraction, stage)),
    )

    assert reported == [(None, "loading the separation model")]


def test_a_line_cut_short_by_a_dying_child_is_dropped():
    """A SIGKILL mid-write must not surface as a JSON error."""
    reports = io.StringIO(
        '{"progress": 0.5, "stage": "separating the vocals"}\n{"progr'
    )

    assert _forward_reports(reports, None) is None


def test_a_child_killed_mid_job_is_reported_by_its_exit_status():
    """An out-of-memory kill leaves a half-drawn tqdm bar, which is not the error."""
    noise = b"INFO - separator - Loading model\n\r 25%|" + "█".encode() + b"| 1/4\n"

    assert _worker_error(-9, io.BytesIO(noise)) == (
        "The separation worker exited with code -9."
    )


def test_a_child_that_raised_is_reported_by_its_exception():
    """The last line of a traceback is what the browser should be told."""
    stderr = (
        b"INFO - separator - Loading model\n"
        b"Traceback (most recent call last):\n"
        b'  File "worker.py", line 1, in <module>\n'
        b"RuntimeError: the model file is corrupt\n"
    )

    assert _worker_error(1, io.BytesIO(stderr)) == (
        "The separation worker exited with code 1. RuntimeError: the model file is corrupt"
    )
