"""Turn the JamendoLyrics MultiLang dataset into project folders for scripts/align.py.

    python scripts/jamendolyrics.py DATASET OUTPUT [--model UVR_MDXNET_KARA_2.onnx]

DATASET is a download of https://huggingface.co/datasets/jamendolyrics/jamendolyrics
holding JamendoLyrics.csv and the mp3/, lyrics/ and annotations/words/ folders.
Each song becomes OUTPUT/<model>/<song>/, with its words as a timings.json and the
vocals stem the model separates. Separating is the slow part, and a song whose stem
is already there is not separated again.

The dataset times words, not syllables, so each word is one segment.
"""

import argparse
import csv
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.karaoke.separation_backends import InProcessBackend  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="UVR_MDXNET_KARA_2.onnx")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    with (args.dataset / "JamendoLyrics.csv").open() as index:
        songs = [Path(row["Filepath"]).stem for row in csv.DictReader(index)]
    backend = InProcessBackend()
    for count, song in enumerate(songs, 1):
        project = args.output / Path(args.model).stem / song
        project.mkdir(parents=True, exist_ok=True)
        (project / "timings.json").write_text(json.dumps(timings(args.dataset, song)))
        if any(project.glob("vocals.*")):
            continue
        print(f"[{count}/{len(songs)}] separating {song}")
        with tempfile.TemporaryDirectory() as work:
            result = backend.separate(
                args.dataset / "mp3" / f"{song}.mp3", Path(work), args.model
            )
            shutil.move(result.vocals, project / result.vocals.name)


def timings(dataset: Path, song: str) -> dict:
    """Return a song's words as a version 2 timings.json, one segment per word."""
    words = (dataset / "lyrics" / f"{song}.words.txt").read_text().split()
    with (dataset / "annotations" / "words" / f"{song}.csv").open() as annotations:
        rows = list(csv.DictReader(annotations))
    if len(words) != len(rows):
        raise ValueError(f"{song}: {len(words)} words but {len(rows)} timed")

    segments = []
    for i, (word, row) in enumerate(zip(words, rows, strict=True)):
        ends_line = not math.isnan(float(row["line_end"]))
        last = i == len(words) - 1
        separator = "" if last else "\n" if ends_line else "_"
        segments.append(
            {
                "text": word + separator,
                "start": float(row["word_start"]),
                "end": float(row["word_end"]),
            }
        )
    return {"version": 2, "voices": {"Voice 1": segments}}


if __name__ == "__main__":
    main()
