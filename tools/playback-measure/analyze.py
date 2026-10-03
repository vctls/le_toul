"""Compare what was recorded with the song, rectangle by rectangle.

Usage: analyze.py NAME SONG.f32

Reads NAME.f32 and NAME_log.npy from record.py, and NAME_browser.json from clicks.js. SONG.f32
is the song decoded to mono at 48 kHz.

At 1x the recording matches the song sample for sample, so each sound is located in the song
exactly. Slowed down, it no longer does, and the loudness envelopes are matched instead, to the
millisecond at best.
"""

import json
import sys

import numpy as np

SAMPLE_RATE = 48000
# Sounds further apart than this are separate clicks.
GAP = 0.3
ENVELOPE_HOP = SAMPLE_RATE // 1000


def system_clock(log: np.ndarray):
    """Map recording samples to system time and back.

    A chunk never arrives before its last sample has been played, so the earliest arrival
    for each second of samples, fitted with a line, gives when each sample was played.
    """
    offsets = log[:, 0] - log[:, 1] / SAMPLE_RATE
    seconds = (log[:, 1] // SAMPLE_RATE).astype(int)
    xs, ys = [], []
    for second in np.unique(seconds):
        rows = seconds == second
        i = np.argmin(offsets[rows])
        xs.append(log[rows, 1][i])
        ys.append(offsets[rows][i])
    slope, intercept = np.polyfit(xs, ys, 1)

    def time_of(sample):
        return intercept + slope * sample + sample / SAMPLE_RATE

    def sample_at(time):
        return (time - intercept) / (1 / SAMPLE_RATE + slope)

    return time_of, sample_at


def sounds(recording: np.ndarray) -> list[tuple[int, int]]:
    """The first and last sample of each stretch of sound."""
    loud = np.flatnonzero(np.abs(recording) > 1e-5)
    if not len(loud):
        return []
    gaps = np.flatnonzero(np.diff(loud) > GAP * SAMPLE_RATE)
    return list(
        zip(np.r_[loud[0], loud[gaps + 1]], np.r_[loud[gaps], loud[-1]], strict=True)
    )


def locate(recording, song, first, guess, length):
    """The offset from song samples to recording samples over recording[first:first + length],
    searched for within a second of song sample `guess`, and how well it matches."""
    window = recording[first : first + length]
    low = max(0, guess - SAMPLE_RATE)
    stretch = song[low : guess + SAMPLE_RATE + length]
    match = np.correlate(stretch, window, "valid")
    energy = np.convolve(stretch**2, np.ones(length), "valid") * (window**2).sum()
    scores = match / (np.sqrt(energy) + 1e-12)
    best = int(np.argmax(scores))
    return first - (low + best), float(scores[best])


def envelope(samples: np.ndarray) -> np.ndarray:
    count = len(samples) // ENVELOPE_HOP
    blocks = samples[: count * ENVELOPE_HOP].reshape(count, ENVELOPE_HOP)
    return np.sqrt((blocks**2).mean(1))


def median_ms(values: np.ndarray) -> str:
    return f"{np.median(values) * 1000:+6.1f} ms" if len(values) else "   no frames"


def main() -> None:
    name, song_path = sys.argv[1], sys.argv[2]
    recording = np.fromfile(f"{name}.f32", dtype=np.float32)
    song = np.fromfile(song_path, dtype=np.float32)
    with open(f"{name}_browser.json") as file:
        browser = json.load(file)
    time_of, sample_at = system_clock(np.load(f"{name}_log.npy"))
    rate = browser.get("rate", 1)
    frames = np.array(
        [
            [t / 1000, position, np.nan if drawn is None else drawn]
            for t, position, drawn in browser["frames"]
        ]
    ).reshape(-1, 3)
    found = sounds(recording)
    song_envelope = envelope(song)
    print(f"{len(found)} sounds for {len(browser['clicks'])} clicks, at {rate}x")
    print("position and drawn are the playhead's lead over what was heard, as medians.")

    for (start, end, _), (segment, clicked) in zip(
        browser["ranges"], browser["clicks"], strict=True
    ):
        after = [s for s in found if 0 <= time_of(s[0]) - clicked / 1000 < 0.6]
        if not after:
            print(f"{segment:>4}: no sound after the click")
            continue
        on, off = after[0]
        playing = (frames[:, 0] > time_of(on) + 0.03) & (
            frames[:, 0] < time_of(off) - 0.03
        )
        times = frames[playing, 0]
        if rate == 1:
            length = int(min(4800, max(240, (off - on) // 2)))
            pad = min(480, (off - on - length) // 2)
            first, match_start = locate(
                recording, song, on + pad, int(start * SAMPLE_RATE), length
            )
            last, match_end = locate(
                recording,
                song,
                off - length - pad,
                int(end * SAMPLE_RATE) - length,
                length,
            )
            start_error = (on - first) / SAMPLE_RATE - start
            end_error = (off + 1 - last) / SAMPLE_RATE - end
            timing = (
                f"start {start_error * 1000:+6.1f} ms  end {end_error * 1000:+6.1f} ms"
            )
            timing += f"  match {min(match_start, match_end):.3f}"
            heard = (sample_at(times) - first) / SAMPLE_RATE
        else:
            # The song's envelope from 200 ms before the start, slowed down to the rate, is found
            # in the recording's from 200 ms before the sound.
            a, b = int((start - 0.2) * 1000), int(end * 1000)
            expected = song_envelope[a:b]
            slowed = np.interp(
                np.arange(0, len(expected), rate), np.arange(len(expected)), expected
            )
            lead_in = int(0.2 * SAMPLE_RATE)
            recorded = envelope(recording[on - lead_in : off + lead_in // 2])
            match = np.correlate(
                recorded - recorded.mean(), slowed - slowed.mean(), "full"
            )
            lag = int(np.argmax(match)) - (len(slowed) - 1)
            start_heard_at = time_of(on - lead_in) + (lag + 200 / rate) / 1000
            start_error = (time_of(on) - start_heard_at) * rate
            duration = (off - on) / SAMPLE_RATE
            timing = f"start {start_error * 1000:+6.1f} ms  lasted {duration:.3f} s"
            timing += f" for {(end - start) / rate:.3f} s"
            heard = start + (times - start_heard_at) * rate

        position = median_ms(frames[playing, 1] - heard)
        drawn = frames[playing, 2]
        drawn_lead = median_ms((drawn - heard)[~np.isnan(drawn)])
        print(
            f"{segment:>4} [{start:7.3f}, {end:7.3f}]  {timing}"
            f"  click to sound {(time_of(on) - clicked / 1000) * 1000:5.1f} ms"
            f"  position {position}  drawn {drawn_lead}"
        )


if __name__ == "__main__":
    main()
