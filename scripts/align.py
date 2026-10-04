"""Measure an aligner against songs timed by hand.

Each project folder holds a vocals stem (`vocals.*`) and a `timings.txt`, or an
older `timings.json` with its `lyrics.txt`, as the app's project download writes them.
Every segment of every voice is synced, then compared with the hand timings.

    poetry run python scripts/align.py [--aligner mms_fa] [--rows rows.jsonl] PROJECT...
    poetry run python scripts/align.py --search FOLDER

With --anchor-lines, each line's first syllable keeps its hand timing, as if a person
had tapped only the line starts, and the rest of the line is synced around it.

With --lrc, each line that matches a line of the song's synced LRCLIB record is anchored
on its start: softly, as a window to look in, or hard, as a kept start. The records are
the ones scripts/lrc.py saved. --lrc-songs-only leaves out the songs without one.

The rows hold every segment, anchors included, with its line, its doubtful flag and the
start of the LRC line it matches. scripts/fix_cost.py reads them.

A song's bias is the median of its signed start errors. It is reported apart from
the rest of the error, since Shift all timings in Adjust removes it in one step.
"""

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lrc import line_anchors, parse, shifted, synced_lyrics  # noqa: E402

from api.karaoke import alignment  # noqa: E402
from api.karaoke.aligners import aligner_names, get_aligner  # noqa: E402
from api.karaoke.alignment import (  # noqa: E402
    SyncedSegment,
    SyncSegment,
    load_audio,
    sync,
)

_REPO = Path(__file__).resolve().parents[1]
_THRESHOLD_MS = 150
# With --lrc-offset local, each LRC start moves by the median offset of this many
# matched lines on either side of it.
_LOCAL_NEIGHBOURS = 4


@dataclass
class SongResult:
    name: str
    starts: np.ndarray  # signed start errors in seconds, synced minus hand
    ends: np.ndarray
    hand_starts: int
    synced_starts: int
    anchors: int
    doubtful: int
    audio_seconds: float
    elapsed: float
    lines: int = 0
    # Signed LRC line start errors in seconds, LRC minus hand.
    lrc_errors: np.ndarray | None = None

    @property
    def bias(self) -> float:
        return float(np.median(self.starts)) if len(self.starts) else 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("projects", nargs="*", type=Path)
    parser.add_argument(
        "--search",
        type=Path,
        help="also measure every exported project under this folder, the newest of each song",
    )
    parser.add_argument("--aligner", default="mms_fa", choices=aligner_names())
    parser.add_argument(
        "--anchor-lines",
        action="store_true",
        help="keep each line's first syllable at its hand timing, and sync the rest",
    )
    parser.add_argument(
        "--lrc",
        type=Path,
        metavar="CHECK_ROWS",
        help="anchor on the synced records of the songs in these scripts/lrclib_check.py rows",
    )
    parser.add_argument(
        "--lrc-songs-only",
        action="store_true",
        help="measure only the songs that have a synced record",
    )
    parser.add_argument(
        "--lrc-anchors",
        choices=["none", "soft", "hard"],
        default="soft",
        help="how LRC line starts anchor the sync (default: soft)",
    )
    parser.add_argument(
        "--lrc-offset",
        choices=["none", "song", "local"],
        default="song",
        help="move LRC starts by their offset from a first sync without them, "
        "one per song or one per stretch of lines (default: song)",
    )
    parser.add_argument(
        "--soft-margin", type=float, help="seconds a soft anchor is looked around"
    )
    parser.add_argument(
        "--lead",
        type=float,
        help="seconds mms_fa starts a syllable ahead of its onset, to match a reference "
        "timed at the onset (default: the aligner's own)",
    )
    parser.add_argument(
        "--rows", type=Path, help="write every compared segment to this JSON Lines file"
    )
    args = parser.parse_args()
    projects = args.projects + (find_projects(args.search) if args.search else [])
    if not projects:
        parser.error("name a project folder, or a folder to --search")
    sys.stdout.reconfigure(line_buffering=True)

    if args.soft_margin is not None:
        alignment.SOFT_ANCHOR_MARGIN_SECONDS = args.soft_margin
    if args.lead is not None:
        from api.karaoke.aligners import mms_fa

        mms_fa._START_LAG_SECONDS = args.lead
    lrcs = synced_lyrics(args.lrc) if args.lrc else None
    if lrcs is not None and args.lrc_songs_only:
        projects = [p for p in projects if p.name in lrcs]
    aligner = get_aligner(args.aligner)
    rows = args.rows.open("w") if args.rows else None
    results = []
    for project in projects:
        lrc = parse(lrcs[project.name]) if lrcs and project.name in lrcs else None
        for result in measure(
            project,
            aligner,
            rows,
            args.anchor_lines,
            lrc,
            args.lrc_anchors,
            args.lrc_offset,
        ):
            results.append(result)
            print_song(result)
    if rows:
        rows.close()
    print_summary(results)
    if lrcs is not None:
        print_lrc_summary(results)


