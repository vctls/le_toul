"""Conversion of songs that audio-separator cannot read on its own.

audio-separator reads its input with libsndfile, which covers WAV, FLAC, AIFF,
Ogg and MP3. Anything else, MP4 and WebM among them, goes to librosa's
audioread fallback, which librosa deprecated and removes in 1.0. Converting
those songs to FLAC first keeps every input on the libsndfile path.
"""

import subprocess
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)


def needs_conversion(songfile: Path) -> bool:
    """Return whether libsndfile cannot open the song."""
    import soundfile

    try:
        soundfile.info(str(songfile))
    except RuntimeError:
        return True
    return False


def to_flac(songfile: Path, work_dir: Path) -> Path:
    """Convert the song's first audio stream to 16-bit FLAC in work_dir.

    Returns the song unchanged if ffmpeg is missing or cannot decode it,
    so audio-separator still gets its own try at the file.
    """
    target = work_dir / f"{songfile.stem}.flac"
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(songfile),
        "-map",
        "0:a:0",
        "-c:a",
        "flac",
        # A lossy source decodes to float, which ffmpeg would store as 24-bit,
        # and audio-separator writes its stems at the input's bit depth.
        "-sample_fmt",
        "s16",
        str(target),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        logger.warning("song_conversion_skipped", reason="ffmpeg not found")
        return songfile
    except subprocess.CalledProcessError as e:
        logger.warning(
            "song_conversion_failed", song=songfile.name, stderr=e.stderr.strip()
        )
        return songfile

    logger.info("song_converted", song=songfile.name, target=target.name)
    return target
