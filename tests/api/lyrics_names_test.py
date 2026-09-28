import pytest

from api.lyrics.names import cleaned


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Glim Tovar (Pelto's Moonlit Radio Edit)", "Glim Tovar"),
        ("Glim Tovar [Live]", "Glim Tovar"),
        ("Glim Tovar (Bree (Night) Mix)", "Glim Tovar"),
        ("Glim Tovar - Remastered 2011", "Glim Tovar"),
        ("Glim Tovar - Radio Edit", "Glim Tovar"),
        ("Glim Tovar – Live at the Old Mill", "Glim Tovar"),
        ("Glim Tovar - Single Version", "Glim Tovar"),
        ("Glim Tovar - Mono", "Glim Tovar"),
        ("Glim Tovar feat. Anka Rell", "Glim Tovar"),
        ("Glim Tovar ft. Anka Rell", "Glim Tovar"),
        ("Glim Tovar Featuring Anka Rell", "Glim Tovar"),
        ("The Wendels feat. Anka Rell", "The Wendels"),
        ("Glim Tovar (feat. Anka Rell) - Radio Edit", "Glim Tovar"),
    ],
)
def test_it_strips_what_databases_leave_out(text, expected):
    assert cleaned(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Glim Tovar",
        "  Glim   Tovar ",
        # A dash that names no version is part of the title.
        "Glim - Tovar",
        # "ft." inside a word isn't a featured artist.
        "Loft. Nine",
    ],
)
def test_it_returns_none_when_nothing_changes(text):
    assert cleaned(text) is None


def test_it_returns_none_when_nothing_would_be_left():
    assert cleaned("(Intro)") is None
