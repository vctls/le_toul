import os
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from api.main import app


@pytest.fixture
def audio_file():
    """Fixture providing the test audio file."""
    file_path = Path("tests/fixtures/Ma Rainey - Prove It on Me Blues, first verse.mp3")
    with open(file_path, "rb") as f:
        return file_path.name, f.read(), "audio/mpeg"


def test_separate_track_integration_local(audio_file):
    """Test music separation end to end through the local job store."""
    # Create a client for making requests
    client = TestClient(app)
    url = "/separate_track"

    # Make the request using the client
    filename, content, content_type = audio_file
    with mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", None):
        response = client.post(
            url,
            data={"modelName": "UVR_MDXNET_KARA_2.onnx"},
            files={"songFile": (filename, content, content_type)},
        )

        # The separation is handed off to a background task, so the response is a
        # URL to poll rather than the zip itself
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
        poll_url = response.json()["finishedTrackURL"]

        # TestClient runs background tasks before returning, so the result is
        # already waiting at the poll URL
        response = client.get(poll_url)

    # Check that we got a successful response
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    # Read the response content into a buffer
    content = BytesIO(response.content)
    content.seek(0)

    # Check that the response is a valid zip file
    with zipfile.ZipFile(content, "r") as zip_file:
        # Verify the expected files are in the zip
        file_list = zip_file.namelist()
        assert "accompaniment.wav" in file_list
        assert "vocals.wav" in file_list

        # Verify the files have content
        for filename in file_list:
            info = zip_file.getinfo(filename)
            assert info.file_size > 0, f"{filename} is empty"
