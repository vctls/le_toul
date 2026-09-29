import asyncio

import httpx
import pytest

from api.lyrics import LyricsProviderError, LyricsQuery
from api.lyrics.lrclib import USER_AGENT, LrclibProvider

API_URL = "https://lrclib.test/api"


def record(id, duration, lyrics="Vel oma trin\nSossa lein", synced=False, **extra):
    return {
        "id": id,
        "trackName": "Glim Tovar",
        "artistName": "The Wendels",
        "albumName": "Pellow",
        "duration": duration,
        "instrumental": False,
        "plainLyrics": lyrics,
        "syncedLyrics": "[00:01.00] Vel oma trin" if synced else None,
        **extra,
    }


class FakeLrclib:
    """Answers /get and /search from canned records, keyed by track name."""

    def __init__(self, get=None, search=None):
        self.get = get or {}
        self.search = search or {}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        track = request.url.params["track_name"]
        if request.url.path == "/api/get":
            found = self.get.get(track)
            if found is None:
                return httpx.Response(404, json={"code": 404})
            return httpx.Response(200, json=found)
        return httpx.Response(200, json=self.search.get(track, []))

    @property
    def paths(self):
        return [(r.url.path, r.url.params["track_name"]) for r in self.requests]


class Clock:
    """A clock whose sleep only moves time forward, and records how long it slept."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def __call__(self):
        return self.now

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def provider_for(handler, clock=None):
    clock = clock or Clock()
    return LrclibProvider(
        API_URL, httpx.MockTransport(handler), clock=clock, sleep=clock.sleep
    )


QUERY = LyricsQuery("Glim Tovar", "The Wendels", 200.0)


def find(handler, title="Glim Tovar", duration=200.0):
    provider = provider_for(handler)
    return asyncio.run(provider.find(LyricsQuery(title, "The Wendels", duration)))


def test_an_exact_hit_is_taken_without_searching():
    lrclib = FakeLrclib(get={"Glim Tovar": record(7, 201.0)})

    match = find(lrclib)

    assert match.lyrics == "Vel oma trin\nSossa lein"
    assert match.url == "https://lrclib.net/lyrics/7"
    assert (match.title, match.artist, match.album, match.duration) == (
        "Glim Tovar",
        "The Wendels",
        "Pellow",
        201.0,
    )
    assert lrclib.paths == [("/api/get", "Glim Tovar")]


def test_it_sends_the_rounded_duration_and_names_itself():
    lrclib = FakeLrclib(get={"Glim Tovar": record(7, 201.0)})

    find(lrclib, duration=200.6)

    assert lrclib.requests[0].url.params["duration"] == "201"
    assert lrclib.requests[0].headers["User-Agent"] == USER_AGENT


@pytest.mark.parametrize(
    ("offset", "found"), [(1.5, 1), (4.0, 2), (9.0, 3), (12.0, None)]
)
def test_the_search_widens_from_two_to_ten_seconds(offset, found):
    lrclib = FakeLrclib(search={"Glim Tovar": [record(found or 0, 200.0 + offset)]})

    match = find(lrclib)

    if found is None:
        assert match is None
    else:
        assert match.url.endswith(f"/{found}")


def test_a_closer_tolerance_wins_over_synced_lyrics():
    lrclib = FakeLrclib(
        search={"Glim Tovar": [record(1, 204.0, synced=True), record(2, 201.0)]}
    )

    assert find(lrclib).url.endswith("/2")


def test_synced_lyrics_win_over_a_closer_duration_within_one_tolerance():
    lrclib = FakeLrclib(
        search={"Glim Tovar": [record(1, 200.5), record(2, 201.5, synced=True)]}
    )

    assert find(lrclib).url.endswith("/2")


def test_the_closest_duration_wins_between_equals():
    lrclib = FakeLrclib(search={"Glim Tovar": [record(1, 201.5), record(2, 199.5)]})

    assert find(lrclib).url.endswith("/2")


def test_records_without_lyrics_are_ignored():
    lrclib = FakeLrclib(
        get={"Glim Tovar": record(1, 200.0, lyrics=None)},
        search={"Glim Tovar": [record(2, 200.0, lyrics=""), record(3, 204.0)]},
    )

    assert find(lrclib).url.endswith("/3")


def test_an_instrumental_record_counts_without_lyrics():
    lrclib = FakeLrclib(
        get={"Glim Tovar": record(4, 200.0, lyrics=None, instrumental=True)}
    )

    match = find(lrclib)

    assert match.instrumental
    assert match.lyrics is None


def test_cleaned_names_are_tried_last_and_only_at_two_seconds():
    lrclib = FakeLrclib(search={"Glim Tovar": [record(5, 201.0)]})

    match = find(lrclib, title="Glim Tovar (Pelto's Moonlit Radio Edit)")

    assert match.url.endswith("/5")
    assert lrclib.paths == [
        ("/api/get", "Glim Tovar (Pelto's Moonlit Radio Edit)"),
        ("/api/search", "Glim Tovar (Pelto's Moonlit Radio Edit)"),
        ("/api/get", "Glim Tovar"),
        ("/api/search", "Glim Tovar"),
    ]


def test_a_cleaned_name_needs_a_close_duration():
    lrclib = FakeLrclib(search={"Glim Tovar": [record(5, 204.0)]})

    assert find(lrclib, title="Glim Tovar (Radio Edit)") is None


def test_the_cleaned_step_is_skipped_when_cleanup_changes_nothing():
    lrclib = FakeLrclib()

    assert find(lrclib) is None
    assert len(lrclib.requests) == 2


@pytest.mark.parametrize("status", [500, 503, 429])
def test_an_error_status_raises(status):
    with pytest.raises(LyricsProviderError):
        find(lambda request: httpx.Response(status))


def test_a_503_from_get_falls_back_to_the_search():
    search = FakeLrclib(search={"Glim Tovar": [record(7, 201.0)]})

    def unavailable_get(request):
        if request.url.path == "/api/get":
            return httpx.Response(503)
        return search(request)

    match = find(unavailable_get)

    assert match is not None and match.url.endswith("/7")


def test_a_503_from_the_search_still_raises():
    with pytest.raises(LyricsProviderError):
        find(
            lambda request: httpx.Response(
                404 if request.url.path == "/api/get" else 503
            )
        )


def test_a_timeout_raises_without_the_song_names():
    def time_out(request):
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(LyricsProviderError) as raised:
        find(time_out)

    assert "Glim" not in str(raised.value)


def test_invalid_json_raises():
    with pytest.raises(LyricsProviderError):
        find(lambda request: httpx.Response(200, content=b"<html>"))


def test_requests_are_spaced_out():
    clock = Clock()
    provider = provider_for(FakeLrclib(), clock)

    asyncio.run(provider.find(QUERY))

    assert clock.sleeps == [pytest.approx(0.2)]


def test_concurrent_lookups_send_one_request_at_a_time():
    in_flight = 0
    most = 0

    async def handler(request):
        nonlocal in_flight, most
        in_flight += 1
        most = max(most, in_flight)
        await asyncio.sleep(0)
        in_flight -= 1
        return httpx.Response(404)

    provider = provider_for(handler)

    async def both():
        await asyncio.gather(provider.find(QUERY), provider.find(QUERY))

    asyncio.run(both())

    assert most == 1


@pytest.mark.parametrize(("header", "wait"), [({"Retry-After": "30"}, 30), ({}, 60)])
def test_a_429_pauses_every_lookup_for_the_wait_it_asks(header, wait):
    clock = Clock()
    lrclib = FakeLrclib(get={"Glim Tovar": record(7, 201.0)})
    answers = [httpx.Response(429, headers=header)]

    def handler(request):
        return answers.pop() if answers else lrclib(request)

    provider = provider_for(handler, clock)

    with pytest.raises(LyricsProviderError):
        asyncio.run(provider.find(QUERY))
    clock.now += wait - 1
    with pytest.raises(LyricsProviderError):
        asyncio.run(provider.find(QUERY))
    assert lrclib.requests == []

    clock.now += 1
    assert asyncio.run(provider.find(QUERY)).url.endswith("/7")


@pytest.mark.network
def test_live_lrclib_finds_a_well_known_song():
    provider = LrclibProvider("https://lrclib.net/api")

    match = asyncio.run(provider.find(LyricsQuery("Bohemian Rhapsody", "Queen", 354.0)))

    assert match is not None
    assert match.lyrics
