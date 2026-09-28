from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api import lyrics, main, settings
from api.helpers.rate_limit import RateLimiter
from api.lyrics import LyricsMatch, LyricsProviderError
from api.lyrics.lrclib import LrclibProvider

BODY = {"title": "Glim Tovar", "artist": "The Wendels", "duration": 200.4}

MATCH = LyricsMatch(
    title="Glim Tovar",
    artist="The Wendels",
    album="Pellow",
    duration=201.0,
    url="https://lyrics.test/7",
    lyrics="Vel oma trin\nSossa lein",
    instrumental=False,
)


class FakeProvider:
    id = "fake"
    name = "Fake Lyrics"
    url = "https://lyrics.test"

    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.queries = []

    async def find(self, query):
        self.queries.append(query)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture(autouse=True)
def fresh_lyrics_limit(monkeypatch):
    limiter = RateLimiter([(settings.LYRICS_LOOKUPS_PER_HOUR, 60 * 60)])
    monkeypatch.setattr(main, "lyrics_lookups", limiter)
    return limiter


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider(result=MATCH)
    monkeypatch.setattr(main, "lyrics_provider", fake)
    return fake


@pytest.fixture
def client():
    return TestClient(main.app)


def test_the_provider_is_described(client, provider):
    assert client.get("/lyrics/provider").json() == {
        "provider": {"id": "fake", "name": "Fake Lyrics", "url": "https://lyrics.test"}
    }


def test_no_provider_is_described_as_null(client, monkeypatch):
    monkeypatch.setattr(main, "lyrics_provider", None)

    assert client.get("/lyrics/provider").json() == {"provider": None}


def test_a_lookup_returns_the_match(client, provider):
    response = client.post("/lyrics", json=BODY)

    assert response.status_code == 200
    assert response.json() == {
        "lyrics": "Vel oma trin\nSossa lein",
        "instrumental": False,
        "match": {
            "title": "Glim Tovar",
            "artist": "The Wendels",
            "album": "Pellow",
            "duration": 201.0,
            "url": "https://lyrics.test/7",
        },
    }
    assert provider.queries == [lyrics.LyricsQuery("Glim Tovar", "The Wendels", 200.4)]


def test_nothing_found_is_a_404(client, provider):
    provider.result = None

    response = client.post("/lyrics", json=BODY)

    assert response.status_code == 404
    assert response.json()["detail"] == "No lyrics found."


def test_a_lookup_without_a_provider_is_a_distinct_404(client, monkeypatch):
    monkeypatch.setattr(main, "lyrics_provider", None)

    response = client.post("/lyrics", json=BODY)

    assert response.status_code == 404
    assert response.json()["detail"] == "Lyrics lookup is off on this server."


@pytest.mark.parametrize(
    "change",
    [{"title": "  "}, {"artist": ""}, {"duration": 0}, {"duration": -3}],
)
def test_a_blank_name_or_a_non_positive_duration_is_refused(client, provider, change):
    assert client.post("/lyrics", json={**BODY, **change}).status_code == 422
    assert provider.queries == []


def test_a_provider_error_is_a_502(client, provider):
    provider.error = LyricsProviderError("LRCLIB answered 503")

    assert client.post("/lyrics", json=BODY).status_code == 502


def test_lookups_beyond_the_limit_are_refused(client, provider, monkeypatch):
    monkeypatch.setattr(main, "lyrics_lookups", RateLimiter([(2, 60 * 60)]))

    statuses = [client.post("/lyrics", json=BODY).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert len(provider.queries) == 2


@pytest.mark.parametrize("error", [None, LyricsProviderError("LRCLIB answered 503")])
def test_the_song_stays_out_of_the_logs(client, provider, error):
    provider.error = error

    with mock.patch("api.main.logger") as logger:
        client.post("/lyrics", json=BODY)

    logged = str(logger.mock_calls)
    assert "lyrics_lookup" in logged
    for secret in ("Glim", "Wendels", "Vel oma"):
        assert secret not in logged


def test_an_empty_provider_setting_turns_the_lookup_off(monkeypatch):
    monkeypatch.setattr(settings, "LYRICS_PROVIDER", "")

    assert lyrics.get_provider() is None


def test_lrclib_is_built_from_its_setting(monkeypatch):
    monkeypatch.setattr(settings, "LYRICS_PROVIDER", "lrclib")

    assert isinstance(lyrics.get_provider(), LrclibProvider)


def test_an_unknown_provider_fails(monkeypatch):
    monkeypatch.setattr(settings, "LYRICS_PROVIDER", "lrclbi")

    with pytest.raises(ValueError, match="lrclbi"):
        lyrics.get_provider()
