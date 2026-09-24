#!/usr/bin/env python3
"""
FastAPI app for GPU-accelerated music separation, on whatever host holds the GPU.

It serves the asynchronous job protocol of separation_tasks under /tasks, which
the remote backend calls.

The /tasks records live in this process, so it must run a single worker.
"""

import logging

from fastapi import FastAPI

from . import app_logging, separation_tasks, settings

logging.basicConfig(level=logging.INFO)
app_logging.setup()

app = FastAPI(title="Separator API", version="1.0.0")
app.include_router(separation_tasks.create_router(separation_tasks.LocalTaskRunner()))


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="localhost", port=settings.SEPARATOR_PORT, log_level="info")
