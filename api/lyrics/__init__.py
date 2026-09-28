"""Looks up a song's lyrics online, through whichever provider LYRICS_PROVIDER names."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from .. import settings


@dataclass(frozen=True)
class LyricsQuery:
    title: str
    artist: str
    # In seconds.
    duration: float


@dataclass(frozen=True)
class LyricsMatch:
    title: str
    artist: str
    album: str | None
    duration: float | None
    # The record's page on the provider's site.
    url: str | None
    # Plain text, one line per row. None when the song is instrumental.
    lyrics: str | None
    instrumental: bool


class LyricsProviderError(Exception):
    """The provider failed or timed out."""


class LyricsProvider(Protocol):
    id: str
    # Shown to users, e.g. "LRCLIB".
    name: str
    # The provider's home page.
    url: str

    async def find(self, query: LyricsQuery) -> LyricsMatch | None:
        """Return the best match for the song, or None when nothing fits.

        Raises LyricsProviderError when the provider can't be reached or answers badly.
        """
        ...


def _lrclib() -> LyricsProvider:
    from .lrclib import LrclibProvider

    return LrclibProvider(settings.LRCLIB_URL)


PROVIDERS: dict[str, Callable[[], LyricsProvider]] = {"lrclib": _lrclib}


def get_provider() -> LyricsProvider | None:
    """Build the provider LYRICS_PROVIDER names, or return None when it is empty.

    An unknown name raises, so that a typo can't turn the lookup off unnoticed.
    """
    if not settings.LYRICS_PROVIDER:
        return None
    factory = PROVIDERS.get(settings.LYRICS_PROVIDER)
    if factory is None:
        known = ", ".join(sorted(PROVIDERS))
        raise ValueError(
            f"Unknown LYRICS_PROVIDER {settings.LYRICS_PROVIDER!r}. "
            f"Use one of: {known}, or leave it empty to turn the lookup off."
        )
    return factory()
