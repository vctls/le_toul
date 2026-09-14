import hashlib
import tempfile
from pathlib import Path
from unittest import mock

import pytest

from api.helpers import cloud_storage


def test_get_cache_hash():
    # Create file content and model name
    file_content = b"test file content"
    model_name = "test_model"

    # Calculate expected hash
    expected_hash = hashlib.sha256()
    expected_hash.update(file_content)
    expected_hash.update(model_name.encode("utf-8"))

    # Get hash from the function
    result = cloud_storage.get_cache_hash(model_name, file_content)

    # Check if the hash matches
    assert result == expected_hash.hexdigest()


@pytest.mark.parametrize(
    "bucket_exists,blob_exists,content_type,expected_result",
    [
        (
            True,
            True,
            "application/zip",
            "https://example.com/url",
        ),  # Completed cache - should return URL
        (
            True,
            True,
            "application/json",
            "https://example.com/url",
        ),  # Placeholder - should return URL
        (
            True,
            False,
            None,
            None,
        ),  # Bucket exists but blob doesn't - should return None
        (False, False, None, None),  # Bucket doesn't exist - should return None
    ],
)
@mock.patch("api.helpers.cloud_storage.storage")
def test_fetch_from_cache(
    mock_storage, bucket_exists, blob_exists, content_type, expected_result
):
    # Setup mocks
    mock_client = mock.MagicMock()
    mock_bucket = mock.MagicMock()
    mock_blob = mock.MagicMock()

    mock_storage.Client.return_value = mock_client
    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob

    if not bucket_exists:
        from google.cloud.exceptions import NotFound

        mock_client.bucket.side_effect = NotFound("Bucket not found")

    if not blob_exists:
        mock_blob.exists.return_value = False
    else:
        mock_blob.exists.return_value = True
        mock_blob.content_type = content_type
        mock_blob.public_url = "https://example.com/url"

    # Test fetch_from_cache
    result = cloud_storage.fetch_from_cache("test_hash", "test-bucket")

    if expected_result:
        assert result == expected_result
    else:
        assert result is None


@pytest.mark.parametrize(
    "bucket_exists,upload_succeeds,expected_result",
    [
        (True, True, True),  # Bucket exists and upload succeeds
        (True, False, False),  # Bucket exists but upload fails
        (False, False, False),  # Bucket doesn't exist
    ],
)
@mock.patch("api.helpers.cloud_storage.storage")
def test_upload_to_cache(mock_storage, bucket_exists, upload_succeeds, expected_result):
    # Create a temp file for testing
    with tempfile.NamedTemporaryFile() as temp_file:
        temp_path = Path(temp_file.name)

        # Setup mocks
        mock_client = mock.MagicMock()
        mock_bucket = mock.MagicMock()
        mock_blob = mock.MagicMock()

        mock_storage.Client.return_value = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob

        if not bucket_exists:
            from google.cloud.exceptions import NotFound

            mock_client.bucket.side_effect = NotFound("Bucket not found")

        if not upload_succeeds:
            mock_blob.upload_from_filename.side_effect = Exception("Upload failed")

        # Test upload_to_cache
        result = cloud_storage.upload_to_cache("test_hash", temp_path, "test-bucket")

        assert result is expected_result
