"""Conversion of songs that audio-separator cannot read on its own.

audio-separator reads its input with libsndfile, which covers WAV, FLAC, AIFF,
Ogg and MP3. Anything else, MP4 and WebM among them, goes to librosa's
audioread fallback, which librosa deprecated and removes in 1.0. Converting
those songs to FLAC first keeps every input on the libsndfile path.

Only mono and stereo are supported. Audio with more channels, such as a video's
5.1, is converted too, and downmixed to stereo, since the separation models
cannot take it.

The remote client compresses a PCM song to FLAC too, before uploading it. That
one keeps the bit depth and every channel, since the separating host converts
what it has to on its own.
"""

import subprocess
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

# The PCM codecs FLAC holds losslessly. ffmpeg stores 32-bit and float PCM as
# 24-bit FLAC, which would throw away precision.
_FLAC_LOSSLESS_CODECS = {"pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be"}


def needs_conversion(songfile: Path) -> bool:
    """Return whether libsndfile cannot open the song, or it is wider than stereo."""
    import soundfile

    try:
        info = soundfile.info(str(songfile))
    except RuntimeError:
        return True
    return info.channels > 2


def to_flac(songfile: Path, work_dir: Path) -> Path:
    """Convert the song's first audio stream to 16-bit mono or stereo FLAC in work_dir.

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
        # Mono and stereo pass through, and anything wider is downmixed to stereo.
        "-af",
        "aformat=channel_layouts=mono|stereo",
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


def compress_pcm(songfile: Path, work_dir: Path) -> Path:
    """Compress a 16- or 24-bit PCM song, such as a WAV or AIFF, to FLAC in work_dir.

    Returns the song unchanged if it is anything else, or if ffmpeg is missing
    or fails, since the song can still go up as it is.
    """
    if _first_audio_codec(songfile) not in _FLAC_LOSSLESS_CODECS:
        return songfile

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
        str(target),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        logger.warning(
            "song_compression_failed", song=songfile.name, stderr=e.stderr.strip()
        )
        return songfile

    logger.info(
        "song_compressed",
        song=songfile.name,
        size=songfile.stat().st_size,
        compressed_size=target.stat().st_size,
    )
    return target


def _first_audio_codec(songfile: Path) -> str | None:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(songfile),
    ]
    try:
        probe = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        logger.warning("song_compression_skipped", reason="ffprobe not found")
        return None
    except subprocess.CalledProcessError:
        return None
    return probe.stdout.strip() or None
