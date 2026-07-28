import tempfile
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def song_file():
    """Create a simple test audio file."""
    return ("test_song.mp3", b"test audio content", "audio/mpeg")


@pytest.fixture
def request_factory():
    """Create a request factory for testing."""
    return TestClient(app)


@mock.patch("api.karaoke.music_separation.split_song")
@mock.patch("api.helpers.cloud_storage.get_cache_hash")
@mock.patch("api.helpers.cloud_storage.fetch_from_cache")
@mock.patch("api.helpers.cloud_storage.upload_to_cache")
@mock.patch("api.helpers.zip_helper.create_zip_file")
def test_separate_track_with_cache_hit(
    mock_create_zip,
    mock_upload_to_cache,
    mock_fetch_from_cache,
    mock_get_cache_hash,
    mock_split_song,
    request_factory,
    song_file,
):
    """Test that the view returns URL when cached file is available."""
    # Setup mocks
    mock_get_cache_hash.return_value = "test_hash"
    # Return URL for cached file
    mock_fetch_from_cache.return_value = "https://example.com/bucket/separated_tracks/test_hash.zip"

    # Create the request
    filename, content, content_type = song_file
    data = {"modelName": "UVR_MDXNET_KARA_2.onnx"}
    files = {"songFile": (filename, content, content_type)}

    # Test the view with cache enabled
    with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", "test-bucket"):
        url = "/separate_track"
        response = request_factory.post(url, data=data, files=files)

        # Assert that the cache was checked
        mock_get_cache_hash.assert_called_once()
        mock_fetch_from_cache.assert_called_once_with("test_hash")

        # Assert that the song was not split (cached version was used)
        mock_split_song.assert_not_called()
        mock_create_zip.assert_not_called()
        mock_upload_to_cache.assert_not_called()

        # Assert that the response is JSON with URL
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
        response_data = response.json()
        assert "finishedTrackURL" in response_data
        assert response_data["finishedTrackURL"] == "https://example.com/bucket/separated_tracks/test_hash.zip"


@mock.patch("api.karaoke.music_separation.split_song")
@mock.patch("api.helpers.cloud_storage.get_cache_hash")
@mock.patch("api.helpers.cloud_storage.fetch_from_cache")
@mock.patch("api.helpers.cloud_storage.upload_to_cache")
@mock.patch("api.helpers.cloud_storage.create_cache_placeholder")
@mock.patch("api.helpers.zip_helper.create_zip_file")
def test_separate_track_with_cache_miss(
    mock_create_zip,
    mock_create_placeholder,
    mock_upload_to_cache,
    mock_fetch_from_cache,
    mock_get_cache_hash: mock.Mock,
    mock_split_song,
    request_factory,
    song_file,
):
    """Test that the view returns URL immediately when cache miss and processes in background."""
    # Setup mocks
    mock_get_cache_hash.return_value = "test_hash"
    mock_fetch_from_cache.return_value = None  # Cache miss
    mock_create_placeholder.return_value = "https://example.com/bucket/separated_tracks/test_hash.zip"
    
    # Mock song splitting process for background task
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        accomp_path = temp_dir_path / "accompaniment.wav"
        vocal_path = temp_dir_path / "vocals.wav"
        zip_path = temp_dir_path / "split_song.zip"

        # Create test files
        accomp_path.write_bytes(b"accompaniment content")
        vocal_path.write_bytes(b"vocals content")
        zip_path.write_bytes(b"zip content")

        mock_split_song.return_value = (accomp_path, vocal_path)
        mock_create_zip.return_value = zip_path

        # Create the request
        filename, content, content_type = song_file
        data = {"modelName": "UVR_MDXNET_KARA_2.onnx"}
        files = {"songFile": (filename, content, content_type)}

        # Mock add_task to execute background task synchronously
        def mock_add_task_sync(func, *args, **kwargs):
            func(*args, **kwargs)

        # Test the view with cache enabled
        with mock.patch("fastapi.BackgroundTasks.add_task", side_effect=mock_add_task_sync):
            with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", "test-bucket"):
                response = request_factory.post("/separate_track", data=data, files=files)

                # Assert that the cache was checked and placeholder created
                mock_get_cache_hash.assert_called_with("UVR_MDXNET_KARA_2.onnx", b"test audio content")
                mock_fetch_from_cache.assert_called_once_with("test_hash")
                mock_create_placeholder.assert_called_once_with("test_hash")

                # Assert that the response is JSON with URL
                assert response.status_code == 200
                assert response.headers["content-type"] == "application/json"
                response_data = response.json()
                assert "finishedTrackURL" in response_data
                assert response_data["finishedTrackURL"] == "https://example.com/bucket/separated_tracks/test_hash.zip"

                # Assert that the background task executed and called the expected functions
                mock_split_song.assert_called_once()
                mock_create_zip.assert_called_once()
                mock_upload_to_cache.assert_called_once_with("test_hash", zip_path)


