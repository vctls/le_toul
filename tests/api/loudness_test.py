import shutil
from pathlib import Path

import pytest

from api.karaoke import loudness

np = pytest.importorskip("numpy")
soundfile = pytest.importorskip("soundfile")
pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")

SAMPLE_RATE = 44100


def tone(amplitude: float, seconds: float = 3.0) -> "np.ndarray":
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    mono = amplitude * np.sin(2 * np.pi * 440 * t)
    return np.stack([mono, mono], axis=1)


def write(path: Path, data, subtype: str = "PCM_16") -> Path:
    soundfile.write(str(path), data, SAMPLE_RATE, subtype=subtype)
    return path


def test_a_quieter_stem_is_raised_to_the_songs_loudness(tmp_path):
    song = write(tmp_path / "song.wav", tone(0.5))
    stem = write(tmp_path / "accompaniment.wav", tone(0.1))

    loudness.match(stem, song)

    assert loudness.measure(stem).integrated_lufs == pytest.approx(
        loudness.measure(song).integrated_lufs, abs=0.2
    )


@pytest.mark.parametrize("subtype", ["PCM_16", "PCM_24", "FLOAT"])
def test_the_stem_keeps_its_format(tmp_path, subtype):
    song = write(tmp_path / "song.wav", tone(0.5))
    stem = write(tmp_path / "accompaniment.wav", tone(0.1), subtype)

    loudness.match(stem, song)

    info = soundfile.info(str(stem))
    assert info.subtype == subtype
    assert info.samplerate == SAMPLE_RATE
    assert info.channels == 2
    assert not list(tmp_path.glob(".scaled.*"))


def test_the_gain_stops_where_the_stem_would_peak_above_the_song(tmp_path):
    song = write(tmp_path / "song.wav", tone(0.5))
    sparse = tone(0.02)
    sparse[:: SAMPLE_RATE // 4] = 0.25
    stem = write(tmp_path / "accompaniment.wav", sparse)

    loudness.match(stem, song)

    after = loudness.measure(stem)
    assert after.true_peak_dbtp <= loudness.measure(song).true_peak_dbtp + 0.1
    assert after.integrated_lufs < loudness.measure(song).integrated_lufs - 1


def test_a_silent_stem_is_left_alone(tmp_path):
    song = write(tmp_path / "song.wav", tone(0.5))
    stem = write(tmp_path / "accompaniment.wav", tone(0.0))
    before = stem.read_bytes()

    loudness.match(stem, song)

    assert stem.read_bytes() == before


def test_a_stem_ffmpeg_cannot_read_is_left_alone(tmp_path):
    song = write(tmp_path / "song.wav", tone(0.5))
    stem = tmp_path / "accompaniment.wav"
    stem.write_text("not audio")

    loudness.match(stem, song)

    assert stem.read_text() == "not audio"
