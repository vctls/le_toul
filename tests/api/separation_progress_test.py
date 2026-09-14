"""Tests for the tqdm substitution that reports separation progress.

The real architecture modules pull in torch, so these run the patched bar
classes against a stand-in module shaped the same way: a module-level `tqdm`
name that the inference loop calls.
"""

import sys
import types

import pytest

from api.karaoke import separation_progress

ARCHITECTURE_MODULE = "fake_architecture"


@pytest.fixture
def architecture(monkeypatch):
    """A module holding a `tqdm` name, patched in place of a real architecture."""
    import tqdm as tqdm_package

    module = types.ModuleType(ARCHITECTURE_MODULE)
    module.tqdm = tqdm_package.tqdm
    monkeypatch.setitem(sys.modules, ARCHITECTURE_MODULE, module)
    return module


@pytest.fixture
def reports():
    return []


@pytest.fixture
def on_progress(reports):
    return lambda progress, stage: reports.append((progress, stage))


def patch_architecture(monkeypatch, bar_class):
    monkeypatch.setattr(
        separation_progress,
        "_PATCHED_MODULES",
        {ARCHITECTURE_MODULE: bar_class},
    )


def run_chunks(module, count):
    # mininterval=0 so every chunk is reported; tqdm otherwise skips reports
    # that fall inside its print interval, which a test is too fast to clear.
    for _ in module.tqdm(range(count), mininterval=0):
        pass


def test_chunk_loop_reports_rising_progress(
    architecture, monkeypatch, on_progress, reports
):
    """A single-pass architecture fills the bar over one loop."""
    patch_architecture(monkeypatch, separation_progress._ChunkBar)

    with separation_progress.reporting(on_progress):
        run_chunks(architecture, 100)

    fractions = [progress for progress, _ in reports]
    assert fractions == sorted(fractions)
    assert fractions[-1] == 1.0
    assert all(stage == separation_progress.SEPARATING_STAGE for _, stage in reports)


def test_two_pass_architecture_splits_the_bar(
    architecture, monkeypatch, on_progress, reports
):
    """MDX demixes twice, and the cheap second pass gets a small share."""
    patch_architecture(monkeypatch, separation_progress._MdxChunkBar)

    with separation_progress.reporting(on_progress):
        run_chunks(architecture, 100)
        after_first_pass = reports[-1][0]
        run_chunks(architecture, 100)

    assert after_first_pass == pytest.approx(0.905, abs=0.01)
    assert reports[-1][0] == 1.0


def test_download_is_reported_as_its_own_stage(
    architecture, monkeypatch, on_progress, reports
):
    """The model download only happens on first use, so it gets a small share."""
    patch_architecture(monkeypatch, separation_progress._DownloadBar)

    with separation_progress.reporting(on_progress):
        bar = architecture.tqdm(total=1000, mininterval=0)
        bar.update(1000)
        bar.close()

    assert reports[-1] == (
        pytest.approx(separation_progress._DOWNLOAD_SHARE),
        separation_progress.DOWNLOAD_STAGE,
    )


def test_stages_outside_the_loops_are_named(
    architecture, monkeypatch, on_progress, reports
):
    """Loading and decoding happen before any bar exists, so they carry no figure."""
    patch_architecture(monkeypatch, separation_progress._ChunkBar)

    with separation_progress.reporting(on_progress) as progress:
        progress.stage(separation_progress.LOADING_STAGE)

    assert reports == [(None, separation_progress.LOADING_STAGE)]


def test_tqdm_is_restored_afterwards(architecture, monkeypatch, on_progress):
    """The substitution is process-wide, so it must not outlive the separation."""
    import tqdm as tqdm_package

    patch_architecture(monkeypatch, separation_progress._ChunkBar)

    with separation_progress.reporting(on_progress):
        assert architecture.tqdm is separation_progress._ChunkBar

    assert architecture.tqdm is tqdm_package.tqdm


def test_nothing_is_patched_without_a_callback(architecture, monkeypatch):
    """A separation that reports nowhere should not touch tqdm at all."""
    import tqdm as tqdm_package

    patch_architecture(monkeypatch, separation_progress._ChunkBar)

    with separation_progress.reporting(None):
        assert architecture.tqdm is tqdm_package.tqdm


def test_reports_stop_outside_the_block(
    architecture, monkeypatch, on_progress, reports
):
    """A bar on another thread's job must not report against this one."""
    patch_architecture(monkeypatch, separation_progress._ChunkBar)

    with separation_progress.reporting(on_progress):
        pass
    separation_progress._ChunkBar(range(10), mininterval=0).update(1)

    assert reports == []
