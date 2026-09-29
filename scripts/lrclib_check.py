"""Check which test songs LRCLIB has lyrics for, and whether the lookup picks the right record.

    poetry run python scripts/lrclib_check.py [--projects FOLDER] [--rows rows.jsonl]

Each song is looked up with the app's own provider, as the app would look it up, then
searched more widely. Every record found is compared with the song's hand-timed lyrics,
so a record for the wrong song, or a better one the lookup passed over, shows up.
Responses are cached in local/lrclib/, so LRCLIB is asked each query once.

The test sets are the ones scripts/align.py measures: exported projects under
--projects, and the JamendoLyrics and kara.moe sets under local/.
"""

import argparse
import asyncio
import csv
import difflib
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import soundfile
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from align import find_projects, timings_file  # noqa: E402

from api.lyrics import LyricsQuery, lrclib  # noqa: E402

_REPO = Path(__file__).resolve().parents[1]
_CACHE = _REPO / "local" / "lrclib"
_API = "https://lrclib.net/api"
# A record whose words match the reference this closely is taken for the right song.
# Records of another song fall below 0.1, and the same song, transcribed differently or
# in another version, lands between 0.2 and 0.5.
_SAME_SONG = 0.2


@dataclass
class Track:
    set: str
    name: str
    title: str
    artist: str
    duration: float
    words: list[str]
    # Other titles the song is known by, such as a Japanese title in its own script.
    other_titles: list[str] = field(default_factory=list)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--projects", type=Path)
    parser.add_argument("--rows", type=Path, help="write each track's findings here")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)
    tracks = list(_tracks(args.projects))
    results = asyncio.run(_check_all(tracks))
    if args.rows:
        with args.rows.open("w") as rows:
            for result in results:
                rows.write(json.dumps(result, ensure_ascii=False) + "\n")
    _report(results)


def _tracks(projects: Path | None):
    if projects:
        for project in find_projects(projects):
            song = yaml.safe_load((project / "settings.yaml").read_text())["song"]
            yield Track(
                "hand-timed",
                project.name,
                song["title"],
                song["artist"],
                song["duration"],
                _words(project),
            )
    jamendo = _REPO / "local" / "jamendolyrics"
    if jamendo.exists():
        for row in csv.DictReader((jamendo / "JamendoLyrics.csv").open()):
            name = Path(row["Filepath"]).stem
            project = jamendo / "projects" / "UVR_MDXNET_KARA_2" / name
            yield Track(
                "jamendo",
                name,
                row["Title"],
                row["Artist"],
                soundfile.info(str(jamendo / "mp3" / f"{name}.mp3")).duration,
                _words(project),
            )
    karamoe = _REPO / "local" / "kara.moe"
    if karamoe.exists():
        records = {
            r["kid"]: r
            for language in json.loads(
                (karamoe / "candidates.json").read_text()
            ).values()
            for r in language
        }
        for karaoke in json.loads((karamoe / "chosen.json").read_text()):
            record = records[karaoke["kid"]]
            name = f"{karaoke['lang']}_{karaoke['kid'][:8]}"
            project = next(
                (karamoe / "projects" / "UVR_MDXNET_KARA_2").glob(f"{name}_*")
            )
            yield Track(
                "kara.moe",
                project.name,
                karaoke["title"],
                ", ".join(karaoke["singers"]),
                karaoke["duration"],
                _words(project),
                [t for t in record["titles"].values() if t != karaoke["title"]],
            )


