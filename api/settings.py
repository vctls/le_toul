"""
FastAPI application settings.
"""

import os
import tempfile
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent

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

# Credentials the separator server's /tasks routes require, sent as the
# Modal-Key and Modal-Secret headers. Both empty lets every request through.
SEPARATOR_SERVER_KEY = os.getenv("SEPARATOR_SERVER_KEY", "")
SEPARATOR_SERVER_SECRET = os.getenv("SEPARATOR_SERVER_SECRET", "")

# Remote Modal API separation
SEPARATOR_MODAL_API_URL = os.getenv("SEPARATOR_MODAL_API_URL", "")

# The host the remote backend sends songs to, which speaks the /tasks protocol,
# and the credentials it sends as the Modal-Key and Modal-Secret headers.
SEPARATION_REMOTE_URL = os.getenv("SEPARATION_REMOTE_URL", "")
SEPARATION_REMOTE_KEY = os.getenv("SEPARATION_REMOTE_KEY", "")
SEPARATION_REMOTE_SECRET = os.getenv("SEPARATION_REMOTE_SECRET", "")

# The largest song /separate_track accepts, in megabytes. The upload is held in
# memory, so this bounds what one request can take.
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "200"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1_000_000

# Where separation runs. One of the names in karaoke/separation_backends.py.
SEPARATION_BACKEND = os.getenv("SEPARATION_BACKEND", "in_process")

# How many separations run at once in each worker process. The rest wait in
# line. Each one sizes its thread pools to the whole machine, so running more
# than one mostly slows them all down.
SEPARATION_CONCURRENCY = int(os.getenv("SEPARATION_CONCURRENCY", "1"))

# Where separation models are downloaded to and loaded from.
MODELS_DIR = Path(os.getenv("MODELS_DIR") or BASE_DIR / "pretrained_models")

# Container the separated stems are written in, as an audio-separator output
# format. FLAC is lossless and roughly half the size of WAV, which is worth the
# encode wherever a result crosses a network. The frontend reads whatever it is
# handed, so this is the only place it is decided.
SEPARATION_OUTPUT_FORMAT = os.getenv("SEPARATION_OUTPUT_FORMAT", "wav").lower()

# Local separation job store, used when SEPARATED_TRACKS_BUCKET is unset. Jobs
# run in the background and the client polls for the result, so no request is
# held open for the length of a separation.
LOCAL_JOB_DIR = Path(
    os.getenv("LOCAL_JOB_DIR", Path(tempfile.gettempdir()) / "tuul_jobs")
)

# How long finished results are kept before being pruned. Each is about
# the size of two uncompressed WAVs. Set to 0 to keep them indefinitely.
LOCAL_JOB_RESULT_TTL_SECONDS = int(
    os.getenv("LOCAL_JOB_RESULT_TTL_SECONDS", str(7 * 24 * 60 * 60))
)

# A job still marked as processing after this long is assumed dead, its worker having been killed.
# Matches the default gunicorn timeout.
LOCAL_JOB_STALE_AFTER_SECONDS = int(os.getenv("LOCAL_JOB_STALE_AFTER_SECONDS", "7200"))
