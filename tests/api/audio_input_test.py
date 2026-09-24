"""Tests for converting songs audio-separator cannot read on its own."""

import shutil
import subprocess
from pathlib import Path
from unittest import mock

import pytest

from api.karaoke import audio_input, separation_progress
from api.karaoke.music_separation import DEFAULT_MODEL, SeparationMethod, split_song

soundfile = pytest.importorskip("soundfile")
pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


def make_song(path: Path, codec: str) -> Path:
    """Write a second of stereo tone in the given codec."""
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-ac",
            "2",
            "-c:a",
            codec,
            str(path),
        ],
        check=True,
    )
    return path


def test_mp4_needs_conversion(tmp_path):
    assert audio_input.needs_conversion(make_song(tmp_path / "song.mp4", "aac"))


@pytest.mark.parametrize(
    ("name", "codec"), [("song.wav", "pcm_s24le"), ("song.flac", "flac")]
)
def test_formats_libsndfile_reads_are_left_alone(tmp_path, name, codec):
    assert not audio_input.needs_conversion(make_song(tmp_path / name, codec))


def test_mp4_converts_to_16_bit_flac(tmp_path):
    """A lossy source must not come out as 24-bit, or so would its stems."""
    song = make_song(tmp_path / "song.mp4", "aac")

    converted = audio_input.to_flac(song, tmp_path)

    info = soundfile.info(str(converted))
    assert converted.suffix == ".flac"
    assert info.subtype == "PCM_16"
    assert info.channels == 2


def test_undecodable_song_is_handed_on_unchanged(tmp_path):
    """audio-separator still gets its own try at a file ffmpeg rejects."""
    song = tmp_path / "song.mp4"
    song.write_bytes(b"not audio")

    assert audio_input.to_flac(song, tmp_path) == song


def test_missing_ffmpeg_hands_the_song_on_unchanged(tmp_path):
    song = make_song(tmp_path / "song.mp4", "aac")

    with mock.patch("subprocess.run", side_effect=FileNotFoundError):
        assert audio_input.to_flac(song, tmp_path) == song


def test_separation_reads_the_converted_song(tmp_path):
    song = make_song(tmp_path / "song.mp4", "aac")
    reports = []
    separated_from = []

    def separate(path, output_names):
        separated_from.append(Path(path))
        assert soundfile.info(path).format == "FLAC"

    with mock.patch("audio_separator.separator.Separator") as separator:
        separator.return_value._separate_file.side_effect = separate
        split_song(
            song,
            tmp_path,
            DEFAULT_MODEL,
            method=SeparationMethod.API,
            on_progress=lambda progress, stage: reports.append(stage),
        )

    assert separated_from[0].suffix == ".flac"
    assert reports[0] == separation_progress.CONVERTING_STAGE
    # The conversion is scratch, and does not outlive the separation.
    assert not separated_from[0].exists()
