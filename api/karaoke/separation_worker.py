"""One separation, in a child process, reporting its progress over a pipe.

Torch is imported here rather than in the web server, so the memory a
separation holds is given back when this exits. Progress is why this exists
rather than the stock audio-separator CLI, which reports nothing a caller can
read.

Spawned by SubprocessBackend as

    python -m api.karaoke.separation_worker <backend> <songfile> <song_dir> <model>

with the writable end of a pipe inherited as TUUL_PROGRESS_FD. One JSON object
per line goes down it, a run of progress reports followed by a single result.
Everything else this has to say goes to stderr, which the parent reads only
when the exit status is non-zero.
"""

import json
import os
import sys
from pathlib import Path

from api.karaoke.separation_backends import PROGRESS_FD_ENV, get_backend


def main(argv: list[str]) -> None:
    backend_name, songfile, song_dir, model_name = argv

    with os.fdopen(int(os.environ[PROGRESS_FD_ENV]), "w") as reports:

        def send(report: dict) -> None:
            reports.write(json.dumps(report) + "\n")
            reports.flush()

        result = get_backend(backend_name).separate(
            Path(songfile),
            Path(song_dir),
            model_name,
            on_progress=lambda progress, stage: send(
                {"progress": progress, "stage": stage}
            ),
        )

        send(
            {
                "result": {
                    "accompaniment": str(result.accompaniment),
                    "vocals": str(result.vocals),
                }
            }
        )


if __name__ == "__main__":
    main(sys.argv[1:])
