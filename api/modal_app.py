"""The separation service on Modal: the job protocol in front of a GPU function.

Run from the repository root, as a module so that the api package imports:

    modal serve -m api.modal_app
    modal deploy -m api.modal_app
    modal run -m api.modal_app::seed_models
"""

from pathlib import Path

import modal
import modal.exception

APP_NAME = "tuul-separation"
GPU = "L4"
# SEPARATION_CONCURRENCY on Railway should equal this, so that the songs
# beyond it wait in Railway's queue, which reports their place in line.
MAX_GPU_CONTAINERS = 3
# A song that takes longer to separate fails, so this bounds how long a song can be.
SEPARATION_TIMEOUT_SECONDS = 10 * 60
# Railway downloads the stems as soon as a task is done, so a day is margin.
FILE_TTL_SECONDS = 24 * 60 * 60

FILES_MOUNT = "/files"
MODELS_MOUNT = "/models"

_REPO = Path(__file__).resolve().parents[1]
_PYPROJECT = str(_REPO / "pyproject.toml")
_LOCKFILE = str(_REPO / "poetry.lock")

# librosa compiles its numba functions on import, which takes half a minute. It
# caches them, but only once a container has paid for it, so the build pays instead.
_WARM_NUMBA_CACHE = (
    "import numpy as np, soundfile as sf, librosa; "
    "sf.write('/tmp/silence.wav', np.zeros((44100, 2), dtype='float32'), 44100); "
    "librosa.load('/tmp/silence.wav', mono=False, sr=44100)"
)

web_image = (
    modal.Image.debian_slim(python_version="3.13")
    .poetry_install_from_file(_PYPROJECT, _LOCKFILE, without=["dev"])
    .add_local_python_source("api")
)

# The lock pins the CPU builds, which this swaps for the CUDA builds of the same
# versions, as the Dockerfile does for SEPARATION_DEVICE=cuda.
gpu_image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("ffmpeg")
    .poetry_install_from_file(
        _PYPROJECT, _LOCKFILE, with_=["separation"], without=["dev"]
    )
    .pip_install(
        "torch==2.7.1+cu128",
        "torchvision==0.22.1+cu128",
        index_url="https://download.pytorch.org/whl/cu128",
        extra_index_url="https://pypi.org/simple",
    )
    .run_commands("python -m pip uninstall -y onnxruntime")
    .pip_install("onnxruntime-gpu==1.22.0")
    .env(
        {
            "MODELS_DIR": MODELS_MOUNT,
            "SEPARATION_OUTPUT_FORMAT": "flac",
            # Numba keys its cache to the CPU, and the builder's is not the GPU host's.
            "NUMBA_CPU_NAME": "generic",
        }
    )
    .run_commands(f'python -c "{_WARM_NUMBA_CACHE}"')
    .add_local_python_source("api")
)

app = modal.App(APP_NAME, include_source=False)

records = modal.Dict.from_name("tuul-separation-jobs", create_if_missing=True)
files_volume = modal.Volume.from_name("tuul-separation-files", create_if_missing=True)
models_volume = modal.Volume.from_name("tuul-separation-models", create_if_missing=True)


@app.function(
    image=gpu_image,
    gpu=GPU,
    volumes={FILES_MOUNT: files_volume, MODELS_MOUNT: models_volume},
    timeout=SEPARATION_TIMEOUT_SECONDS,
    max_containers=MAX_GPU_CONTAINERS,
    scaledown_window=60,
)
def separate(task_id: str, song_name: str, model_name: str) -> None:
    """Separate a task's song, uploaded to the files Volume under its ID."""
    from api.karaoke.separation_backends import InProcessBackend
    from api.modal_tasks import run_task

    files_volume.reload()

    def commit() -> None:
        files_volume.commit()
        # A model's first use downloads its weights into the Volume.
        models_volume.commit()

    run_task(
        records,
        task_id,
        Path(FILES_MOUNT) / task_id / song_name,
        model_name,
        InProcessBackend(),
        commit,
    )


class _VolumeFiles:
    """The files Volume, through its API rather than a mount.

    A mounted Volume refuses to reload while any file on it is open, which a
    web container serving concurrent downloads cannot promise.
    """

    def __init__(self, volume: modal.Volume):
        self._volume = volume

    def upload(self, source, path: str) -> None:
        with self._volume.batch_upload() as batch:
            batch.put_file(source, path)

    def download(self, path: str, destination) -> None:
        self._volume.read_file_into_fileobj(path, destination)


class _SeparateCalls:
    def spawn(self, task_id: str, song_name: str, model_name: str) -> str:
        return separate.spawn(task_id, song_name, model_name).object_id

    def failure(self, call_id: str) -> str | None:
        """Say why a call ended without recording an outcome.

        None while it runs, and once it has returned.
        """
        try:
            modal.FunctionCall.from_id(call_id).get(timeout=0)
        # A call still running raises the builtin TimeoutError. The unrelated
        # modal.exception.TimeoutError, base of FunctionTimeoutError, means it has ended.
        except TimeoutError:
            return None
        except (Exception, modal.exception.InputCancellation) as e:
            return _describe(e)
        return None

    def cancel(self, call_id: str) -> None:
        modal.FunctionCall.from_id(call_id).cancel()


def _describe(error: BaseException) -> str:
    detail = f": {error}" if str(error) else ""
    return f"The separation stopped without finishing ({type(error).__name__}{detail})"


@app.function(image=web_image)
@modal.concurrent(max_inputs=100)
@modal.asgi_app(requires_proxy_auth=True)
def web():
    """Serve the job protocol, behind Modal's proxy auth."""
    from fastapi import FastAPI

    from api.modal_tasks import ModalTaskRunner
    from api.separation_tasks import create_router

    runner = ModalTaskRunner(records, _VolumeFiles(files_volume), _SeparateCalls())
    service = FastAPI(title="The Tüül separation")
    service.include_router(create_router(runner))

    @service.get("/health")
    def health():
        return {"status": "ok"}

    return service


@app.function(
    image=web_image,
    volumes={FILES_MOUNT: files_volume},
    schedule=modal.Period(hours=6),
)
def prune_files() -> None:
    """Delete the task directories nothing will download any more."""
    from api.modal_tasks import prune_task_files

    files_volume.reload()
    prune_task_files(Path(FILES_MOUNT), FILE_TTL_SECONDS)
    files_volume.commit()


@app.function(
    image=gpu_image,
    volumes={MODELS_MOUNT: models_volume},
    timeout=30 * 60,
)
def seed_models() -> None:
    """Download every model's weights into the models Volume ahead of first use."""
    from audio_separator.separator import Separator

    from api.karaoke.music_separation import AVAILABLE_MODELS

    separator = Separator(model_file_dir=MODELS_MOUNT)
    for model_name in AVAILABLE_MODELS:
        separator.download_model_files(model_name)
    models_volume.commit()
