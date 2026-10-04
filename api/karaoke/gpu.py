"""Handing GPU memory back between jobs, in a process that runs one after another."""

import gc
import sys


def release_memory() -> None:
    """Hand back the GPU memory torch keeps reserved after a job.

    torch caches freed memory for its own reuse. In a process that outlives the
    job, ONNX Runtime then cannot allocate from it, and the next ONNX model fails
    for lack of GPU memory.
    """
    torch = sys.modules.get("torch")
    if torch is None or not torch.cuda.is_available():
        return
    gc.collect()
    torch.cuda.empty_cache()