def find_projects(root: Path) -> list[Path]:
    """Return the project folders under root, the newest where a song has several.

    The app exports a project as a folder named after its video, ending in .mp4 or .mkv.
    Exports of the same song share a parent folder.
    """
    newest: dict[Path, Path] = {}
    for folder in root.rglob("*"):
        if folder.suffix not in (".mp4", ".mkv") or not folder.is_dir():
            continue
        timings = timings_file(folder)
        if timings is None or not any(folder.glob("vocals.*")):
            continue
        current = newest.get(folder.parent)
        if (
            current is None
            or timings.stat().st_mtime > timings_file(current).stat().st_mtime
        ):
            newest[folder.parent] = folder
    return sorted(newest.values())


def timings_file(project: Path) -> Path | None:
    return next(
        (t for t in (project / "timings.txt", project / "timings.json") if t.exists()),
        None,
    )


def measure(
    project: Path,
    aligner,
    rows,
    anchor_lines: bool,
    lrc: list[tuple[float, str]] | None = None,
    lrc_anchors: str = "none",
    lrc_offset: str = "none",
) -> list[SongResult]:
    vocals = next(iter(sorted(project.glob("vocals.*"))), None)
    timings = timings_file(project)
    if vocals is None or timings is None:
        print(
            f"Skipping {project}: it needs a timings file and a vocals stem",
            file=sys.stderr,
        )
        return []

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
    audio = load_audio(vocals, aligner.sample_rate)
    results = []
    for voice, hand in voices.items():
        matched = line_anchors(hand, lrc) if lrc is not None else {}
        lrc_starts = matched
        began = time.monotonic()
        if lrc_starts and lrc_offset != "none":
            first_pass = sync(aligner, audio, [to_sync(h) for h in hand])
            lrc_starts = shifted(
                lrc_starts,
                {i: s.start for i, s in enumerate(first_pass)},
                None if lrc_offset == "song" else _LOCAL_NEIGHBOURS,
            )
        segments = [
            anchored(h) if anchor_lines and _starts_line(hand, i) else to_sync(h)
            for i, h in enumerate(hand)
        ]
        for i, start in lrc_starts.items():
            if not segments[i].sync:
                continue
            if lrc_anchors == "soft":
                segments[i] = SyncSegment(
                    hand[i]["text"], hand[i]["endsLine"], sync=True, near=start
                )
            elif lrc_anchors == "hard":
                segments[i] = SyncSegment(
                    hand[i]["text"], hand[i]["endsLine"], sync=False, start=start
                )
        synced = sync(aligner, audio, segments)
        elapsed = time.monotonic() - began

        starts, ends = [], []
        line = 0
        for i, (h, segment, s) in enumerate(zip(hand, segments, synced, strict=True)):
            anchor = None
            if not segment.sync:
                anchor = "hand" if anchor_lines and _starts_line(hand, i) else "lrc"
                s = SyncedSegment(start=segment.start, end=segment.end)
            # An LRC start kept as it is still lands in the result, and a hand one doesn't.
            if anchor != "hand":
                if h["start"] is not None and s.start is not None:
                    starts.append(s.start - h["start"])
                if h["end"] is not None and s.end is not None:
                    ends.append(s.end - h["end"])
            if rows:
                rows.write(
                    json.dumps(
                        {
                            "song": project.name,
                            "voice": voice,
                            "line": line,
                            "text": h["text"],
                            "endsLine": h["endsLine"],
                            "handStart": h["start"],
                            "handEnd": h["end"],
                            "start": s.start,
                            "end": s.end,
                            "anchor": anchor,
                            "confidence": s.confidence,
                            "doubtful": s.doubtful,
                            "lrcStart": matched.get(i),
                        }
                    )
                    + "\n"
                )
            line += h["endsLine"]
        name = project.name if len(voices) == 1 else f"{project.name} [{voice}]"
        results.append(
            SongResult(
                name=name,
                starts=np.array(starts),
                ends=np.array(ends),
                hand_starts=sum(h["start"] is not None for h in hand),
                synced_starts=sum(s.start is not None for s in synced),
                anchors=sum(not segment.sync for segment in segments),
                doubtful=sum(s.doubtful for s in synced),
                audio_seconds=len(audio) / aligner.sample_rate,
                elapsed=elapsed,
                lines=sum(_starts_line(hand, i) for i in range(len(hand))),
                lrc_errors=None
                if lrc is None
                else np.array(
                    [
                        start - hand[i]["start"]
                        for i, start in lrc_starts.items()
                        if hand[i]["start"] is not None
                    ]
                ),
            )
        )
    return results