def _words(project: Path) -> list[str]:
    timings = timings_file(project)
    lyrics = project / "lyrics.txt"
    voices = json.loads(
        subprocess.run(
            [
                "node",
                str(_REPO / "scripts" / "timings-to-json.mjs"),
                str(timings),
                *([str(lyrics)] if lyrics.exists() else []),
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    text = " ".join(
        "".join(s["text"] for s in segments) for segments in voices.values()
    )
    return normalized_words(text)


def normalized_words(text: str) -> list[str]:
    """Return the words of a text, lowercased, without accents or punctuation."""
    decomposed = unicodedata.normalize("NFKD", text.lower().replace("’", "'"))
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", plain)


def similarity(reference: list[str], lyrics: str | None) -> float | None:
    """Return how closely a record's lyrics follow the reference, from 0 to 1.

    None when the record's text can't be compared, as when a Japanese record is in its
    own script and the reference is in romaji.
    """
    if not lyrics:
        return None
    words = normalized_words(lyrics)
    if not words:
        return None
    if sum(bool(re.search(r"[぀-ヿ一-鿿]", w)) for w in words) > len(words) / 2:
        return None
    return difflib.SequenceMatcher(None, reference, words, autojunk=False).ratio()


async def _check_all(tracks: list[Track]) -> list[dict]:
    provider = lrclib.LrclibProvider(_API)
    picked: dict[str, dict] = {}
    original_match = lrclib._match

    def capture(record):
        picked["record"] = record
        return original_match(record)

    lrclib._match = capture
    results = []
    async with httpx.AsyncClient(
        headers={"User-Agent": lrclib.USER_AGENT}, timeout=15.0
    ) as client:
        for count, track in enumerate(tracks, 1):
            picked.clear()
            query = LyricsQuery(track.title, track.artist, track.duration)
            error = None
            try:
                await _retrying(lambda query=query: provider.find(query))
            except lrclib.LyricsProviderError as e:
                error = str(e)
            record = picked.get("record")
            candidates = await _candidates(client, track)
            if record is not None:
                candidates.setdefault(record["id"], record)
            results.append({**_result(track, record, candidates), "error": error})
            print(f"[{count}/{len(tracks)}] {track.set} {track.name[:50]}")
    lrclib._match = original_match
    return results


async def _retrying(call, attempts: int = 5):
    """Wait out LRCLIB's passing 503s. Any other error is final, and is recorded."""
    for attempt in range(attempts):
        try:
            return await call()
        except lrclib._Unavailable as error:
            if attempt == attempts - 1:
                raise
            print(f"  retrying after {error}")
            await asyncio.sleep(10 * (attempt + 1))


async def _candidates(client: httpx.AsyncClient, track: Track) -> dict[int, dict]:
    """Return every record a wider search finds, by ID."""
    queries = [
        {"track_name": track.title, "artist_name": track.artist},
        {"q": f"{track.artist} {track.title}"},
        {"track_name": track.title},
    ]
    queries += [{"track_name": title} for title in track.other_titles]
    found: dict[int, dict] = {}
    for query in queries:
        records = await _cached(client, "/search", query)
        for record in records if isinstance(records, list) else []:
            found.setdefault(record["id"], record)
    return found


async def _cached(client: httpx.AsyncClient, path: str, params: dict):
    key = hashlib.sha1(json.dumps([path, params], sort_keys=True).encode()).hexdigest()
    cache = _CACHE / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())

    async def get():
        await asyncio.sleep(lrclib.MIN_INTERVAL)
        response = await client.get(f"{_API}{path}", params=params)
        if response.status_code == 503:
            raise lrclib._Unavailable("LRCLIB answered 503")
        return response

    response = await _retrying(get)
    body = response.json() if response.status_code == 200 else None
    _CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(body))
    return body


def _result(track: Track, record: dict | None, candidates: dict[int, dict]) -> dict:
    def describe(r: dict) -> dict:
        return {
            "id": r["id"],
            "trackName": r.get("trackName"),
            "artistName": r.get("artistName"),
            "duration": r.get("duration"),
            "synced": bool(r.get("syncedLyrics")),
            "similarity": similarity(track.words, r.get("plainLyrics")),
        }

    scored = [describe(r) for r in candidates.values()]
    same_song = [c for c in scored if (c["similarity"] or 0) >= _SAME_SONG]
    best = max(same_song, key=lambda c: (c["synced"], c["similarity"]), default=None)
    return {
        "set": track.set,
        "name": track.name,
        "title": track.title,
        "artist": track.artist,
        "duration": track.duration,
        "picked": describe(record) if record else None,
        "best": best,
        "candidates": len(scored),
        "same_song": len(same_song),
    }


def _report(results: list[dict]) -> None:
    sets: dict[str, list[dict]] = {}
    for result in results:
        sets.setdefault(result["set"], []).append(result)
    for name, rows in sets.items():
        picked = [r for r in rows if r["picked"]]
        synced = [r for r in picked if r["picked"]["synced"]]
        right = [r for r in picked if (r["picked"]["similarity"] or 0) >= _SAME_SONG]
        wrong = [
            r
            for r in picked
            if r["picked"]["similarity"] is not None
            and r["picked"]["similarity"] < _SAME_SONG
        ]
        unverified = [r for r in picked if r["picked"]["similarity"] is None]
        errors = [r for r in rows if r["error"]]
        missed = [r for r in rows if not r["picked"] and r["best"]]
        unsynced_pick = [
            r
            for r in right
            if not r["picked"]["synced"] and r["best"] and r["best"]["synced"]
        ]
        print(f"\n{name}: {len(rows)} songs")
        print(
            f"  the lookup found a record for {len(picked)}, {len(synced)} of them synced"
        )
        print(
            f"  right song {len(right)}, wrong song {len(wrong)}, unverifiable {len(unverified)}"
        )
        print(f"  the lookup failed with an error: {len(errors)}")
        print(f"  missed although a search finds the song: {len(missed)}")
        print(
            f"  unsynced pick although a synced record of the song exists: {len(unsynced_pick)}"
        )
        print(
            f"  no record of the song anywhere: {sum(1 for r in rows if not r['best'] and not r['picked'])}"
        )
        for r in wrong:
            p = r["picked"]
            print(
                f"    wrong: {r['name'][:40]} -> {p['artistName']} - {p['trackName']} ({p['similarity']:.2f})"
            )
        for r in missed:
            b = r["best"]
            print(
                f"    missed: {r['name'][:40]} ({r['artist']} - {r['title']}, {r['duration']:.0f} s)"
                f" -> {b['artistName']} - {b['trackName']}, {b['duration']} s, {b['similarity']:.2f}"
            )


if __name__ == "__main__":
    main()
