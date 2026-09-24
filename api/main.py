import tempfile
from pathlib import Path
from typing import Literal

import structlog
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi import (
    Path as PathParam,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markupsafe import Markup
from pydantic import BaseModel, ConfigDict

from . import app_logging, settings
from .helpers import cloud_storage, job_store, youtube_helper, zip_helper
from .helpers.youtube_helper import YouTubeException
from .karaoke import separation_backends, separation_progress
from .vite_assets import vite_assets

# Configure logging
app_logging.setup()
logger = structlog.get_logger(__name__)

# Create FastAPI app
app = FastAPI(title="The Tuul API", debug=settings.DEBUG)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom middleware for SharedArrayBuffer headers
@app.middleware("http")
async def add_sharedarraybuffer_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response


# Static files and templates
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")
templates = Jinja2Templates(directory=settings.TEMPLATES_DIR)


# Pydantic models
class LogErrorRequest(BaseModel):
    # Clients send context beyond these fields, such as the browser and render diagnostics.
    model_config = ConfigDict(extra="allow")

    level: Literal["info", "warning", "error"] = "error"
    message: str | None = None
    stack: str | None = None
    url: str | None = None
    line: int | None = None
    column: int | None = None


class SeparationPollResponse(BaseModel):
    finishedTrackURL: str


class DownloadPollResponse(BaseModel):
    finishedDownloadURL: str


def streamed_response(file_path: Path) -> StreamingResponse:
    """Return a streaming response for the given file path."""

    # Read the entire file into memory to avoid issues with temp file cleanup
    file_content = file_path.read_bytes()

    def streaming_content():
        # Stream the content in chunks
        chunk_size = 1024 * 1024  # 1MB chunks
        for i in range(0, len(file_content), chunk_size):
            yield file_content[i : i + chunk_size]

    return StreamingResponse(streaming_content(), media_type="application/zip")


def perform_music_separation(
    song_content: bytes,
    song_filename: str,
    model_name: str,
    song_files_dir: Path,
    cache_hash: str | None = None,
    on_progress: separation_progress.ProgressCallback | None = None,
) -> Path:
    """Perform music separation and return the path to the created zip file.

    Args:
        song_content: The audio file content as bytes
        song_filename: The name of the song file
        model_name: The separation model to use
        song_files_dir: The temporary directory to work in
        cache_hash: Optional cache hash for logging context
        on_progress: Called with (fraction, stage) as the work advances

    Returns:
        Path to the created zip file containing separated tracks
    """
    # Save uploaded file
    song_file_path = song_files_dir / song_filename
    with song_file_path.open("wb") as f:
        f.write(song_content)

    backend = separation_backends.get_backend()

    logger.info(
        "separation_started",
        backend=backend.name,
        cache_hash=cache_hash,
    )

    separated = backend.separate(
        song_file_path,
        song_files_dir,
        model_name,
        on_progress=on_progress,
    )

    if on_progress:
        on_progress(1.0, separation_progress.PACKAGING_STAGE)

    zip_path = zip_helper.create_zip_file(
        song_files_dir / "split_song.zip",
        [
            (separated.accompaniment, separated.accompaniment.name),
            (separated.vocals, separated.vocals.name),
        ],
    )

    logger.info("zip_complete", path=zip_path, cache_hash=cache_hash)

    return zip_path


def process_track_separation_background(
    cache_hash: str, model_name: str, song_content: bytes, song_filename: str
):
    """Background task to process track separation and upload to cache.

    No progress is reported: the client polls the cache object directly rather
    than this service, so reporting would mean re-uploading the placeholder for
    every update.
    """
    logger.info("background_separation_started", cache_hash=cache_hash)

    with tempfile.TemporaryDirectory() as song_files_dir:
        song_files_dir_path = Path(song_files_dir)

        zip_path = perform_music_separation(
            song_content, song_filename, model_name, song_files_dir_path, cache_hash
        )

        # Upload to cache
        blob_name = f"separated_tracks/{cache_hash}.zip"
        logger.info(
            "background_uploading_to_cache", cache_hash=cache_hash, blob_name=blob_name
        )
        cloud_storage.upload_to_cache(cache_hash, zip_path)


def process_track_separation_local(
    cache_hash: str,
    run_id: str,
    model_name: str,
    song_content: bytes,
    song_filename: str,
):
    """Background task to process track separation into the local job store."""
    logger.info("local_separation_started", cache_hash=cache_hash)

    def report(progress: float | None, stage: str) -> None:
        # The separation hands control back only to report,
        # so this is the one place a cancelled run can notice and unwind.
        if not job_store.is_current_run(cache_hash, run_id):
            raise job_store.JobCancelled()
        job_store.mark_progress(cache_hash, progress, stage)

    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            zip_path = perform_music_separation(
                song_content,
                song_filename,
                model_name,
                Path(song_files_dir),
                cache_hash,
                on_progress=report,
            )
            job_store.store_result(cache_hash, zip_path)
    except job_store.JobCancelled:
        logger.info("local_separation_cancelled", cache_hash=cache_hash)
        job_store.mark_cancelled(cache_hash, run_id)
    except Exception as e:
        # The client is polling for this hash, so the failure has to be recorded rather than only logged,
        # or it will poll forever.
        logger.exception("local_separation_failed", cache_hash=cache_hash)
        job_store.mark_failed(cache_hash, str(e), run_id)


@app.get("/")
async def index(request: Request):
    """Serve the main application page."""
    context = {
        "request": request,
        "vite_hmr_client": Markup(vite_assets.render_hmr_client()),
        "vite_assets": Markup(vite_assets.render_tags("index.ts")),
    }
    return templates.TemplateResponse("index.html", context)


@app.post("/separate_track")
async def separate_track(
    background_tasks: BackgroundTasks,
    songFile: UploadFile = File(...),
    modelName: str = Form(...),
):
    """Return a zip containing vocal and accompaniment splits of songFile."""
    if not songFile or not modelName:
        raise HTTPException(
            status_code=400, detail="songFile and modelName are required"
        )

    # Read file content
    song_content = await songFile.read()

    logger.info(
        "separate_tracks",
        song_size=len(song_content),
        model_name=modelName,
    )

    # Check if we can fetch from cache
    if settings.SEPARATED_TRACKS_BUCKET:
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)
        blob_name = f"separated_tracks/{cache_hash}.zip"
        logger.info("checking_cache", cache_hash=cache_hash, blob_name=blob_name)

        # Try to fetch from cache
        cache_result = cloud_storage.fetch_from_cache(cache_hash)
        if cache_result:
            # Cache found (either placeholder or completed) - return URL for client polling
            logger.info(
                "cache_found_returning_url",
                cache_hash=cache_hash,
                blob_name=blob_name,
                poll_url=cache_result,
            )
            return SeparationPollResponse(finishedTrackURL=cache_result)

    # If no cache hit or caching is disabled, proceed with track separation
    if settings.SEPARATED_TRACKS_BUCKET:
        # Create placeholder and get public URL for polling
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)
        poll_url = cloud_storage.create_cache_placeholder(cache_hash)

        if poll_url:
            # Start background task to process separation
            background_tasks.add_task(
                process_track_separation_background,
                cache_hash,
                modelName,
                song_content,
                songFile.filename or "uploaded_song",
            )

            # Return URL immediately for client to poll
            logger.info("returning_poll_url", cache_hash=cache_hash, poll_url=poll_url)
            return SeparationPollResponse(finishedTrackURL=poll_url)
        else:
            logger.warning("failed_to_create_placeholder", cache_hash=cache_hash)
    else:
        # No bucket configured. Run the separation locally in the background and hand back a URL to poll:
        # a separation can take half an hour, far longer than a browser will hold a single request open.
        cache_hash = cloud_storage.get_cache_hash(modelName, song_content)

        if job_store.result_path(cache_hash).exists():
            logger.info("local_cache_hit", cache_hash=cache_hash)
            return SeparationPollResponse(
                finishedTrackURL=job_store.poll_url(cache_hash)
            )

        status = job_store.read_status(cache_hash)
        if (
            status
            and status.get("status") == job_store.STATUS_PROCESSING
            and not job_store.is_stale(status)
        ):
            # Already being separated. Point the client at the running job rather than doing the same work twice.
            logger.info("local_job_already_running", cache_hash=cache_hash)
            return SeparationPollResponse(
                finishedTrackURL=job_store.poll_url(cache_hash)
            )

        # Anything else (a failed job, or one whose worker died) falls through to a fresh attempt,
        # so a single failure does not block the song forever.
        job_store.prune_expired_results()

        run_id = job_store.mark_processing(cache_hash)
        background_tasks.add_task(
            process_track_separation_local,
            cache_hash,
            run_id,
            modelName,
            song_content,
            songFile.filename or "uploaded_song",
        )

        logger.info("local_separation_queued", cache_hash=cache_hash)
        return SeparationPollResponse(finishedTrackURL=job_store.poll_url(cache_hash))


