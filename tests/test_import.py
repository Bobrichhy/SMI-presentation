"""Unit tests for the song-import parsers (pure functions, no server)."""

from app import songimport


def test_plain_paste_title_and_sections():
    d = songimport.parse_text(
        "Amazing Grace\n\nVerse 1\nAmazing grace how sweet\n\nChorus\nMy chains are gone\n\nVerse 2\n'Twas grace")
    assert d["title"] == "Amazing Grace"
    assert [s["type"] for s in d["slides"]] == ["verse", "chorus", "verse"]
    assert "Amazing grace" in d["slides"][0]["text"]


def test_ccli_footer_stripped_and_number_extracted():
    d = songimport.parse_text(
        "Build My Life\n\nVerse 1\nWorthy of every song\n\nCCLI Song # 7070345\n© 2016 Some Music\nCCLI License # 12345")
    assert d["ccli"] == "7070345"
    for s in d["slides"]:
        assert "CCLI" not in s["text"] and "©" not in s["text"]


def test_chordpro_chords_and_title():
    d = songimport.parse_text("{title: Test Song}\n[G]Amazing [C]grace how [G]sweet\n[D]saved a [G]wretch")
    assert d["title"] == "Test Song"
    assert "[G]" not in d["slides"][0]["text"] and "[C]" not in d["slides"][0]["text"]


def test_dual_language_separator_is_not_a_section():
    # parse_text doesn't split languages (the editor does), but --- shouldn't crash/label.
    d = songimport.parse_text("Verse 1\nHello\n\nChorus\nWorld")
    assert d["slides"][1]["type"] == "chorus"


def test_openlyrics_br_becomes_newline():
    xml = (b'<?xml version="1.0"?><song xmlns="http://openlyrics.info/namespace/2009/song">'
           b'<properties><titles><title>How Great</title></titles></properties>'
           b'<lyrics><verse name="v1"><lines>O Lord my God<br/>when I wonder</lines></verse>'
           b'<verse name="c"><lines>Then sings my soul</lines></verse></lyrics></song>')
    d = songimport.parse_openlyrics(xml)
    assert d["title"] == "How Great"
    assert d["slides"][0]["text"] == "O Lord my God\nwhen I wonder"
    assert d["slides"][1]["type"] == "chorus"


def test_propresenter_pro_is_unsupported_with_guidance():
    d = songimport.parse_propresenter(b"\x08\x01binary", "song.pro")
    assert "error" in d and "ProPresenter 7" in d["error"]


def test_import_file_dispatches_by_extension():
    d = songimport.import_file("lyrics.txt", b"My Song\n\nVerse 1\nLine one")
    assert d["title"] == "My Song"
