import sys
import os
from pathlib import Path

import pytest

# Add the api directory to the sys.path
root_dir = Path(__file__).resolve().parent.parent / "api"
sys.path.append(str(root_dir))

from api import settings  # noqa: E402  (needs the sys.path entry above)


@pytest.fixture(autouse=True)
def local_job_dir(tmp_path, monkeypatch):
    """Point the local separation job store at a per-test directory.

    Autouse so that no test can leave separation results behind in the real job
    directory or pick up results left by another test.
    """
    job_dir = tmp_path / "tuul_jobs"
    monkeypatch.setattr(settings, "LOCAL_JOB_DIR", job_dir)
    return job_dir
