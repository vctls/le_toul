"""LRCLIB (https://lrclib.net), a free, open lyrics database."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
import structlog

from .. import settings
from . import LyricsMatch, LyricsProviderError, LyricsQuery
from .names import cleaned

logger = structlog.get_logger(__name__)

SITE_URL = "https://lrclib.net"
# LRCLIB requires clients to give their name, version and a link.
USER_AGENT = f"LeToul/{settings.APP_VERSION} (https://github.com/vctls/le_toul)"

# In seconds. A search tries each in turn, and takes the first that has a record.
TOLERANCES = (2.0, 5.0, 10.0)
# A cleaned name is a looser match, so only a close duration vouches for it.
CLEANED_TOLERANCES = (2.0,)

# LRCLIB asks for one request at a time, with a short gap between them.
MIN_INTERVAL = 0.2
# In seconds, when a 429 comes without a usable Retry-After.
DEFAULT_RETRY_AFTER = 60.0

Record = dict[str, Any]


class _Unavailable(LyricsProviderError):
    """LRCLIB answered 503."""


class LrclibProvider:
    id = "lrclib"
    name = "LRCLIB"
    url = SITE_URL

    def __init__(
        self,
        api_url: str,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._api_url = api_url.rstrip("/")
        self._transport = transport
        self._clock = clock
        self._sleep = sleep
        # Every lookup shares the server's address, so LRCLIB's limits apply to all of
        # them together.
        self._lock = asyncio.Lock()
        self._last_request = -MIN_INTERVAL
        self._blocked_until = 0.0

    async def find(self, query: LyricsQuery) -> LyricsMatch | None:
        """Return the record that best fits the song, trying cleaned names last."""
        async with httpx.AsyncClient(
            base_url=self._api_url,
            headers={"User-Agent": USER_AGENT},
            timeout=10.0,
            transport=self._transport,
        ) as client:
            record = await self._find(
                client, query.title, query.artist, query.duration, TOLERANCES, "given"
            )
            if record is None:
                title, artist = cleaned(query.title), cleaned(query.artist)
                if title is None and artist is None:
                    return None
                record = await self._find(
                    client,
                    title or query.title,
                    artist or query.artist,
                    query.duration,
                    CLEANED_TOLERANCES,
                    "cleaned",
                )
        return None if record is None else _match(record)

    async def _find(
        self,
        client: httpx.AsyncClient,
        title: str,
        artist: str,
        duration: float,
        tolerances: tuple[float, ...],
        names: str,
    ) -> Record | None:
        params = {"track_name": title, "artist_name": artist}
        # /api/get matches the duration within 2 s by itself.
        try:
            record = await self._get(
                client, "/get", {**params, "duration": round(duration)}
            )
        except _Unavailable:
            # /api/get looks up a song it doesn't hold in other sources, and answers 503
            # now and then when that fails. The search reads only LRCLIB's own records.
            logger.info("lrclib_get_unavailable", names=names)
            record = None
        if isinstance(record, dict) and _usable(record):
            logger.info("lrclib_match", step="get", names=names)
            return record

        records = await self._get(client, "/search", params)
        candidates = [
            r
            for r in (records if isinstance(records, list) else [])
            if isinstance(r, dict)
            and _usable(r)
            and isinstance(r.get("duration"), int | float)
        ]
        for tolerance in tolerances:
            close = [
                r for r in candidates if abs(r["duration"] - duration) <= tolerance
            ]
            if close:
                logger.info(
                    "lrclib_match", step="search", names=names, tolerance=tolerance
                )
                # Synced records have had more care, so their text is more often complete.
                return min(
                    close,
                    key=lambda r: (
                        not r.get("syncedLyrics"),
                        abs(r["duration"] - duration),
                    ),
                )
        return None

    async def _get(
        self, client: httpx.AsyncClient, path: str, params: dict[str, Any]
    ) -> Any:
        """Return the decoded JSON body, or None for a 404."""
        async with self._lock:
            if self._clock() < self._blocked_until:
                raise LyricsProviderError(
                    "LRCLIB asked to wait before the next request"
                )
            gap = self._last_request + MIN_INTERVAL - self._clock()
            if gap > 0:
                await self._sleep(gap)
            try:
                response = await client.get(path, params=params)
            except httpx.HTTPError as e:
                # The exception's message holds the URL, song names included.
                raise LyricsProviderError(
                    f"LRCLIB request failed: {type(e).__name__}"
                ) from None
            finally:
                self._last_request = self._clock()
            if response.status_code == 429:
                wait = _retry_after(response)
                self._blocked_until = self._clock() + wait
                logger.warning("lrclib_rate_limited", retry_after=wait)
                raise LyricsProviderError("LRCLIB answered 429")
        if response.status_code == 404:
            return None
        if response.status_code == 503:
            raise _Unavailable("LRCLIB answered 503")
        if response.status_code != 200:
            raise LyricsProviderError(f"LRCLIB answered {response.status_code}")
        try:
            return response.json()
        except ValueError:
            raise LyricsProviderError("LRCLIB answered with invalid JSON") from None


def _retry_after(response: httpx.Response) -> float:
    """Read Retry-After as seconds or as an HTTP date."""
    value = response.headers.get("Retry-After", "").strip()
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError):
        return DEFAULT_RETRY_AFTER


def _usable(record: Record) -> bool:
    return bool(record.get("plainLyrics") or record.get("instrumental"))


def _match(record: Record) -> LyricsMatch:
    instrumental = bool(record.get("instrumental"))
    record_id = record.get("id")
    duration = record.get("duration")
    return LyricsMatch(
        title=str(record.get("trackName") or ""),
        artist=str(record.get("artistName") or ""),
        album=record.get("albumName") or None,
        duration=float(duration) if isinstance(duration, int | float) else None,
        url=f"{SITE_URL}/lyrics/{record_id}" if record_id is not None else None,
        lyrics=None if instrumental else record.get("plainLyrics"),
        instrumental=instrumental,
    )
