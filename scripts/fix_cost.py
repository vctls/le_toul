"""Estimate the work a sync leaves to fix by hand, and rank syncing configurations by it.

    uv run python scripts/fix_cost.py ROWS... [--sweep] [--per-song] [--flags both]

Each ROWS file is what `scripts/align.py --rows` wrote for one configuration, which takes the
file's name. Only the voices every file holds are compared, and songs with several voices
are left out unless --all-voices is given, since syncing them is off in the MVP.

A voice's cost is a model of the user fixing it in the app:

- One Shift all timings when the bias is over 50 ms. The bias is then taken out.
- A start further than the tolerance from the hand timing is wrong, and so is a hole.
- Each line is fixed the cheaper way, by dragging each wrong start or by re-tapping the line.
  Lines to re-tap in a row are one pass when playing on costs less than a new pass.
- A trusting reviewer listens to the flagged lines only, and what they don't flag stays
  wrong in the video. A thorough reviewer listens to the whole voice and fixes everything.
- Hand line anchors cost one tapping pass over the voice.

The costs are in seconds and compared with a floor for timing the voice by hand: one tapping
pass and one listen, twice its length. The constants are guesses, so --sweep checks whether
the ranking holds over a range of them.
"""

import argparse
import collections
import itertools
import json
import re
import statistics
import sys
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

# Shift all timings is worth a step only past this bias.
_SHIFT_ABOVE = 0.05
# A line whose synced start is further than this from its LRC line, after the record's
# offset, is flagged.
_LRC_DISAGREES = 1.0
# How long a line's last syllable lasts when the hand timings give it no end.
_LAST_SYLLABLE = 0.5
# Syllables the aligner is this sure of show how far the user's own taps stray.
_CONFIDENT = 0.5
# A line left with a start this far off is a defect anyone watching would notice.
_FAR = 1.0


@dataclass(frozen=True)
class Costs:
    tolerance: float = 0.15
    drag: float = 5.0
    retry: float = 1.3
    preroll: float = 2.0
    rate: float = 1.0
    # Choosing where a re-tap pass starts.
    head: float = 3.0
    shift: float = 20.0
    # Deciding whether a flagged line is right, after hearing it.
    decide: float = 2.0
    # Mark as checked, on a flagged line that is right.
    check: float = 1.0
    # A thorough reviewer stopping playback for each line to fix.
    stop: float = 2.0


@dataclass
class Line:
    start: float
    end: float
    wrong: int
    far: bool
    flagged: bool
    drags: float = 0.0
    retap: bool = False


@dataclass
class VoiceCost:
    set: str
    name: str
    span: float
    lines: int
    wrong_lines: int
    flagged: int
    flagged_wrong: int
    trusting: float
    thorough: float
    defect_lines: int
    far_defect_lines: int
    retap_seconds: float
    drags: int

    @property
    def floor(self) -> float:
        return 2 * self.span


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("rows", nargs="+", type=Path)
    parser.add_argument("--flags", choices=["both", "confidence", "lrc", "none"])
    parser.add_argument("--all-voices", action="store_true")
    parser.add_argument("--per-song", action="store_true")
    parser.add_argument(
        "--sweep", action="store_true", help="check the ranking over ranges of costs"
    )
    args = parser.parse_args()
    flags = args.flags or "both"

    configs = {path.stem: _voices(path) for path in args.rows}
    common = set.intersection(*(set(v) for v in configs.values()))
    if not args.all_voices:
        songs = collections.Counter(song for song, _ in common)
        common = {key for key in common if songs[key[0]] == 1}
    configs = {
        name: {k: v for k, v in voices.items() if k in common}
        for name, voices in configs.items()
    }
    print(f"{len(common)} voices compared, flags from {flags}")
    _accepted_spread(next(iter(configs.values())))

    costs = Costs()
    results = {
        name: [_cost(key, rows, costs, flags) for key, rows in sorted(voices.items())]
        for name, voices in configs.items()
    }
    for set_name in sorted({r.set for rs in results.values() for r in rs}) + [None]:
        _report(set_name, results)
    if args.per_song:
        _per_song(results)
    if args.sweep:
        _sweep(configs, flags)


def _voices(path: Path) -> dict[tuple[str, str], list[dict]]:
    voices = collections.defaultdict(list)
    for line in path.open():
        row = json.loads(line)
        voices[(row["song"], row["voice"])].append(row)
    return voices


def _set(song: str) -> str:
    if song.endswith((".mp4", ".mkv")):
        return "hand-timed"
    if re.match(r"(fre|eng|jpn|ger|spa)_[0-9a-f]{8}_", song):
        return "kara.moe"
    return "jamendo"