def _starts_line(hand: list[dict], i: int) -> bool:
    return hand[i]["start"] is not None and (i == 0 or hand[i - 1]["endsLine"])


def anchored(h: dict) -> SyncSegment:
    return SyncSegment(
        h["text"], h["endsLine"], sync=False, start=h["start"], end=h["end"]
    )


def to_sync(h: dict) -> SyncSegment:
    return SyncSegment(h["text"], h["endsLine"], sync=True)


def print_song(result: SongResult) -> None:
    starts = result.starts
    print(f"\n{result.name}")
    print(
        f"  synced {result.synced_starts} starts, {result.hand_starts} timed by hand, "
        f"{result.anchors} kept as anchors, {len(starts)} compared, {result.doubtful} doubtful"
    )
    print(
        f"  {result.elapsed:.1f} s for {result.audio_seconds:.0f} s of audio "
        f"({result.elapsed / result.audio_seconds:.2f}x)"
    )
    if result.lrc_errors is not None:
        errors = result.lrc_errors
        print(f"  {len(errors)} of {result.lines} lines matched an LRC line", end="")
        if len(errors):
            bias = float(np.median(errors))
            print(
                f", LRC starts: bias {ms(bias)}, |error| raw {quantiles(errors)}, "
                f"unbiased {quantiles(errors - bias)}, "
                f"{int(np.sum(np.abs(errors) > 1))} off by over 1 s"
            )
        else:
            print()
    if not len(starts):
        return
    far = int(np.sum(np.abs(starts) > 1))
    print(
        f"  bias {ms(result.bias)}, signed spread {spread(starts)}, {far} off by over 1 s"
    )
    print(
        f"  start |error|  raw {quantiles(starts)}  unbiased {quantiles(starts - result.bias)}"
    )
    if len(result.ends):
        print(
            f"  end   |error|  raw {quantiles(result.ends)}  ({len(result.ends)} compared)"
        )


def print_summary(results: list[SongResult]) -> None:
    compared = [r for r in results if len(r.starts)]
    if not compared:
        return
    raw = np.concatenate([r.starts for r in compared])
    unbiased = np.concatenate([r.starts - r.bias for r in compared])
    biases = [r.bias for r in compared]
    raw_median = np.median(np.abs(raw)) * 1000
    unbiased_median = np.median(np.abs(unbiased)) * 1000
    print(f"\nAll songs, {len(raw)} starts")
    print(f"  biases {', '.join(ms(b) for b in biases)}")
    print(f"  start |error|  raw {quantiles(raw)}  unbiased {quantiles(unbiased)}")
    passed = min(raw_median, unbiased_median) < _THRESHOLD_MS
    print(
        f"  {'PASS' if passed else 'FAIL'}: median |error| {raw_median:.0f} ms raw, "
        f"{unbiased_median:.0f} ms unbiased, against {_THRESHOLD_MS} ms"
    )


def print_lrc_summary(results: list[SongResult]) -> None:
    matched = [r for r in results if r.lrc_errors is not None and len(r.lrc_errors)]
    if not matched:
        return
    errors = np.concatenate([r.lrc_errors for r in matched])
    unbiased = np.concatenate([r.lrc_errors - np.median(r.lrc_errors) for r in matched])
    lines = sum(r.lines for r in results)
    print(f"\nLRC line starts, {len(errors)} of {lines} lines matched")
    print(f"  biases {', '.join(ms(float(np.median(r.lrc_errors))) for r in matched)}")
    print(f"  |error| raw {quantiles(errors)}  unbiased {quantiles(unbiased)}")
    for limit in (0.3, 0.5, 1.0, 2.0):
        print(
            f"  within {limit} s: raw {np.mean(np.abs(errors) <= limit):.0%}, "
            f"unbiased {np.mean(np.abs(unbiased) <= limit):.0%}"
        )


def ms(seconds: float) -> str:
    return f"{seconds * 1000:+.0f} ms"


def spread(errors: np.ndarray) -> str:
    low, high = np.percentile(errors, [25, 75]) * 1000
    return f"{low:+.0f} to {high:+.0f} ms (middle half)"


def quantiles(errors: np.ndarray) -> str:
    median, p90 = np.percentile(np.abs(errors), [50, 90]) * 1000
    return f"median {median:.0f} ms, p90 {p90:.0f} ms"


if __name__ == "__main__":
    main()
