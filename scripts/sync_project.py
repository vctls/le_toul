"""Sync a song's lyrics to its vocals, and write a project folder the app loads.

    python scripts/sync_project.py SOURCE OUTPUT [--model mel_band_roformer_karaoke_becruily.ckpt]

SOURCE holds the song and its lyrics.txt. OUTPUT receives the song, the lyrics, both stems
and a timings.json, in which the syllables the aligner is unsure of are flagged for review.
Any timings in SOURCE are left out, so the app loads the synced ones. Stems already in OUTPUT
are reused.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import settings  # noqa: E402
from api.karaoke.aligners import get_aligner  # noqa: E402
from api.karaoke.alignment import SyncSegment, load_audio, sync  # noqa: E402

_REPO = Path(__file__).resolve().parents[1]
_SONG_SUFFIXES = (
    ".flac",
    ".wav",
    ".mp3",
    ".m4a",
    ".ogg",
    ".opus",
    ".aac",
    ".mp4",
    ".mkv",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default=settings.DEFAULT_SEPARATION_MODEL)
    parser.add_argument("--aligner", default="mms_fa")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    song = next(p for p in sorted(args.source.iterdir()) if p.suffix in _SONG_SUFFIXES)
    lyrics = args.source / "lyrics.txt"
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copy(song, args.output / f"song{song.suffix}")
    shutil.copy(lyrics, args.output / "lyrics.txt")

    vocals = next(args.output.glob("vocals.*"), None)
    if vocals is None:
        print(f"Separating {song.name} with {args.model}")
        vocals = _separate(song, args.output, args.model)

    voices = _node("segments", lyrics)
    aligner = get_aligner(args.aligner)
    audio = load_audio(vocals, aligner.sample_rate)
    synced = {}
    for voice, segments in voices.items():
        began = time.monotonic()
        results = sync(
            aligner,
            audio,
            [SyncSegment(s["text"], s["endsLine"], sync=True) for s in segments],
        )
        synced[voice] = [
            {"start": r.start, "end": r.end, "doubtful": r.doubtful} for r in results
        ]
        _summary(voice, segments, results, time.monotonic() - began)

    with tempfile.NamedTemporaryFile("w", suffix=".json") as times:
        json.dump(synced, times)
        times.flush()
        timings = _node("write", lyrics, Path(times.name))
    (args.output / "timings.json").write_text(json.dumps(timings, indent=1))
    print(f"Wrote {args.output}")


def _separate(song: Path, output: Path, model: str) -> Path:
    from api.karaoke.separation_backends import InProcessBackend

    with tempfile.TemporaryDirectory() as work:
        result = InProcessBackend().separate(song, Path(work), model)
        vocals = output / f"vocals{result.vocals.suffix}"
        shutil.move(result.vocals, vocals)
        shutil.move(
            result.accompaniment, output / f"accompaniment{result.accompaniment.suffix}"
        )
    return vocals


def _node(*args: str | Path) -> dict:
    return json.loads(
        subprocess.run(
            ["node", str(_REPO / "scripts" / "sync-timings.mjs"), *map(str, args)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )


def _summary(voice: str, segments: list[dict], results, elapsed: float) -> None:
    lines = []
    for segment, result in zip(segments, results, strict=True):
        if not lines or lines[-1]["done"]:
            lines.append({"doubtful": False, "done": False})
        lines[-1]["doubtful"] |= result.doubtful
        lines[-1]["done"] = segment["endsLine"]
    print(
        f"{voice}: {sum(r.start is not None for r in results)} of {len(results)} segments "
        f"synced in {elapsed:.0f} s, {sum(r.doubtful for r in results)} doubtful, "
        f"on {sum(line['doubtful'] for line in lines)} of {len(lines)} lines"
    )


if __name__ == "__main__":
    main()
