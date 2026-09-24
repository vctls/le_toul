#!/usr/bin/env python3
"""
FastAPI app for GPU-accelerated music separation on host machine.

This server runs on the host (outside Docker) to provide GPU access for music separation.
The containerized Tuul app communicates with this server via TCP on localhost.
"""

import base64
import logging
import subprocess
import tempfile
from pathlib import Path

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import app_logging, settings

# Import model constants and split_song function from the main separation module for DRY
from .karaoke.music_separation import (
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    SeparationMethod,
    split_song,
)

# Setup logging
logging.basicConfig(level=logging.INFO)
app_logging.setup()
logger = structlog.get_logger(__name__)

app = FastAPI(title="Separator Socket API", version="1.0.0")


class SeparationRequest(BaseModel):
    model_name: str = DEFAULT_MODEL
    audio_base64: str
    filename: str = "audio.wav"


class SeparationResponse(BaseModel):
    success: bool
    vocals_base64: str | None = None
    accompaniment_base64: str | None = None
    vocals_filename: str | None = None
    accompaniment_filename: str | None = None
    error: str | None = None


@app.post("/separate", response_model=SeparationResponse)
async def separate_track(request: SeparationRequest):
    """
    Separate audio track into vocals and accompaniment using subprocess.

    This endpoint processes separation requests using the audio-separator CLI tool
    in a subprocess to ensure proper memory cleanup and GPU utilization.
    """
    logger.info(
        "separation_request", model_name=request.model_name, filename=request.filename
    )

    # Validate model
    if request.model_name not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Model {request.model_name} not found. Available: {AVAILABLE_MODELS}",
        )

    # Decode audio from base64
    try:
        audio_data = base64.b64decode(request.audio_base64)
    except Exception as e:
        logger.error("base64_decode_failed", error=str(e))
        raise HTTPException(
            status_code=400, detail=f"Invalid base64 audio data: {e}"
        ) from e

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Write input audio file
        input_file = temp_path / request.filename
        with input_file.open("wb") as f:
            f.write(audio_data)

        logger.info(
            "processing_separation",
            model=request.model_name,
            input_size=len(audio_data),
            input_file=str(input_file),
        )

        try:
            separated = split_song(
                input_file, temp_path, request.model_name, method=SeparationMethod.API
            )

            logger.info(
                "separation_completed",
                vocals=separated.vocals.name,
                accompaniment=separated.accompaniment.name,
            )

            return SeparationResponse(
                success=True,
                vocals_base64=base64.b64encode(separated.vocals.read_bytes()).decode(
                    "utf-8"
                ),
                accompaniment_base64=base64.b64encode(
                    separated.accompaniment.read_bytes()
                ).decode("utf-8"),
                vocals_filename=separated.vocals.name,
                accompaniment_filename=separated.accompaniment.name,
            )

        except subprocess.CalledProcessError as e:
            logger.error(
                "separation_subprocess_failed", stderr=e.stderr, returncode=e.returncode
            )
            return SeparationResponse(
                success=False, error=f"Separation failed: {e.stderr}"
            )
        except FileNotFoundError as fnf:
            logger.error("audio_separator_not_found", str(fnf))
            return SeparationResponse(
                success=False,
                error="audio-separator command not found. Please install audio-separator CLI tool.",
            )
        except Exception as e:
            logger.error("separation_error", error=str(e))
            return SeparationResponse(success=False, error=str(e))


if __name__ == "__main__":
    # This won't be used since we'll run with uvicorn, but helpful for testing
    import uvicorn

    uvicorn.run(app, host="localhost", port=settings.SEPARATOR_PORT, log_level="info")
