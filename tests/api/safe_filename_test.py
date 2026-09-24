"""The uploaded filename reaches the filesystem, so it is treated as hostile.

A directory picker hands back a relative path rather than a bare name, which is
what first surfaced this: a project folder upload produced
"<folder>.mp4/song.flac" and the separation died trying to open a directory that
was never created. The same unchecked join writes outside the work directory
given a filename that says so.
"""

from pathlib import Path
from unittest import mock

import pytest

from api import main


@pytest.mark.parametrize(
    ("supplied", "expected"),
    [
        ("song.flac", "song.flac"),
        # What a directory picker actually sent.
        ("Some Artist - Some Song [karaoke] (2).mp4/song.flac", "song.flac"),
        ("../../../etc/passwd", "passwd"),
        ("/etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\drivers\\etc\\hosts", "hosts"),
        ("nested/dirs/deep/track.mp3", "track.mp3"),
        # pathlib drops the trailing separator, and a bare directory name is
        # still a safe single component to write to.
        ("some/dir/", "dir"),
    ],
)
def test_reduces_to_a_single_component(supplied, expected):
    assert main.safe_filename(supplied) == expected


@pytest.mark.parametrize("supplied", ["", ".", "..", "/", "../", "//"])
def test_names_with_no_usable_component_fall_back(supplied):
    assert main.safe_filename(supplied) == "uploaded_song"


def test_extension_survives():
    """audio-separator infers the input format from the extension."""
    assert main.safe_filename("folder/x.mp4/song.flac").endswith(".flac")


def test_upload_cannot_escape_the_work_directory(tmp_path: Path):
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    escaped = tmp_path / "escaped.flac"

    with mock.patch("api.settings.SEPARATION_BACKEND", "passthrough"):
        main.perform_music_separation(
            b"fLaC fake audio",
            "../escaped.flac",
            "UVR_MDXNET_KARA_2.onnx",
            work_dir,
        )

    assert not escaped.exists()
    assert (work_dir / "escaped.flac").read_bytes() == b"fLaC fake audio"


def test_project_folder_upload_separates(tmp_path: Path):
    """The shape that failed: a relative path where a filename was expected."""
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    with mock.patch("api.settings.SEPARATION_BACKEND", "passthrough"):
        zip_path = main.perform_music_separation(
            b"fLaC fake audio",
            "Some Song [karaoke] (2).mp4/song.flac",
            "UVR_MDXNET_KARA_2.onnx",
            work_dir,
        )

    assert zip_path.exists()
