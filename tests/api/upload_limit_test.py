"""Tests for the upload limit on /separate_track, and how the page learns it."""

import re
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api.main import UPLOAD_TOO_LARGE_MESSAGE, app

MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"


@pytest.fixture
def client():
    with (
        mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""),
        mock.patch("api.settings.SEPARATION_BACKEND", "passthrough"),
    ):
        yield TestClient(app)


def post(client, song: bytes):
    return client.post(
        "/separate_track",
        data={"modelName": MODEL_NAME},
        files={"songFile": ("song.mp3", song, "audio/mpeg")},
    )


def test_a_body_declared_too_large_is_refused_before_it_is_read(client):
    with (
        mock.patch("api.settings.MAX_UPLOAD_BYTES", 10),
        mock.patch("starlette.requests.Request.form") as parse,
    ):
        response = post(client, b"x" * 2_000_000)

    assert response.status_code == 413
    assert response.json()["detail"] == UPLOAD_TOO_LARGE_MESSAGE
    parse.assert_not_called()


def test_a_song_over_the_limit_is_refused_once_parsed(client):
    # Small enough to pass the Content-Length allowance, so only the parsed size catches it.
    with mock.patch("api.settings.MAX_UPLOAD_BYTES", 10):
        response = post(client, b"x" * 100)

    assert response.status_code == 413
    assert response.json()["detail"] == UPLOAD_TOO_LARGE_MESSAGE


def test_a_song_at_the_limit_is_accepted(client):
    with mock.patch("api.settings.MAX_UPLOAD_BYTES", 100):
        response = post(client, b"x" * 100)

    assert response.status_code == 200
    assert "finishedTrackURL" in response.json()


def test_the_page_tells_the_frontend_the_limit(client):
    with mock.patch("api.settings.MAX_UPLOAD_BYTES", 123_000_000):
        page = client.get("/").text

    assert re.search(r'<meta name="tuul-max-upload-bytes" content="123000000"', page)
