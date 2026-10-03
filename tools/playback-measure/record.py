"""Record what the default output plays, and when each chunk of it arrives.

Usage: record.py SECONDS NAME

Writes NAME.f32 (mono, 48 kHz, float32) and NAME_log.npy, which pairs the system time each
chunk arrived with the number of samples recorded by then.
"""

import subprocess
import sys
import time

import numpy as np

SAMPLE_RATE = 48000


def default_sink() -> str:
    return subprocess.run(
        ["pactl", "get-default-sink"], capture_output=True, text=True, check=True
    ).stdout.strip()


def main() -> None:
    seconds, name = float(sys.argv[1]), sys.argv[2]
    recorder = subprocess.Popen(
        [
            "pw-record",
            "--latency", "128",
            "-P", "{ stream.capture.sink = true }",
            "--target", default_sink(),
            "--rate", str(SAMPLE_RATE),
            "--channels", "1",
            "--format", "f32",
            "-",
        ],
        stdout=subprocess.PIPE,
        bufsize=0,
    )  # fmt: skip
    chunks, log, samples = [], [], 0
    end = time.time() + seconds
    while time.time() < end:
        chunk = recorder.stdout.read(4096)
        arrived = time.time()
        if not chunk:
            break
        chunks.append(chunk)
        samples += len(chunk) // 4
        log.append((arrived, samples))
    recorder.terminate()
    np.frombuffer(b"".join(chunks), dtype=np.float32).tofile(f"{name}.f32")
    np.save(f"{name}_log.npy", np.array(log))
    print(f"recorded {samples / SAMPLE_RATE:.1f} s")


if __name__ == "__main__":
    main()
