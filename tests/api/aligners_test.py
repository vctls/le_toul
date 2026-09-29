"""Tests for the aligners and the contract every one of them keeps.

The contract tests run against each registered aligner whose dependencies and
weights are present, so a new aligner is covered by adding it to the registry.
"""

import importlib.util
import subprocess
import sys

import numpy as np
import pytest

from api import settings
from api.karaoke.aligners import AlignerSegment, aligner_names, get_aligner

SAMPLE_RATE = 16000


def _installed(name: str) -> bool:
    if name != "mms_fa":
        return True
    return (
        importlib.util.find_spec("torchaudio") is not None
        and (settings.MODELS_DIR / "mms_fa" / "model.pt").exists()
    )


@pytest.fixture(params=aligner_names())
def aligner(request):
    if not _installed(request.param):
        pytest.skip(
            f"The {request.param} aligner's dependencies or weights are not installed"
        )
    return get_aligner(request.param)


def _audio(seconds: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    times = np.arange(int(seconds * sample_rate)) / sample_rate
    return (0.3 * np.sin(2 * np.pi * 220 * times)).astype(np.float32)


def test_every_aligner_returns_one_entry_per_segment_inside_the_audio(aligner):
    segments = [
        AlignerSegment("one ", False),
        AlignerSegment("two", True),
        AlignerSegment("three", True),
    ]
    alignments = aligner.align(_audio(4, aligner.sample_rate), segments)

    assert len(alignments) == len(segments)
    for alignment in alignments:
        if alignment.start is not None:
            assert 0 <= alignment.start <= 4
        if alignment.end is not None:
            assert 0 <= alignment.end <= 4


def test_every_aligner_leaves_a_textless_segment_untimed(aligner):
    segments = [AlignerSegment("word", False), AlignerSegment("", True)]

    alignments = aligner.align(_audio(2, aligner.sample_rate), segments)

    assert alignments[1].start is None


def test_an_unknown_aligner_raises():
    with pytest.raises(ValueError, match="Unknown aligner"):
        get_aligner("nope")


def test_listing_the_aligners_does_not_import_torch():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from api.karaoke.aligners import aligner_names; aligner_names(); "
            "print('torch' in sys.modules)",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"


def test_the_fake_aligner_spreads_segments_with_text_evenly():
    fake = get_aligner("fake")
    segments = [
        AlignerSegment("a", False),
        AlignerSegment("", False),
        AlignerSegment("b", True),
    ]

    alignments = fake.align(_audio(4), segments)

    assert [a.start for a in alignments] == [0.0, None, 2.0]


class TestMmsTokens:
    @pytest.fixture
    def mms(self):
        pytest.importorskip("torchaudio")
        pytest.importorskip("uroman")
        return get_aligner("mms_fa")

    def _chars(self, mms, text: str) -> str:
        labels = {index: char for char, index in mms._dictionary.items()}
        return "".join(labels[token] for token in mms._tokens(text))

    def test_punctuation_and_hyphens_are_dropped(self, mms):
        assert self._chars(mms, '"Pay, tre-') == "paytre"

    def test_a_curly_apostrophe_is_kept_as_an_apostrophe(self, mms):
        assert self._chars(mms, "don’t") == "don't"

    def test_accents_are_romanized(self, mms):
        assert self._chars(mms, "Mèmè") == "meme"

    def test_a_non_latin_line_is_romanized(self, mms):
        assert self._chars(mms, "мир") == "mir"

    @pytest.mark.parametrize("text", ["1999", "▅▅▅", ""])
    def test_digits_symbols_and_spacers_have_no_tokens(self, mms, text):
        assert mms._tokens(text) == []

    def test_a_star_goes_before_the_lyrics_after_each_line_and_at_the_end(self, mms):
        star = mms._dictionary["*"]
        segments = [
            AlignerSegment("a", False),
            AlignerSegment("b", True),
            AlignerSegment("▅▅▅", True),
            AlignerSegment("c", False),
        ]

        targets, owners = mms._targets(segments)

        assert owners == [None, 0, 1, None, 3, None]
        assert [t == star for t in targets] == [True, False, False, True, False, True]