@mock.patch("api.helpers.cloud_storage.get_cache_hash")
@mock.patch("api.helpers.cloud_storage.fetch_from_cache")
def test_separate_track_with_placeholder_found_returns_url(
    mock_fetch_from_cache,
    mock_get_cache_hash,
    request_factory,
    song_file,
):
    """Test that the view returns URL when placeholder is found."""
    # Setup mocks
    mock_get_cache_hash.return_value = "test_hash"
    # Return placeholder URL
    mock_fetch_from_cache.return_value = "https://example.com/bucket/separated_tracks/test_hash.zip"

    # Create the request
    filename, content, content_type = song_file
    data = {"modelName": "UVR_MDXNET_KARA_2.onnx"}
    files = {"songFile": (filename, content, content_type)}

    # Test the view with cache enabled
    with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", "test-bucket"):
        response = request_factory.post("/separate_track", data=data, files=files)

        # Assert that the cache was checked
        mock_get_cache_hash.assert_called_once()
        mock_fetch_from_cache.assert_called_once_with("test_hash")

        # Assert that the response is JSON with URL
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
        response_data = response.json()
        assert "finishedTrackURL" in response_data
        assert response_data["finishedTrackURL"] == "https://example.com/bucket/separated_tracks/test_hash.zip"


@mock.patch("api.karaoke.music_separation.split_song")
@mock.patch("api.helpers.cloud_storage.fetch_from_cache")
@mock.patch("api.helpers.cloud_storage.upload_to_cache")
@mock.patch("api.helpers.zip_helper.create_zip_file")
def test_separate_track_without_cache(
    mock_create_zip,
    mock_upload_to_cache,
    mock_fetch_from_cache,
    mock_split_song,
    request_factory,
    song_file,
    local_job_dir,
):
    """Test that the view processes locally and returns a poll URL when GCS is off."""
    # Mock the song splitting process
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        accomp_path = temp_dir_path / "accompaniment.wav"
        vocal_path = temp_dir_path / "vocals.wav"
        zip_path = temp_dir_path / "split_song.zip"

        # Create test files
        accomp_path.write_bytes(b"accompaniment content")
        vocal_path.write_bytes(b"vocals content")
        zip_path.write_bytes(b"zip content")

        mock_split_song.return_value = (accomp_path, vocal_path)
        mock_create_zip.return_value = zip_path

        # Create the request
        factory = request_factory
        filename, content, content_type = song_file
        data = {"modelName": "UVR_MDXNET_KARA_2.onnx"}
        files = {"songFile": (filename, content, content_type)}

        # Test the view with GCS caching disabled
        with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""):
            response = factory.post("/separate_track", data=data, files=files)

            # Assert that GCS operations were not attempted (bucket is empty)
            # Note: get_cache_hash may still be called for logging/diagnostics
            mock_fetch_from_cache.assert_not_called()
            mock_upload_to_cache.assert_not_called()

            # Assert that the song was split by the background task
            mock_split_song.assert_called_once()
            mock_create_zip.assert_called_once()

            # Assert that the client is handed a URL to poll rather than the zip
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/json"
            poll_url = response.json()["finishedTrackURL"]
            assert poll_url.startswith("/separated_track/")

            # TestClient runs background tasks before returning, so the result
            # is already waiting at the poll URL
            poll_response = factory.get(poll_url)
            assert poll_response.status_code == 200
            assert poll_response.headers["content-type"] == "application/zip"
            assert poll_response.content == b"zip content"
