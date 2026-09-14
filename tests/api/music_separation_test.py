import tempfile
from pathlib import Path
from unittest import mock

import pytest
from karaoke.music_separation import DEFAULT_MODEL, SeparationMethod, split_song


@pytest.fixture
def audio_file():
    """Fixture providing a test audio file."""
    return Path("assets/dev/understand/audio.m4a")


@pytest.fixture
def temp_output_dir():
    """Fixture providing a temporary output directory."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


def test_split_song_api_method(audio_file, temp_output_dir):
    """Test split_song with SeparationMethod.API."""
    with mock.patch("audio_separator.separator.Separator") as mock_separator:
        mock_instance = mock_separator.return_value
        mock_instance.separate.return_value = None

        # Create expected output files
        (temp_output_dir / "vocals.wav").write_text("mock vocals")
        (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

        accompaniment_path, vocals_path = split_song(
            audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.API
        )

        # Verify paths are correct
        assert accompaniment_path == temp_output_dir / "accompaniment.wav"
        assert vocals_path == temp_output_dir / "vocals.wav"
        assert accompaniment_path.exists()
        assert vocals_path.exists()

        # Verify separator was called correctly
        mock_separator.assert_called_once_with(
            output_dir=str(temp_output_dir),
            model_file_dir=mock.ANY,
        )
        mock_instance.load_model.assert_called_once_with(DEFAULT_MODEL)
        mock_instance.separate.assert_called_once_with(
            str(audio_file), {"Vocals": "vocals", "Instrumental": "accompaniment"}
        )


def test_split_song_subprocess_method(audio_file, temp_output_dir):
    """Test split_song with subprocess method."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.return_value.stdout = "separation complete"

        # Create expected output files
        (temp_output_dir / "vocals.wav").write_text("mock vocals")
        (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

        accompaniment_path, vocals_path = split_song(
            audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
        )

        # Verify paths are correct
        assert accompaniment_path == temp_output_dir / "accompaniment.wav"
        assert vocals_path == temp_output_dir / "vocals.wav"
        assert accompaniment_path.exists()
        assert vocals_path.exists()

        # Verify subprocess was called correctly
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert call_args[0] == "audio-separator"
        assert str(audio_file) in call_args
        assert "--output_dir" in call_args
        assert str(temp_output_dir) in call_args
        assert "--model_filename" in call_args
        assert DEFAULT_MODEL in call_args
        assert "--custom_output_names" in call_args


def test_split_song_invalid_method(audio_file, temp_output_dir):
    """Test split_song with invalid method raises ValueError."""
    with pytest.raises(ValueError, match="Invalid method 'invalid'"):
        split_song(audio_file, temp_output_dir, DEFAULT_MODEL, method="invalid")


def test_split_song_invalid_model(audio_file, temp_output_dir):
    """Test split_song with invalid model raises ValueError."""
    with pytest.raises(ValueError, match="Model invalid_model not found"):
        split_song(audio_file, temp_output_dir, "invalid_model")


def test_split_song_both_methods_same_output(audio_file, temp_output_dir):
    """Test that both methods produce the same output structure."""
    with mock.patch("audio_separator.separator.Separator") as mock_separator:
        mock_instance = mock_separator.return_value
        mock_instance.separate.return_value = None

        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value.stdout = "separation complete"

            # Create output files for both tests
            (temp_output_dir / "vocals.wav").write_text("mock vocals")
            (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

            # Test library method
            lib_accompaniment, lib_vocals = split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.API
            )

            # Clean up files for second test
            (temp_output_dir / "vocals.wav").unlink()
            (temp_output_dir / "accompaniment.wav").unlink()
            (temp_output_dir / "vocals.wav").write_text("mock vocals")
            (temp_output_dir / "accompaniment.wav").write_text("mock accompaniment")

            # Test subprocess method
            sub_accompaniment, sub_vocals = split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
            )

            # Verify both methods return the same paths
            assert lib_accompaniment == sub_accompaniment
            assert lib_vocals == sub_vocals
            assert lib_accompaniment.name == "accompaniment.wav"
            assert lib_vocals.name == "vocals.wav"


def test_split_song_subprocess_command_not_found(audio_file, temp_output_dir):
    """Test subprocess method when audio-separator command is not found."""
    with (
        mock.patch("subprocess.run", side_effect=FileNotFoundError()),
        pytest.raises(FileNotFoundError),
    ):
        split_song(
            audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
        )


def test_split_song_subprocess_command_fails(audio_file, temp_output_dir):
    """Test subprocess method when audio-separator command fails."""
    import subprocess

    with mock.patch("subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(
            1, "audio-separator", stderr="Error"
        )

        with pytest.raises(subprocess.CalledProcessError):
            split_song(
                audio_file, temp_output_dir, DEFAULT_MODEL, method=SeparationMethod.CLI
            )
