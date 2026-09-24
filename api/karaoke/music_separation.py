import gc
import json
import logging
import subprocess
import sys
import tempfile
import traceback
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from api import settings
from api.karaoke import audio_input, separation_progress
from api.karaoke.separation_progress import ProgressCallback

"""
Music Separation Module

This module provides two methods for separating audio tracks into vocals and accompaniment:

1. **API Method** (_split_song_api): Uses the audio-separator Python library directly
   - Fastest for development and testing
   - Limited to available system memory
   - Runs in the current Python process

2. **CLI Method** (_split_song_cli): Uses the audio-separator command-line tool
   - Better memory management through subprocess isolation
   - Consistent with production deployment patterns
   - Requires audio-separator CLI to be installed

split_song() runs whichever method it is given.
"""

DEFAULT_MODEL = "UVR_MDXNET_KARA_2.onnx"

AVAILABLE_MODELS = [
    "UVR_MDXNET_KARA_2.onnx",  # Keeps background vocals
    "UVR-MDX-NET-Inst_HQ_3.onnx",  # Removes background vocals
    # High-quality karaoke Roformers (keep backing vocals). Best on a GPU,
    # but they run on CPU too, at minutes per song.
    "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt",
    "mel_band_roformer_karaoke_becruily.ckpt",
    # BS-Roformer instrumental (removes backing vocals). Highest reported SDR overall;
    # heaviest of the bunch.
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
]


class SeparationMethod(Enum):
    API = "api"
    CLI = "cli"


def _validate_model(model_name: str) -> None:
    """Validate that the model name is in the list of available models."""
    if model_name not in AVAILABLE_MODELS:
        raise ValueError(
            f"Model {model_name} not found. Available models: {AVAILABLE_MODELS}"
        )


@dataclass(frozen=True)
class SeparationResult:
    accompaniment: Path
    vocals: Path


def get_output_paths(song_dir: Path) -> SeparationResult:
    """Return the paths a separation into song_dir is expected to produce.

    The one place the output names are spelled.
    """
    extension = settings.SEPARATION_OUTPUT_FORMAT
    return SeparationResult(
        accompaniment=song_dir / f"accompaniment.{extension}",
        vocals=song_dir / f"vocals.{extension}",
    )


def _split_song_api(
    songfile: Path,
    song_dir: Path,
    model_name: str,
    on_progress: ProgressCallback | None = None,
) -> SeparationResult:
    """Split song using the audio_separator Python API."""
    output_names = {
        "Vocals": "vocals",
        "Instrumental": "accompaniment",
    }

    # Opened before the import: pulling in torch and building the separator take seconds of their own,
    # and the stage is what the client shows meanwhile.
    with (
        separation_progress.reporting(on_progress) as progress,
        tempfile.TemporaryDirectory(dir=song_dir) as conversion_dir,
    ):
        if audio_input.needs_conversion(songfile):
            progress.stage(separation_progress.CONVERTING_STAGE)
            songfile = audio_input.to_flac(songfile, Path(conversion_dir))

        progress.stage(separation_progress.LOADING_STAGE)
        try:
            _run_separator(songfile, song_dir, model_name, output_names, progress)
        except BaseException as e:
            # The traceback's frames keep the separator, and its model on the GPU, alive.
            traceback.clear_frames(e.__traceback__)
            raise
        finally:
            _release_gpu_memory()

    return get_output_paths(song_dir)


def _run_separator(
    songfile: Path,
    song_dir: Path,
    model_name: str,
    output_names: dict[str, str],
    progress: separation_progress._Tracker,
) -> None:
    """Load the model and separate the song with it.

    A function of its own so that the separator is unreferenced once it returns.
    """
    from audio_separator.separator import Separator

    separator = Separator(
        output_dir=str(song_dir),
        model_file_dir=str(settings.MODELS_DIR),
        output_format=settings.SEPARATION_OUTPUT_FORMAT,
    )
    separator.load_model(model_name)

    progress.stage(separation_progress.READING_STAGE)
    # separate() logs and swallows any exception, a cancellation included,
    # and returns as if it had written the stems.
    separator._separate_file(str(songfile), output_names)


def _release_gpu_memory() -> None:
    """Hand back the GPU memory torch keeps reserved after a separation.

    torch caches freed memory for its own reuse. In a process that outlives the
    separation, ONNX Runtime then cannot allocate from it, and the next ONNX
    model fails for lack of GPU memory.
    """
    torch = sys.modules.get("torch")
    if torch is None or not torch.cuda.is_available():
        return
    gc.collect()
    torch.cuda.empty_cache()


def _split_song_cli(
    songfile: Path, song_dir: Path, model_name: str
) -> SeparationResult:
    """Split song using the audio-separator command-line tool."""
    output_names = {
        "Vocals": "vocals",
        "Instrumental": "accompaniment",
    }

    cmd = [
        "audio-separator",
        str(songfile),
        "--output_dir",
        str(song_dir),
        "--model_file_dir",
        str(settings.MODELS_DIR),
        "--model_filename",
        model_name,
        "--output_format",
        settings.SEPARATION_OUTPUT_FORMAT,
        "--custom_output_names",
        json.dumps(output_names),
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        logging.info(f"audio-separator output: {result.stdout}")
    except subprocess.CalledProcessError as e:
        logging.error(f"audio-separator failed: {e.stderr}")
        raise
    except FileNotFoundError:
        logging.error(
            "audio-separator command not found. Please install audio-separator CLI tool."
        )
        raise

    return get_output_paths(song_dir)


def split_song(
    songfile: Path,
    song_dir: Path,
    model_name: str = DEFAULT_MODEL,
    method: SeparationMethod = SeparationMethod.API,
    on_progress: ProgressCallback | None = None,
) -> SeparationResult:
    """
    Split song into instrumental and vocal tracks.
    Returns the paths to the accompaniment and vocal tracks.

    Args:
        songfile: Path to the input audio file
        song_dir: Directory to save the separated tracks
        model_name: Name of the separation model to use
        method: SeparationMethod enum value
        on_progress: Called with (fraction, stage) as the separation advances.
            Only the API method reports. The CLI does its work in a process
            that carries no progress back.
    """
    _validate_model(model_name)

    if method == SeparationMethod.API:
        result = _split_song_api(songfile, song_dir, model_name, on_progress)
    elif method == SeparationMethod.CLI:
        result = _split_song_cli(songfile, song_dir, model_name)
    else:
        raise ValueError(
            f"Invalid method '{method}'. Must be SeparationMethod.API or SeparationMethod.CLI"
        )

    logging.info(
        f"Got vocals: {result.vocals.name}, Accompaniment: {result.accompaniment.name}"
    )
    return result
