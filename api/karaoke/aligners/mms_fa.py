"""MMS_FA, torchaudio's wav2vec2 CTC model trained on speech in over 1,100 languages.

It times every character, so a segment starts at its first character, whatever the
segment's size. Text is romanized first, since the model only knows Latin letters.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from api import settings
from api.karaoke.aligners import AlignerSegment, SegmentAlignment
from api.karaoke.separation_progress import ProgressCallback

# torch is imported only once the aligner is built, and numpy only by the caller, so a
# web server can read the version for a job's hash without either.
if TYPE_CHECKING:
    import numpy as np
    import torch

_STAR = "*"
_BLANK = "-"

# wav2vec2's attention over a whole song would not fit in memory. Each chunk is
# computed with a second of audio on either side, so its edges have context.
_CHUNK_SECONDS = 30
_CONTEXT_SECONDS = 1

# CTC marks a character a little after it begins. Against hand timings on 13 songs,
# the lag was 190 ms at the median.
_START_LAG_SECONDS = 0.19


class MmsFaAligner:
    name = "mms_fa"
    version = "1"
    # The bundle's own, which reading would import torchaudio.
    sample_rate = 16_000
    # It flags 6% of segments, and caught two thirds of those more than 300 ms off.
    doubtful_below = 0.05

    def __init__(self, model_dir: Path | None = None):
        import torch

        self._model_dir = model_dir or settings.MODELS_DIR / "mms_fa"
        self._dictionary = _bundle().get_dict(star=_STAR)
        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._model: torch.nn.Module | None = None
        self._uroman = None

    def align(
        self,
        audio: np.ndarray,
        segments: list[AlignerSegment],
        on_progress: ProgressCallback | None = None,
    ) -> list[SegmentAlignment]:
        """Place the segments with a forced alignment over the whole audio."""
        import torch
        import torchaudio

        alignments = [SegmentAlignment() for _ in segments]
        targets, owners = self._targets(segments)
        # The conv front end needs a few hundred samples to produce a single frame.
        if (
            not any(owner is not None for owner in owners)
            or len(audio) < self.sample_rate // 10
        ):
            return alignments

        emission = self._emission(audio, on_progress)
        seconds_per_frame = len(audio) / self.sample_rate / emission.shape[0]
        try:
            labels, scores = torchaudio.functional.forced_align(
                emission.unsqueeze(0).cpu(),
                torch.tensor([targets], dtype=torch.int32),
                blank=self._dictionary[_BLANK],
            )
        except RuntimeError:
            # The lyrics have more characters than the audio has frames.
            return alignments
        spans = torchaudio.functional.merge_tokens(labels[0], scores[0].exp())

        by_segment: dict[int, list] = {}
        for owner, span in zip(owners, spans, strict=True):
            if owner is not None:
                by_segment.setdefault(owner, []).append(span)
        for i, segment_spans in by_segment.items():
            frames = sum(span.end - span.start for span in segment_spans)
            alignments[i].start = max(
                0.0, segment_spans[0].start * seconds_per_frame - _START_LAG_SECONDS
            )
            alignments[i].confidence = (
                sum(span.score * (span.end - span.start) for span in segment_spans)
                / frames
            )
        return alignments

    def _targets(
        self, segments: list[AlignerSegment]
    ) -> tuple[list[int], list[int | None]]:
        """Return the token sequence and, for each token, the segment it belongs to.

        A star token, which matches any audio, goes before the lyrics and after every
        line, so ad-libs, kept backing vocals and other voices' lines have somewhere
        to go other than the nearest word.
        """
        star = self._dictionary[_STAR]
        targets = [star]
        owners: list[int | None] = [None]
        for i, segment in enumerate(segments):
            for token in self._tokens(segment.text):
                targets.append(token)
                owners.append(i)
            if segment.ends_line and targets[-1] != star:
                targets.append(star)
                owners.append(None)
        if targets[-1] != star:
            targets.append(star)
            owners.append(None)
        return targets, owners

    def _tokens(self, text: str) -> list[int]:
        """Return the tokens of the text, without what the model has no token for.

        Digits and symbols are dropped, so `1999` or `▅▅▅` gets no times.
        """
        romanized = self._romanizer().romanize_string(text).lower().replace("’", "'")
        return [
            self._dictionary[char]
            for char in romanized
            if char in self._dictionary and char not in (_BLANK, _STAR)
        ]

    def _emission(
        self, audio: np.ndarray, on_progress: ProgressCallback | None
    ) -> torch.Tensor:
        """Return the model's log probabilities, a row per frame of the audio."""
        import torch

        model = self._load_model()
        waveform = torch.from_numpy(audio).float().unsqueeze(0).to(self._device)
        total = waveform.shape[1]
        chunk = _CHUNK_SECONDS * self.sample_rate
        context = _CONTEXT_SECONDS * self.sample_rate
        begins = range(0, total, chunk)
        parts = []
        for count, begin in enumerate(begins):
            end = min(begin + chunk, total)
            low = max(0, begin - context)
            high = min(total, end + context)
            with torch.inference_mode():
                emission, _ = model(waveform[:, low:high])
            frames_per_sample = emission.shape[1] / (high - low)
            first = round((begin - low) * frames_per_sample)
            last = round((end - low) * frames_per_sample)
            parts.append(emission[0, first:last])
            if on_progress:
                on_progress((count + 1) / len(begins), "aligning the lyrics")
        return torch.cat(parts)

    def _load_model(self) -> torch.nn.Module:
        if self._model is None:
            model = _bundle().get_model(
                with_star=True, dl_kwargs={"model_dir": str(self._model_dir)}
            )
            self._model = model.to(self._device).eval()
        return self._model

    def _romanizer(self):
        if self._uroman is None:
            import uroman

            self._uroman = uroman.Uroman()
        return self._uroman


def _bundle():
    import torchaudio

    return torchaudio.pipelines.MMS_FA
