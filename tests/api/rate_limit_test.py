"""Tests for the per-client limit on starting separations."""

from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api import main
from api.helpers.rate_limit import RateLimiter
from api.main import _describe_wait

MODEL_NAME = "UVR_MDXNET_KARA_2.onnx"
HOUR = 60 * 60


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_starts_beyond_the_count_wait_for_the_oldest_to_leave_the_window():
    clock = Clock()
    limiter = RateLimiter([(2, HOUR)], clock)

    assert limiter.acquire("a") is None
    clock.now += 600
    assert limiter.acquire("a") is None
    clock.now += 600

    assert limiter.acquire("a") == pytest.approx(HOUR - 1200)
    clock.now += HOUR - 1200
    assert limiter.acquire("a") is None


def test_a_refused_start_is_not_counted():
    clock = Clock()
    limiter = RateLimiter([(1, HOUR)], clock)
    limiter.acquire("a")

    for _ in range(5):
        limiter.acquire("a")
    clock.now += HOUR

    assert limiter.acquire("a") is None


def test_the_longest_wait_among_the_windows_wins():
    clock = Clock()
    limiter = RateLimiter([(3, HOUR), (3, 24 * HOUR)], clock)
    for _ in range(3):
        limiter.acquire("a")
        clock.now += HOUR

    assert limiter.acquire("a") == pytest.approx(21 * HOUR)


def test_clients_are_counted_apart():
    limiter = RateLimiter([(1, HOUR)], Clock())
    limiter.acquire("a")

    assert limiter.acquire("b") is None


def test_a_zero_count_disables_its_window():
    limiter = RateLimiter([(0, HOUR)], Clock())

    assert all(limiter.acquire("a") is None for _ in range(100))


def test_clients_without_a_recent_start_are_forgotten(monkeypatch):
    monkeypatch.setattr("api.helpers.rate_limit._SWEEP_THRESHOLD", 2)
    clock = Clock()
    limiter = RateLimiter([(1, HOUR)], clock)
    for client in ("a", "b", "c"):
        limiter.acquire(client)
    clock.now += HOUR

    limiter.acquire("d")

    assert set(limiter._starts) == {"d"}


@pytest.mark.parametrize(
    "seconds, text",
    [
        (10, "1 minute"),
        (61, "2 minutes"),
        (7000, "117 minutes"),
        (21 * HOUR, "21 hours"),
    ],
)
def test_the_wait_is_described_in_minutes_then_hours(seconds, text):
    assert _describe_wait(seconds) == text


@pytest.fixture
def client():
    with (
        mock.patch("api.settings.SEPARATED_TRACKS_BUCKET", ""),
        mock.patch("api.settings.SEPARATION_BACKEND", "passthrough"),
        mock.patch.object(main, "separation_starts", RateLimiter([(2, HOUR)])),
    ):
        yield TestClient(main.app)


def post(client, song: bytes, headers=None):
    return client.post(
        "/separate_track",
        data={"modelName": MODEL_NAME},
        files={"songFile": ("song.mp3", song, "audio/mpeg")},
        headers=headers,
    )


def test_a_client_over_its_allowance_is_refused_with_a_429(client):
    assert post(client, b"first").status_code == 200
    assert post(client, b"second").status_code == 200

    response = post(client, b"third")

    assert response.status_code == 429
    assert "Try again in 60 minutes" in response.json()["detail"]
    assert int(response.headers["Retry-After"]) == pytest.approx(HOUR, abs=5)


def test_a_song_already_separated_or_running_does_not_count(client):
    for _ in range(5):
        assert post(client, b"same song").status_code == 200

    assert post(client, b"another").status_code == 200


def test_the_forwarded_address_is_ignored_unless_configured(client):
    post(client, b"first", {"X-Real-IP": "203.0.113.7"})
    post(client, b"second", {"X-Real-IP": "203.0.113.8"})

    assert post(client, b"third", {"X-Real-IP": "203.0.113.9"}).status_code == 429


def test_the_configured_header_tells_clients_apart(client):
    with mock.patch("api.settings.CLIENT_IP_HEADER", "X-Real-IP"):
        post(client, b"first", {"X-Real-IP": "203.0.113.7"})
        post(client, b"second", {"X-Real-IP": "203.0.113.7"})

        assert post(client, b"third", {"X-Real-IP": "203.0.113.8"}).status_code == 200
        assert post(client, b"fourth", {"X-Real-IP": "203.0.113.7"}).status_code == 429
