"""Tests for the YouTube download helper.

The two that reach YouTube are marked `network` and deselected by default.
YouTube's bot detection fails them on its own schedule, and the feature is
supported rather than developed: separating from a lossy YouTube rip is a poor
starting point for a karaoke track anyway. Run them deliberately with
`pytest -m network` when touching this helper.
"""

from pathlib import Path

import pytest
import pytubefix

from api.helpers import youtube_helper


@pytest.mark.network
def test_get_youtube_streams():
    url = "https://www.youtube.com/watch?v=jVFIbpZA04I"
    song_files_dir = Path("tests/song_files")
    metadata, audio_path, video_path = youtube_helper.get_youtube_streams(
        url, song_files_dir
    )


@pytest.mark.network
def test_assemble_metadata():
    url = "https://www.youtube.com/watch?v=jVFIbpZA04I"
    youtube = pytubefix.YouTube(url)
    metadata = youtube_helper.assemble_metadata(youtube)
    assert "title" in metadata
    assert metadata["title"] == youtube.title


def test_get_video_id():
    """Test extracting video ID from various YouTube URL formats."""
    test_cases = [
        ("https://www.youtube.com/watch?v=jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://youtu.be/jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://www.youtube.com/embed/jVFIbpZA04I", "jVFIbpZA04I"),
        ("https://www.youtube.com/watch?v=jVFIbpZA04I&t=30s", "jVFIbpZA04I"),
    ]

    for url, expected_id in test_cases:
        video_id = youtube_helper.get_video_id(url)
        assert video_id == expected_id

    with pytest.raises(ValueError, match="Invalid YouTube URL"):
        youtube_helper.get_video_id("https://youtube.com/watch?v=invalid")

    with pytest.raises(ValueError, match="Invalid YouTube URL"):
        youtube_helper.get_video_id("invalid-url")
