"""
FastAPI application settings.
"""

import os
import tempfile
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv("SECRET_KEY", "frabbaglabba")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.getenv("DEBUG", "True") != "False"

# Google Cloud Storage bucket for caching separated tracks
SEPARATED_TRACKS_BUCKET = os.getenv("SEPARATED_TRACKS_BUCKET", "")

# YouTube proxy settings
YOUTUBE_PROXY = os.getenv("YOUTUBE_PROXY", "")

# Valid values are 'console' or 'gcp'
LOGGING_FORMAT = os.getenv("LOGGING_FORMAT", "console")

# Static files configuration
STATIC_DIR = BASE_DIR / "assets"


# Templates directory
TEMPLATES_DIR = BASE_DIR / "templates"

# CORS settings
CORS_ALLOW_ALL_ORIGINS = True

# Server settings
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "8000"))

# Separator settings (for GPU access on host)
SEPARATOR_HOST = os.getenv("SEPARATOR_HOST", "")
SEPARATOR_PORT = int(os.getenv("SEPARATOR_PORT", "8001"))

# Remote Modal API separation
SEPARATOR_MODAL_API_URL = os.getenv("SEPARATOR_MODAL_API_URL", "")

# Local separation job store, used when SEPARATED_TRACKS_BUCKET is unset. Jobs
# run in the background and the client polls for the result, so no request is
# held open for the length of a separation.
LOCAL_JOB_DIR = Path(
    os.getenv("LOCAL_JOB_DIR", Path(tempfile.gettempdir()) / "tuul_jobs")
)

# How long finished results are kept before being pruned. Each is about the size
# of two uncompressed WAVs. Set to 0 to keep them indefinitely.
LOCAL_JOB_RESULT_TTL_SECONDS = int(
    os.getenv("LOCAL_JOB_RESULT_TTL_SECONDS", str(7 * 24 * 60 * 60))
)

# A job still marked as processing after this long is assumed dead, its worker
# having been killed. Matches the default gunicorn timeout.
LOCAL_JOB_STALE_AFTER_SECONDS = int(os.getenv("LOCAL_JOB_STALE_AFTER_SECONDS", "7200"))
