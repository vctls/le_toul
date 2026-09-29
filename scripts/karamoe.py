"""Draw a kara.moe sample and turn it into project folders for scripts/align.py.

    python scripts/karamoe.py fetch DATASET
    python scripts/karamoe.py projects DATASET OUTPUT [--model UVR_MDXNET_KARA_2.onnx]

`fetch` draws a seeded sample per language from kara.moe's search API and downloads each
karaoke's ASS lyrics and media into DATASET. `projects` turns each one into
OUTPUT/<model>/<karaoke>/, with its syllables as a timings.json and the vocals stem the
model separates. A karaoke whose stem is already there is not separated again.

The media belongs to its rights holders, so DATASET stays out of the repository.
"""

import argparse
import json
import random
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_API = "https://kara.moe/api/karas/search"
_DOWNLOADS = "https://kara.moe/downloads"
_LANGUAGE_TAGS = {
    "fre": "fd8072b7-4d9b-45d4-8f5b-a931a830edef",
    "eng": "de5eda1c-5fb3-46a6-9606-d4554fc5a1d6",
    "jpn": "4dcf9614-7914-42aa-99f4-dbce2e059133",
    "ger": "b39ffaee-d9cd-44b0-bf35-b019327c3336",
    "spa": "11e9665f-f813-4495-bced-7ef9422cc992",
}
_SAMPLE = {"fre": 8, "eng": 8, "jpn": 8, "ger": 5, "spa": 5}
_DUETS_PER_LANGUAGE = 2
_SEED = 20260929
# Only the first pages of Japanese are read. They already hold far more than the sample.
_MAX_CANDIDATES = 3000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    fetch_parser = commands.add_parser("fetch")
    fetch_parser.add_argument("dataset", type=Path)
    projects_parser = commands.add_parser("projects")
    projects_parser.add_argument("dataset", type=Path)
    projects_parser.add_argument("output", type=Path)
    projects_parser.add_argument("--model", default="UVR_MDXNET_KARA_2.onnx")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)
    if args.command == "fetch":
        fetch(args.dataset)
    else:
        projects(args.dataset, args.output, args.model)


def fetch(dataset: Path) -> None:
    """Draw the sample and download its lyrics and media."""
    random.seed(_SEED)
    chosen = []
    for language, count in _SAMPLE.items():
        usable = [r for r in _candidates(language) if _usable(r)]
        duets = [r for r in usable if len(r["singers"]) >= 2]
        solos = [r for r in usable if len(r["singers"]) < 2]
        duet_count = min(_DUETS_PER_LANGUAGE, len(duets))
        picked = random.sample(duets, duet_count) + random.sample(
            solos, count - duet_count
        )
        chosen += [_summary(language, r) for r in picked]

    (dataset / "lyrics").mkdir(parents=True, exist_ok=True)
    (dataset / "media").mkdir(exist_ok=True)
    (dataset / "chosen.json").write_text(
        json.dumps(chosen, ensure_ascii=False, indent=1)
    )
    for karaoke in chosen:
        _download(f"lyrics/{karaoke['lyrics']}", dataset / "lyrics" / karaoke["lyrics"])
        _download(f"medias/{karaoke['media']}", dataset / "media" / karaoke["media"])


def _candidates(language: str) -> list[dict]:
    records: list[dict] = []
    while len(records) < _MAX_CANDIDATES:
        query = urllib.parse.urlencode(
            {"q": f"t:{_LANGUAGE_TAGS[language]}~5", "size": 1000, "from": len(records)}
        )
        page = json.load(urllib.request.urlopen(f"{_API}?{query}"))
        records += page["content"]
        if not page["content"] or len(records) >= page["infos"]["count"]:
            break
    return records


def _usable(record: dict) -> bool:
    """Whether a karaoke is a sung song of reasonable length in a single language."""
    return (
        len(record["langs"]) == 1
        and 100 <= (record["duration"] or 0) <= 330
        and (record["mediasize"] or 0) < 80e6
        and not any(v["name"] == "Off Vocal" for v in record.get("versions", []))
        and bool(record.get("lyrics_infos"))
        and bool(record.get("mediafile"))
    )


def _summary(language: str, record: dict) -> dict:
    titles = record["titles"]
    return {
        "lang": language,
        "kid": record["kid"],
        "title": titles.get(record.get("titles_default_language") or "eng")
        or next(iter(titles.values())),
        "singers": [s["name"] for s in record["singers"]],
        "media": record["mediafile"],
        "lyrics": record["lyrics_infos"][0]["filename"],
        "size": record["mediasize"],
        "duration": record["duration"],
    }


