import base64
import json
import logging
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import httpx

from api.karaoke import separation_progress
from api.karaoke.separation_progress import ProgressCallback

"""
Music Separation Module

This module provides multiple methods for separating audio tracks into vocals and accompaniment:

1. **API Method** (_split_song_api): Uses the audio-separator Python library directly
   - Fastest for development and testing
   - Limited to available system memory
   - Runs in the current Python process

2. **CLI Method** (_split_song_cli): Uses the audio-separator command-line tool
   - Better memory management through subprocess isolation
   - Consistent with production deployment patterns
   - Requires audio-separator CLI to be installed

3. **TCP Method** (_split_song_tcp): Communicates with external separation server via TCP
   - Enables GPU acceleration on remote/host machines
   - Useful for containerized deployments where GPU access is limited
   - Requires a running separator server on localhost

The main split_song() function automatically selects the appropriate method based on parameters.
"""

MODELS_DIR = Path(__file__).parent.parent / "pretrained_models"
DEFAULT_MODEL = "UVR_MDXNET_KARA_2.onnx"

AVAILABLE_MODELS = [
    "UVR_MDXNET_KARA_2.onnx",  # Keeps background vocals
    "UVR-MDX-NET-Inst_HQ_3.onnx",  # Removes background vocals
    # High-quality karaoke Roformers (keep backing vocals). GPU-friendly via Modal/TCP;
    # runs on CPU too but takes minutes per song.
    "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt",
    "mel_band_roformer_karaoke_becruily.ckpt",
    # BS-Roformer instrumental (removes backing vocals). Highest reported SDR overall;
    # heaviest of the bunch.
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
]


class SeparationMethod(Enum):
    API = "api"
    CLI = "cli"
    MODAL_API = "modal_api"


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
    return SeparationResult(
        accompaniment=song_dir / "accompaniment.wav",
        vocals=song_dir / "vocals.wav",
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
    with separation_progress.reporting(on_progress) as progress:
        progress.stage(separation_progress.LOADING_STAGE)

        from audio_separator.separator import Separator

        separator = Separator(
            output_dir=str(song_dir),
            model_file_dir=str(MODELS_DIR),
        )
        separator.load_model(model_name)

        progress.stage(separation_progress.READING_STAGE)
        separator.separate(str(songfile), output_names)

    return get_output_paths(song_dir)


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
        str(MODELS_DIR),
        "--model_filename",
        model_name,
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


def _split_song_tcp(
    songfile: Path, song_dir: Path, model_name: str, host: str, port: int
) -> SeparationResult:
    """Split song using external separation server via TCP."""
    # Read and encode the input file
    audio_data = songfile.read_bytes()
    audio_base64 = base64.b64encode(audio_data).decode("utf-8")

    # Prepare request payload
    request_data = {
        "model_name": model_name,
        "audio_base64": audio_base64,
        "filename": songfile.name,
    }

    # Make request to separation server via TCP
    try:
        with httpx.Client() as client:
            response = client.post(
                f"http://{host}:{port}/separate", json=request_data, timeout=300
            )
            response.raise_for_status()

        result = response.json()

        if not result.get("success"):
            error_msg = result.get("error", "Unknown error")
            raise RuntimeError(f"Socket separation failed: {error_msg}")

        # Decode and write output files
        vocals_data = base64.b64decode(result["vocals_base64"])
        accompaniment_data = base64.b64decode(result["accompaniment_base64"])

        paths = get_output_paths(song_dir)
        paths.vocals.write_bytes(vocals_data)
        paths.accompaniment.write_bytes(accompaniment_data)

        return paths

    except httpx.RequestError as e:
        raise RuntimeError(
            f"Separation server unreachable at {host}:{port}: {e}"
        ) from e


def _split_song_modal_api(
    songfile: Path, song_dir: Path, model_name: str, api_url: str
) -> SeparationResult:
    """Split song using the remote Modal API separation service with AudioSeparatorAPIClient."""
    from audio_separator.remote import AudioSeparatorAPIClient

    api_client = AudioSeparatorAPIClient(api_url, logging.getLogger(__name__))

    result = api_client.separate_audio_and_wait(
        str(songfile),
        model=model_name,
        timeout=600,
        poll_interval=5,
        download=True,
        output_dir=str(song_dir),
        output_format="wav",
        custom_output_names={"Vocals": "vocals", "Instrumental": "accompaniment"},
    )

    if result["status"] != "completed":
        raise RuntimeError(
            f"Modal API separation failed: {result.get('error', 'Unknown error')}"
        )

    # The client downloads into song_dir under the custom output names.
    paths = get_output_paths(song_dir)
    if not paths.vocals.exists() or not paths.accompaniment.exists():
        raise RuntimeError("Expected output files not found after separation")

    return paths


def split_song(
    songfile: Path,
    song_dir: Path,
    model_name: str = DEFAULT_MODEL,
    method: SeparationMethod = SeparationMethod.API,
    host: str | None = None,
    port: int | None = None,
    modal_api_url: str | None = None,
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
        host: Host for external separation server
        port: TCP port for external separation server (host+port overrides method if provided)
        api_url: URL for Modal API separation (overrides method if provided)
        on_progress: Called with (fraction, stage) as the separation advances.
            Only the API method reports; the others do their work behind a
            process or a network boundary that carries no progress back.
    """
    _validate_model(model_name)

    # TCP host+port takes precedence over method
    if host and port:
        result = _split_song_tcp(songfile, song_dir, model_name, host, port)
    elif method == SeparationMethod.API:
        result = _split_song_api(songfile, song_dir, model_name, on_progress)
    elif method == SeparationMethod.CLI:
        result = _split_song_cli(songfile, song_dir, model_name)
    elif method == SeparationMethod.MODAL_API:
        if not modal_api_url:
            raise ValueError(
                "API_URL must be configured in settings or provided as parameter for MODAL_API method"
            )
        result = _split_song_modal_api(songfile, song_dir, model_name, modal_api_url)
    else:
        raise ValueError(
            f"Invalid method '{method}'. Must be SeparationMethod.API, SeparationMethod.CLI, or SeparationMethod.MODAL_API"
        )

    logging.info(
        f"Got vocals: {result.vocals.name}, Accompaniment: {result.accompaniment.name}"
    )
    return result