def _cost(
    key: tuple[str, str], rows: list[dict], costs: Costs, flags: str
) -> VoiceCost:
    """Price the fixing of one synced voice against its hand timings."""
    timed = [r for r in rows if r["handStart"] is not None]
    synced = [r for r in timed if r["anchor"] != "hand"]
    gaps = [r["start"] - r["handStart"] for r in synced if r["start"] is not None]
    bias = statistics.median(gaps) if gaps else 0.0
    shift = costs.shift if abs(bias) > _SHIFT_ABOVE else 0.0

    lrc_offset = _lrc_offset(rows)
    lines = []
    for _, group in itertools.groupby(timed, key=lambda r: r["line"]):
        group = list(group)
        first = group[0]
        wrong = sum(
            r["anchor"] != "hand"
            and (
                r["start"] is None
                or abs(r["start"] - bias - r["handStart"]) > costs.tolerance
            )
            for r in group
        )
        far = any(
            r["anchor"] != "hand"
            and (r["start"] is None or abs(r["start"] - bias - r["handStart"]) > _FAR)
            for r in group
        )
        doubtful = flags in ("both", "confidence") and any(r["doubtful"] for r in group)
        disagrees = (
            flags in ("both", "lrc")
            and lrc_offset is not None
            and first["lrcStart"] is not None
            and (
                first["start"] is None
                or abs(first["start"] - first["lrcStart"] - lrc_offset) > _LRC_DISAGREES
            )
        )
        lines.append(
            Line(
                start=min(r["handStart"] for r in group),
                end=max(
                    r["handEnd"]
                    if r["handEnd"] is not None
                    else r["handStart"] + _LAST_SYLLABLE
                    for r in group
                ),
                wrong=wrong,
                far=far,
                flagged=doubtful or disagrees,
            )
        )
    for line in lines:
        drags = line.wrong * costs.drag
        retap = _pass(costs, line.end - line.start)
        line.retap = line.wrong > 0 and retap < drags
        line.drags = 0.0 if line.retap or not line.wrong else drags

    span = lines[-1].end - lines[0].start if lines else 0.0
    anchors = (
        costs.preroll + span / costs.rate
        if any(r["anchor"] == "hand" for r in rows)
        else 0.0
    )
    flagged = [line for line in lines if line.flagged]
    review = sum(
        costs.preroll
        + (line.end - line.start) / costs.rate
        + costs.decide
        + (costs.check if not line.wrong else 0.0)
        for line in flagged
    )
    wrong = [line for line in lines if line.wrong]
    listen = span + costs.stop * len(wrong)
    retaps_all, retap_seconds = _retaps(wrong, costs)
    retaps_flagged, _ = _retaps([line for line in flagged if line.wrong], costs)
    return VoiceCost(
        set=_set(key[0]),
        name=key[0] if key[1] in ("Voice 1", "1") else f"{key[0]} [{key[1]}]",
        span=span,
        lines=len(lines),
        wrong_lines=len(wrong),
        flagged=len(flagged),
        flagged_wrong=sum(1 for line in flagged if line.wrong),
        trusting=anchors
        + shift
        + review
        + retaps_flagged
        + sum(line.drags for line in flagged),
        thorough=anchors + shift + listen + retaps_all + sum(x.drags for x in lines),
        defect_lines=sum(1 for line in wrong if not line.flagged),
        far_defect_lines=sum(1 for line in wrong if line.far and not line.flagged),
        retap_seconds=retap_seconds,
        drags=sum(line.wrong for line in lines if line.drags),
    )


def _lrc_offset(rows: list[dict]) -> float | None:
    """Return the median gap between the synced line starts and their LRC lines."""
    gaps = [
        r["start"] - r["lrcStart"]
        for r in rows
        if r["lrcStart"] is not None and r["start"] is not None
    ]
    return statistics.median(gaps) if gaps else None


def _pass(costs: Costs, seconds: float) -> float:
    return (costs.preroll + seconds / costs.rate) * costs.retry + costs.head


def _retaps(lines: list[Line], costs: Costs) -> tuple[float, float]:
    """Return the cost of re-tapping these lines, and the seconds of song re-tapped.

    A pass plays on into the next line to re-tap when that costs less than starting a new
    pass there.
    """
    cost = 0.0
    seconds = 0.0
    current: tuple[float, float] | None = None
    for line in (line for line in lines if line.retap):
        if current is not None:
            gap = (line.start - current[1]) / costs.rate * costs.retry
            if gap < costs.preroll * costs.retry + costs.head:
                current = (current[0], line.end)
                continue
            cost += _pass(costs, current[1] - current[0])
            seconds += current[1] - current[0]
        current = (line.start, line.end)
    if current is not None:
        cost += _pass(costs, current[1] - current[0])
        seconds += current[1] - current[0]
    return cost, seconds


