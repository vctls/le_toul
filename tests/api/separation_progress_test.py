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
    # mininterval=0 so every chunk is reported, since tqdm otherwise skips reports
    # that fall inside its print interval, which a test is too fast to clear.
    for _ in module.tqdm(range(count), mininterval=0):
        pass


WEIGHTS_BYTES = 10_000_000


def download(module, total, fraction=1.0):
    bar = module.tqdm(total=total, mininterval=0)
    bar.update(int(total * fraction))
    bar.close()


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
        download(architecture, WEIGHTS_BYTES)

    assert reports[-1] == (
        pytest.approx(separation_progress._DOWNLOAD_SHARE),
        separation_progress.DOWNLOAD_STAGE,
    )


def test_small_files_leave_the_download_share_to_the_weights(
    architecture, monkeypatch, on_progress, reports
):
    """The model index finishes first, and must not fill the bar before the weights start."""
    patch_architecture(monkeypatch, separation_progress._DownloadBar)

    with separation_progress.reporting(on_progress):
        download(architecture, 3539)
        download(architecture, WEIGHTS_BYTES, fraction=0.5)

    assert reports == [
        (
            pytest.approx(separation_progress._DOWNLOAD_SHARE * 0.5),
            separation_progress.DOWNLOAD_STAGE,
        )
    ]


def test_gzipped_download_does_not_overshoot_its_share(
    architecture, monkeypatch, on_progress, reports
):
    """A gzipped response yields more bytes than its content-length announces."""
    patch_architecture(monkeypatch, separation_progress._DownloadBar)

    with separation_progress.reporting(on_progress):
        download(architecture, WEIGHTS_BYTES, fraction=8)

    assert max(progress for progress, _ in reports) == pytest.approx(
        separation_progress._DOWNLOAD_SHARE
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
