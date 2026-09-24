# Stage 1: Frontend builder
FROM node:22-slim AS frontend-builder

ARG TUUL_API_HOSTNAME=""
ARG TUUL_DONATE_URL=""

ENV TUUL_API_HOSTNAME=$TUUL_API_HOSTNAME \
    TUUL_DONATE_URL=$TUUL_DONATE_URL

WORKDIR /app

# Copy frontend source files
COPY package.json package-lock.json ./
RUN npm clean-install

# Copy the rest of the frontend source
COPY frontend/ ./frontend/
COPY vite.config.*.ts tsconfig.json ./

# Build the frontend
RUN npm run build

# Use an official lightweight Python image.
# https://hub.docker.com/_/python
FROM python:3.13-slim AS backend-builder

ENV APP_HOME=/app
# Setting this ensures print statements and log messages
# promptly appear in Cloud Logging.
ENV PYTHONUNBUFFERED=TRUE \
    POETRY_VERSION=2.1.2 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1 \
    POETRY_CACHE_DIR=/tmp/poetry_cache
WORKDIR $APP_HOME

# prepend poetry and venv to path
# ENV PATH "$POETRY_HOME/bin:$PATH"

# Install dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && pip install "poetry==$POETRY_VERSION"

COPY ./poetry.lock ./pyproject.toml ./

# Torch is roughly 2 GB of the image and is needed only where separation runs in
# this container. A deployment that separates elsewhere leaves this false.
ARG INSTALL_SEPARATION=false

RUN if [ "$INSTALL_SEPARATION" = "true" ]; then \
        poetry install --without dev --with separation --no-root --no-interaction --no-ansi; \
    else \
        poetry install --without dev --no-root --no-interaction --no-ansi; \
    fi

# The lock pins the CPU builds. `cuda` swaps them for the CUDA builds of the same
# versions, for an image that separates on an NVIDIA GPU. onnxruntime-gpu loads
# the CUDA and cuDNN libraries that the torch wheels bring.
ARG SEPARATION_DEVICE=cpu

RUN if [ "$INSTALL_SEPARATION" = "true" ] && [ "$SEPARATION_DEVICE" = "cuda" ]; then \
        .venv/bin/python -m pip install --no-cache-dir \
            --index-url https://download.pytorch.org/whl/cu128 \
            --extra-index-url https://pypi.org/simple \
            "torch==2.7.1+cu128" "torchvision==0.22.1+cu128" \
        && .venv/bin/python -m pip uninstall -y onnxruntime \
        && .venv/bin/python -m pip install --no-cache-dir "onnxruntime-gpu==1.22.0"; \
    fi

#
# RUNTIME IMAGE
#

FROM python:3.13-slim AS runner


# Service must listen to $PORT environment variable.
# The default value facilitates local development.
ENV APP_HOME=/app \
    PYTHONUNBUFFERED=TRUE \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8080 \
    WORKER_COUNT=1 \
    DEBUG=False \
    YOUTUBE_SOCKS5_PROXY="" \
    SEPARATED_TRACKS_BUCKET=""

# With a child process per separation, running out of memory kills that child, not the web worker.
# A recycled worker would take its background separations with it.
ENV SEPARATION_BACKEND=subprocess \
    MAX_REQUESTS=0

WORKDIR $APP_HOME

# Copy installed dependencies from builder
COPY --from=backend-builder $VIRTUAL_ENV $VIRTUAL_ENV

# Install runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get remove -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy local code to the container image.
COPY api api
# Copy gunicorn configuration
COPY gunicorn.conf.py pyproject.toml poetry.lock ${APP_HOME}

# Copy frontend static files from the node builder to the correct location
# for FastAPI to serve them
COPY --from=frontend-builder /app/api/assets/bundles api/assets/bundles

EXPOSE $PORT

# Run the web service on container startup using gunicorn with uvicorn workers
# Configuration handles workers, port, and other production settings
CMD ["gunicorn", "--config", "gunicorn.conf.py", "api.main:app"]