def _accepted_spread(voices: dict[tuple[str, str], list[dict]]) -> None:
    """Print how far the hand-timed starts stray from the confident synced ones.

    The user exported those timings as good enough, so this is a tolerance they accept.
    """
    errors = []
    for (song, _), rows in voices.items():
        if _set(song) != "hand-timed":
            continue
        gaps = [
            r["start"] - r["handStart"]
            for r in rows
            if r["anchor"] is None
            and r["start"] is not None
            and r["handStart"] is not None
        ]
        if not gaps:
            continue
        bias = statistics.median(gaps)
        errors += [
            abs(r["start"] - bias - r["handStart"])
            for r in rows
            if r["anchor"] is None
            and r["start"] is not None
            and r["handStart"] is not None
            and (r["confidence"] or 0) >= _CONFIDENT
        ]
    if errors:
        p50, p90, p95 = np.percentile(errors, [50, 90, 95]) * 1000
        print(
            f"hand-timed starts against confident synced ones, {len(errors)} syllables: "
            f"median {p50:.0f} ms, p90 {p90:.0f} ms, p95 {p95:.0f} ms"
        )


def _summary(voices: list[VoiceCost]) -> dict[str, float]:
    lines = sum(v.lines for v in voices)
    wrong = sum(v.wrong_lines for v in voices)
    flagged = sum(v.flagged for v in voices)
    minutes = sum(v.span for v in voices) / 60
    return {
        "trusting": statistics.median(v.trusting / v.floor for v in voices),
        "thorough": statistics.median(v.thorough / v.floor for v in voices),
        "over": np.mean([v.thorough > v.floor for v in voices]),
        "wrong": wrong / lines,
        "defects": sum(v.defect_lines for v in voices) / lines,
        "far": sum(v.far_defect_lines for v in voices) / lines,
        "flagged": flagged / lines,
        "precision": sum(v.flagged_wrong for v in voices) / flagged if flagged else 0.0,
        "recall": sum(v.flagged_wrong for v in voices) / wrong if wrong else 1.0,
        "retap": sum(v.retap_seconds for v in voices) / 60 / minutes,
        "drags": sum(v.drags for v in voices) / minutes,
    }


def _report(set_name: str | None, results: dict[str, list[VoiceCost]]) -> None:
    rows = {
        name: [v for v in voices if set_name is None or v.set == set_name]
        for name, voices in results.items()
    }
    count = len(next(iter(rows.values())))
    if not count:
        return
    print(
        f"\n{set_name or 'All sets'}, {count} voices. Costs as a share of the hand floor."
    )
    print(
        f"  {'configuration':16} {'trusting':>8} {'thorough':>8} {'over floor':>10} "
        f"{'lines wrong':>11} {'left wrong':>10} {'over 1 s':>8} {'flagged':>7} {'precision':>9} "
        f"{'recall':>6} {'re-tap':>6} {'drags/min':>9}"
    )
    for name, voices in rows.items():
        s = _summary(voices)
        print(
            f"  {name:16} {s['trusting']:8.0%} {s['thorough']:8.0%} {s['over']:10.0%} "
            f"{s['wrong']:11.1%} {s['defects']:10.1%} {s['far']:8.1%} {s['flagged']:7.1%} "
            f"{s['precision']:9.0%} {s['recall']:6.0%} {s['retap']:6.1%} "
            f"{s['drags']:9.1f}"
        )


def _per_song(results: dict[str, list[VoiceCost]]) -> None:
    names = list(results)
    print("\nThorough cost per voice, as a share of the hand floor")
    print(f"  {'':44}" + "".join(f"{n[:12]:>13}" for n in names))
    for i, voice in enumerate(results[names[0]]):
        cells = "".join(
            f"{results[n][i].thorough / results[n][i].floor:13.0%}" for n in names
        )
        print(f"  {voice.set[:10]:10} {voice.name[:33]:33}{cells}")


def _sweep(configs: dict[str, dict], flags: str) -> None:
    """Rank the configurations over a grid of costs, and say where the ranking changes."""
    grid = itertools.product((0.1, 0.15, 0.2, 0.3), (3.0, 5.0, 10.0), (1.0, 1.3, 2.0))
    rankings = collections.defaultdict(list)
    for tolerance, drag, retry in grid:
        costs = replace(Costs(), tolerance=tolerance, drag=drag, retry=retry)
        summaries = {
            name: _summary(
                [_cost(key, rows, costs, flags) for key, rows in sorted(voices.items())]
            )
            for name, voices in configs.items()
        }
        for reviewer in ("thorough", "trusting"):
            ranking = tuple(sorted(summaries, key=lambda n: summaries[n][reviewer]))
            rankings[reviewer].append(((tolerance, drag, retry), ranking))
    for reviewer, results in rankings.items():
        counts = collections.Counter(ranking for _, ranking in results)
        print(
            f"\nRanking by the {reviewer} reviewer's cost, over {len(results)} sets of costs"
        )
        for ranking, count in counts.most_common():
            where = [p for p, r in results if r == ranking]
            print(f"  {count:3}x  {' < '.join(ranking)}")
            if count < len(results):
                print(f"        at tolerance, drag, retry: {where[:6]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)
    main()