def _download(path: str, destination: Path) -> None:
    if destination.exists():
        return
    urllib.request.urlretrieve(f"{_DOWNLOADS}/{urllib.parse.quote(path)}", destination)


def projects(dataset: Path, output: Path, model: str) -> None:
    """Write each karaoke's timings and separate its vocals."""
    from api.karaoke.separation_backends import InProcessBackend

    chosen = json.loads((dataset / "chosen.json").read_text())
    backend = InProcessBackend()
    for count, karaoke in enumerate(chosen, 1):
        name = f"{karaoke['lang']}_{karaoke['kid'][:8]}_{_slug(karaoke['title'])}"
        project = output / Path(model).stem / name
        project.mkdir(parents=True, exist_ok=True)
        lines = read_ass(dataset / "lyrics" / karaoke["lyrics"])
        (project / "timings.json").write_text(json.dumps(timings(lines)))
        if any(project.glob("vocals.*")):
            continue
        print(f"[{count}/{len(chosen)}] separating {name}")
        with tempfile.TemporaryDirectory() as work:
            result = backend.separate(
                dataset / "media" / karaoke["media"], Path(work), model
            )
            shutil.move(result.vocals, project / result.vocals.name)


def _slug(title: str) -> str:
    return re.sub(r"[^\w]+", "_", title).strip("_")[:40]


# A karaoke tag starts a syllable and gives its length in centiseconds.
_KARAOKE_TAG = re.compile(r"\\(?:kf|ko|k|K)(\d+)")
_BLOCK_OR_TEXT = re.compile(r"\{([^}]*)\}|([^{]+)")


def read_ass(path: Path) -> list[list[dict]]:
    """Return the syllables of each karaoke line in an ASS file, in order of start.

    Only the lines whose effect is `karaoke` are read. Karaoke Mugen keeps each line's
    source that way, usually as a comment, beside the `fx` line generated from it.
    A syllable with no text is a lead-in or a pause, and is dropped once it has moved
    the clock on.
    """
    fields: list[str] = []
    lines = []
    for row in path.read_text(encoding="utf-8-sig").splitlines():
        if row.startswith("Format:") and not fields and "Effect" in row:
            fields = [f.strip() for f in row[len("Format:") :].split(",")]
            continue
        kind, _, rest = row.partition(":")
        if kind not in ("Dialogue", "Comment") or not fields:
            continue
        values = dict(
            zip(fields, rest.strip().split(",", len(fields) - 1), strict=True)
        )
        if values["Effect"].strip() != "karaoke":
            continue
        syllables = _syllables(_seconds(values["Start"]), values["Text"])
        if syllables:
            lines.append(syllables)
    lines.sort(key=lambda syllables: syllables[0]["start"])
    return lines


def _syllables(line_start: float, text: str) -> list[dict]:
    syllables: list[dict] = []
    cursor = line_start
    current: dict | None = None
    for match in _BLOCK_OR_TEXT.finditer(text.replace("\\N", " ").replace("\\h", " ")):
        block, words = match.groups()
        if words is not None:
            if current is not None:
                current["text"] += words
            continue
        for duration in _KARAOKE_TAG.findall(block):
            current = {"start": cursor, "duration": int(duration) / 100, "text": ""}
            syllables.append(current)
            cursor += current["duration"]
    for i, syllable in enumerate(syllables):
        following = syllables[i + 1] if i + 1 < len(syllables) else None
        # A syllable before a pause, or last in its line, is released where it ends.
        released = following is None or not following["text"].strip()
        syllable["end"] = syllable["start"] + syllable["duration"] if released else None
    return [s for s in syllables if s["text"].strip()]


def _seconds(timestamp: str) -> float:
    hours, minutes, seconds = timestamp.strip().split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def timings(lines: list[list[dict]]) -> dict:
    """Return the lines as a version 2 timings.json, one segment per syllable."""
    segments = []
    for line_number, line in enumerate(lines):
        for i, syllable in enumerate(line):
            text = syllable["text"]
            if text[0].isspace() and segments and segments[-1]["text"].endswith("/"):
                segments[-1]["text"] = segments[-1]["text"][:-1] + "_"
            if i == len(line) - 1:
                separator = "" if line_number == len(lines) - 1 else "\n"
            else:
                separator = "_" if text[-1].isspace() else "/"
            segment = {"text": text.strip() + separator, "start": syllable["start"]}
            if syllable["end"] is not None:
                segment["end"] = syllable["end"]
            segments.append(segment)
    return {"version": 2, "voices": {"Voice 1": segments}}


if __name__ == "__main__":
    main()
