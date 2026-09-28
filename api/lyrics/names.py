import re

_BRACKETED = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")
_FEATURING = re.compile(r"\s*\b(?:feat\.|ft\.|featuring\b).*$", re.IGNORECASE)
_VERSION_SUFFIX = re.compile(
    r"\s+[-–—]\s+[^-–—]*\b(?:remaster(?:ed)?|edit|live|version|mono|stereo|mix|remix|"
    r"demo|acoustic|instrumental)\b[^-–—]*$",
    re.IGNORECASE,
)
_SPACES = re.compile(r"\s+")


def cleaned(text: str) -> str | None:
    """Strip the parts of a song title or artist that lyrics databases often leave out.

    Removes bracketed asides, a trailing version suffix ("- Radio Edit") and featured
    artists. Returns None when that changes nothing or leaves nothing.
    """
    original = _SPACES.sub(" ", text).strip()
    result = original
    while True:
        stripped = _BRACKETED.sub(" ", result)
        if stripped == result:
            break
        result = stripped
    result = _FEATURING.sub("", result)
    result = _VERSION_SUFFIX.sub("", result)
    result = _SPACES.sub(" ", result).strip()
    if not result or result == original:
        return None
    return result