@app.get("/separated_track/{cache_hash}")
async def separated_track(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Poll target for a separation running in the local job store.

    Returns the zip once the job has finished,
    JSON describing the job while it is still running or if it failed,
    and 404 for an unknown hash.
    The hash is constrained to a sha256 digest so it cannot escape the job directory.
    """
    result = job_store.result_path(cache_hash)
    if result.exists():
        return FileResponse(result, media_type="application/zip")

    status = job_store.read_status(cache_hash)
    if status is None:
        raise HTTPException(status_code=404, detail="Unknown separation job")

    if job_store.is_stale(status):
        logger.warning("local_job_stale", cache_hash=cache_hash)
        return JSONResponse(
            {
                "status": job_store.STATUS_ERROR,
                "error": "Track separation stopped unexpectedly. Please try again.",
            }
        )

    if status.get("status") in (job_store.STATUS_ERROR, job_store.STATUS_CANCELLED):
        return JSONResponse(status)

    return JSONResponse(
        {**status, "pollIntervalSeconds": job_store.POLL_INTERVAL_SECONDS}
    )


@app.post("/separated_track/{cache_hash}/cancel")
async def cancel_separated_track(
    cache_hash: str = PathParam(..., pattern="^[0-9a-f]{64}$"),
):
    """Call off a separation running in the local job store.

    Best-effort: the worker stops at its next progress report,
    so a job still loading its model runs on until the separation itself starts.
    Reports whether there was a running job to call off.
    """
    cancelled = job_store.request_cancel(cache_hash)
    logger.info(
        "local_separation_cancel_requested", cache_hash=cache_hash, running=cancelled
    )
    return {"cancelled": cancelled}


@app.get("/download_video")
async def download_youtube_video(
    background_tasks: BackgroundTasks, youtube_url: str = Query(..., alias="url")
):
    """Download a YouTube video as audio and video streams and return them as a zip."""
    logger.info("download_youtube_video", youtube_url=youtube_url)

    if not youtube_url:
        raise HTTPException(status_code=400, detail="No url provided.")

    # Extract video ID from URL using pytube
    try:
        video_id = youtube_helper.get_video_id(youtube_url)
        logger.info("extracted_video_id", video_id=video_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Check if we have storage configured
    if settings.SEPARATED_TRACKS_BUCKET:
        # Generate the expected GCS URL
        bucket_name = settings.SEPARATED_TRACKS_BUCKET
        poll_url = f"https://storage.googleapis.com/{bucket_name}/downloaded_videos/{video_id}.zip"

        # Start background task to process download
        background_tasks.add_task(
            youtube_helper.process_youtube_download_background, video_id, youtube_url
        )

        # Return URL immediately for client to poll
        logger.info("returning_youtube_poll_url", video_id=video_id, poll_url=poll_url)
        return DownloadPollResponse(finishedDownloadURL=poll_url)

    # Fallback to synchronous processing if no storage configured
    try:
        with tempfile.TemporaryDirectory() as song_files_dir:
            song_files_dir_path = Path(song_files_dir)
            zip_path = youtube_helper.download_and_zip_youtube(
                video_id, youtube_url, song_files_dir_path
            )
            return streamed_response(zip_path)
    except YouTubeException as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/log_error")
async def log_error(error_data: LogErrorRequest):
    """Log client errors and diagnostics."""
    log = getattr(logger, error_data.level)
    log(
        f"Client {error_data.level}: {error_data.message or '<no message>'}",
        extra=error_data.model_dump(exclude={"level"}),
    )
    return {"success": True}


@app.api_route("/health", methods=["GET", "HEAD"])
async def health(request: Request):
    """Health-check endpoint for uptime monitors.

    GET -> returns JSON {"status": "ok"}
    HEAD -> returns empty 200
    """
    if request.method == "HEAD":
        return Response(status_code=200)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
