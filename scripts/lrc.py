"""Line starts from LRCLIB's synced lyrics, matched to a project's lyrics.

    poetry run python scripts/lrc.py fetch local/lrclib-check.jsonl

`fetch` saves the synced record the lookup picked for each song that
scripts/lrclib_check.py checked, so scripts/align.py can anchor lines on it offline.
"""

import argparse
import difflib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np

_REPO = Path(__file__).resolve().parents[1]
RECORDS = _REPO / "local" / "lrclib" / "records"
_API = "https://lrclib.net/api"
_TAG = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    fetch_parser = commands.add_parser("fetch")
    fetch_parser.add_argument("check_rows", type=Path)
    args = parser.parse_args()
    fetch(args.check_rows)


def fetch(check_rows: Path) -> None:
    import httpx

    from api.lyrics.lrclib import MIN_INTERVAL, USER_AGENT

    RECORDS.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=15.0) as client:
        for row in _rows(check_rows):
            record_id = row["picked"]["id"]
            path = RECORDS / f"{record_id}.json"
            if path.exists():
                continue
            time.sleep(MIN_INTERVAL)
            response = client.get(f"{_API}/get/{record_id}")
            response.raise_for_status()
            path.write_text(json.dumps(response.json(), ensure_ascii=False))
            print(f"saved {record_id} for {row['name']}")


def synced_lyrics(check_rows: Path) -> dict[str, str]:
    """Return the saved synced lyrics of each checked song, by project name."""
    return {
        row["name"]: json.loads((RECORDS / f"{row['picked']['id']}.json").read_text())[
            "syncedLyrics"
        ]
        for row in _rows(check_rows)
    }


def _rows(check_rows: Path):
    for line in check_rows.open():
        row = json.loads(line)
        if row["picked"] and row["picked"]["synced"]:
            yield row


def parse(lrc: str) -> list[tuple[float, str]]:
    """Return each timed line of an LRC as its start and text, in order of start.

    A line with several time tags is sung at each of them.
    """
    lines = []
    for row in lrc.splitlines():
        position = 0
        tags = []
        while match := _TAG.match(row, position):
            minutes, seconds = match.groups()
            tags.append(int(minutes) * 60 + float(seconds.replace(":", ".")))
            position = match.end()
        text = row[position:].strip()
        lines += [(start, text) for start in tags]
    return sorted(lines, key=lambda line: line[0])


def line_anchors(
    segments: list[dict], lrc_lines: list[tuple[float, str]]
) -> dict[int, float]:
    """Return an LRC start for each line of a voice whose first words start an LRC line.

    The voice's words and the LRC's are matched in order, so a repeated chorus is placed
    by where it comes in the song. The keys are the indices of the segments that start
    the voice's lines.
    """
    words, starts_line = _voice_words(segments)
    lrc_words = []
    lrc_starts = []
    for start, text in lrc_lines:
        for rank, word in enumerate(_normalized_words(text)):
            lrc_words.append(word)
            lrc_starts.append(start if rank == 0 else None)
    matcher = difflib.SequenceMatcher(
        None, [w for w, _ in words], lrc_words, autojunk=False
    )
    anchors = {}
    for a, b, size in matcher.get_matching_blocks():
        # A single matching word is too often a common word from another line.
        for k in range(size - 1):
            segment = words[a + k][1]
            if starts_line[a + k] and lrc_starts[b + k] is not None:
                anchors.setdefault(segment, lrc_starts[b + k])
    return anchors


def _voice_words(segments: list[dict]) -> tuple[list[tuple[str, int]], list[bool]]:
    """Return each word of a voice with the segment it starts in.

    A word can span several segments, one per syllable.
    """
    characters = []
    owners = []
    for i, segment in enumerate(segments):
        text = _plain(segment["text"]) + (" " if segment["endsLine"] else "")
        characters.append(text)
        owners += [i] * len(text)
    text = "".join(characters)
    words = []
    starts_line = []
    for match in re.finditer(r"[^\W_]+(?:'[^\W_]+)*", text):
        segment = owners[match.start()]
        words.append((match.group(), segment))
        first_word = not words[:-1] or words[-2][1] != segment
        line_start = segment == 0 or segments[segment - 1]["endsLine"]
        starts_line.append(first_word and line_start)
    return words, starts_line


def _normalized_words(text: str) -> list[str]:
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", _plain(text))


def _plain(text: str) -> str:
    """Lowercase text without accents, keeping one character per character."""
    return "".join(
        next(
            (
                c
                for c in unicodedata.normalize("NFKD", char)
                if not unicodedata.combining(c)
            ),
            " ",
        )
        for char in text.lower().replace("’", "'")
    )


if __name__ == "__main__":
    sys.path.insert(0, str(_REPO))
    main()


def shifted(
    anchors: dict[int, float], first_pass: dict[int, float], neighbours: int | None
) -> dict[int, float]:
    """Return the anchors moved by their offset from a sync made without them.

    The offset is the median gap between the anchors and the first pass's starts, over
    the whole song, or over the given number of matched lines on each side.
    A record often times another version of the song, with a longer intro or a cut.
    """
    both = sorted(i for i in anchors if first_pass.get(i) is not None)
    if not both:
        return anchors
    gaps = np.array([first_pass[i] - anchors[i] for i in both])
    if neighbours is None:
        offset = float(np.median(gaps))
        return {i: start + offset for i, start in anchors.items()}
    moved = {}
    for i, start in anchors.items():
        rank = int(np.searchsorted(both, i))
        near = gaps[max(0, rank - neighbours) : rank + neighbours + 1]
        moved[i] = start + float(np.median(near))
    return moved
