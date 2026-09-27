"""Tests for the caching headers on the bundled fonts."""

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_fonts_are_cacheable_for_a_week():
    response = client.get("/static/fonts/DejaVuSans.ttf")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=604800"


def test_range_requests_for_fonts_are_cacheable_too():
    response = client.get("/static/fonts/DejaVuSans.ttf", headers={"Range": "bytes=0-99"})

    assert response.status_code == 206
    assert response.headers["cache-control"] == "public, max-age=604800"


def test_other_static_files_keep_default_caching():
    response = client.get("/static/favicon.ico")

    assert response.status_code == 200
    assert "cache-control" not in response.headers


def test_missing_fonts_are_not_cached():
    response = client.get("/static/fonts/Missing.ttf")

    assert response.status_code == 404
    assert "cache-control" not in response.headers
