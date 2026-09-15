"""Read-only Bible access: translations, reference lookup, and keyword search.

Backed by the bundled data/bible.db (version-aware). All scripture text here is
public domain / freely distributable. Copyrighted versions (NIV/NKJV/ESV/…) are
NOT bundled — they can only be added through a licensed online provider; see
app/providers.py for that adapter.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "bible.db"

_conn: Optional[sqlite3.Connection] = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def available() -> bool:
    return DB_PATH.exists()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# Canonical book aliases -> normalized canonical book key (matches book.book_norm).
_CANON = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]
_ALIASES: dict[str, str] = {_norm(b): _norm(b) for b in _CANON}
# Common short forms / variants.
_EXTRA = {
    "gen": "Genesis", "ex": "Exodus", "exo": "Exodus", "exod": "Exodus",
    "lev": "Leviticus", "num": "Numbers", "nu": "Numbers", "deut": "Deuteronomy",
    "dt": "Deuteronomy", "josh": "Joshua", "jos": "Joshua", "judg": "Judges",
    "jdg": "Judges", "rth": "Ruth", "1sam": "1 Samuel", "2sam": "2 Samuel",
    "1sa": "1 Samuel", "2sa": "2 Samuel", "1kgs": "1 Kings", "2kgs": "2 Kings",
    "1ki": "1 Kings", "2ki": "2 Kings", "1chr": "1 Chronicles", "2chr": "2 Chronicles",
    "neh": "Nehemiah", "est": "Esther", "ps": "Psalms", "psa": "Psalms",
    "psalm": "Psalms", "pss": "Psalms", "prov": "Proverbs", "prv": "Proverbs",
    "eccl": "Ecclesiastes", "ecc": "Ecclesiastes", "qoh": "Ecclesiastes",
    "song": "Song of Solomon", "sos": "Song of Solomon", "canticles": "Song of Solomon",
    "isa": "Isaiah", "jer": "Jeremiah", "lam": "Lamentations", "ezek": "Ezekiel",
    "eze": "Ezekiel", "dan": "Daniel", "hos": "Hosea", "obad": "Obadiah",
    "jon": "Jonah", "mic": "Micah", "nah": "Nahum", "hab": "Habakkuk",
    "zeph": "Zephaniah", "hag": "Haggai", "zech": "Zechariah", "zec": "Zechariah",
    "mal": "Malachi", "matt": "Matthew", "mt": "Matthew", "mk": "Mark",
    "mrk": "Mark", "lk": "Luke", "luk": "Luke", "jn": "John", "joh": "John",
    "rom": "Romans", "1cor": "1 Corinthians", "2cor": "2 Corinthians",
    "1co": "1 Corinthians", "2co": "2 Corinthians", "gal": "Galatians",
    "eph": "Ephesians", "phil": "Philippians", "php": "Philippians",
    "col": "Colossians", "1thess": "1 Thessalonians", "2thess": "2 Thessalonians",
    "1th": "1 Thessalonians", "2th": "2 Thessalonians", "1tim": "1 Timothy",
    "2tim": "2 Timothy", "1ti": "1 Timothy", "2ti": "2 Timothy", "tit": "Titus",
    "phlm": "Philemon", "phm": "Philemon", "heb": "Hebrews", "jas": "James",
    "jms": "James", "1pet": "1 Peter", "2pet": "2 Peter", "1pe": "1 Peter",
    "2pe": "2 Peter", "1jn": "1 John", "2jn": "2 John", "3jn": "3 John",
    "1jo": "1 John", "2jo": "2 John", "3jo": "3 John", "jud": "Jude",
    "rev": "Revelation", "rv": "Revelation", "apoc": "Revelation",
}
for k, v in _EXTRA.items():
    _ALIASES[_norm(k)] = _norm(v)


_REF_RE = re.compile(r"^\s*(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?\s*$")


def translations() -> list[dict]:
    rows = _db().execute(
        "SELECT code, name, license FROM translation ORDER BY ord"
    ).fetchall()
    return [dict(r) for r in rows]


def _default_translation() -> str:
    row = _db().execute("SELECT code FROM translation ORDER BY ord LIMIT 1").fetchone()
    return row["code"] if row else "KJV"


def books(translation: str) -> list[dict]:
    rows = _db().execute(
        "SELECT book_num, book FROM book WHERE translation=? ORDER BY book_num",
        (translation,),
    ).fetchall()
    out = []
    for r in rows:
        last = _db().execute(
            "SELECT MAX(chapter) c FROM verse WHERE translation=? AND book_num=?",
            (translation, r["book_num"]),
        ).fetchone()
        out.append({"book_num": r["book_num"], "book": r["book"], "chapters": last["c"]})
    return out


def _resolve_book(translation: str, token: str) -> Optional[sqlite3.Row]:
    key = _ALIASES.get(_norm(token), _norm(token))
    row = _db().execute(
        "SELECT book_num, book FROM book WHERE translation=? AND book_norm=?",
        (translation, key),
    ).fetchone()
    if row:
        return row
    # Fall back: prefix match on the normalized name (handles odd spellings).
    row = _db().execute(
        "SELECT book_num, book FROM book WHERE translation=? AND book_norm LIKE ? ORDER BY book_num LIMIT 1",
        (translation, key + "%"),
    ).fetchone()
    return row


def parse_reference(ref: str):
    """'John 3:16-18' -> ('John', 3, 16, 18). Whole chapter -> verses None."""
    m = _REF_RE.match(ref or "")
    if not m:
        return None
    book, chapter, v1, v2 = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    v1 = int(v1) if v1 else None
    v2 = int(v2) if v2 else v1
    return book, chapter, v1, v2


def lookup(ref: str, translation: Optional[str] = None) -> dict:
    """Resolve a reference into a passage with one slide per verse."""
    translation = translation or _default_translation()
    parsed = parse_reference(ref)
    if not parsed:
        return {"ok": False, "error": "Could not understand that reference."}
    token, chapter, v1, v2 = parsed
    book = _resolve_book(translation, token)
    if not book:
        return {"ok": False, "error": f"Unknown book: '{token}'."}

    if v1 is None:
        rows = _db().execute(
            "SELECT chapter, verse, text FROM verse WHERE translation=? AND book_num=? AND chapter=? ORDER BY verse",
            (translation, book["book_num"], chapter),
        ).fetchall()
    else:
        rows = _db().execute(
            "SELECT chapter, verse, text FROM verse WHERE translation=? AND book_num=? AND chapter=? "
            "AND verse BETWEEN ? AND ? ORDER BY verse",
            (translation, book["book_num"], chapter, v1, v2),
        ).fetchall()

    if not rows:
        return {"ok": False, "error": "No verses found for that reference."}

    name = book["book"]
    if v1 is None:
        reference = f"{name} {chapter}"
    elif v2 and v2 != v1:
        reference = f"{name} {chapter}:{v1}-{v2}"
    else:
        reference = f"{name} {chapter}:{v1}"

    verses = [
        {"ref": f"{name} {r['chapter']}:{r['verse']}", "verse": r["verse"], "text": r["text"]}
        for r in rows
    ]
    slides = [
        {"type": "scripture", "text": v["text"], "ref": v["ref"], "translation": translation}
        for v in verses
    ]
    return {
        "ok": True,
        "reference": reference,
        "translation": translation,
        "book": name,
        "chapter": chapter,
        "start": rows[0]["verse"],
        "end": rows[-1]["verse"],
        "verses": verses,
        "slides": slides,
    }


def chapter(translation: str, book_token: str, chapter_num: int) -> dict:
    """Return every verse of a chapter (used by the browser + continuous reading)."""
    translation = translation or _default_translation()
    book = _resolve_book(translation, book_token)
    if not book:
        return {"ok": False, "error": f"Unknown book: '{book_token}'."}
    rows = _db().execute(
        "SELECT verse, text FROM verse WHERE translation=? AND book_num=? AND chapter=? ORDER BY verse",
        (translation, book["book_num"], chapter_num),
    ).fetchall()
    if not rows:
        return {"ok": False, "error": "No verses found."}
    last = _db().execute(
        "SELECT MAX(chapter) c FROM verse WHERE translation=? AND book_num=?",
        (translation, book["book_num"]),
    ).fetchone()["c"]
    name = book["book"]
    verses = [
        {"ref": f"{name} {chapter_num}:{r['verse']}", "verse": r["verse"], "text": r["text"]}
        for r in rows
    ]
    return {
        "ok": True, "translation": translation, "book": name,
        "chapter": chapter_num, "chapters": last, "verses": verses,
    }


def search(query: str, translation: Optional[str] = None, limit: int = 150) -> dict:
    """Find every verse containing the given words/phrase.

    Tokens are matched as prefixes (so "love" also finds "loved", "loveth") and
    ALL must be present (AND). Results are ordered by relevance (FTS5 bm25), so the
    closest match to a typed phrase floats to the top.
    """
    translation = translation or _default_translation()
    tokens = re.findall(r"\w+", (query or "").lower())
    if not tokens:
        return {"ok": True, "results": [], "count": 0, "terms": []}
    # Prefix match each token; space = implicit AND in FTS5.
    fts = " ".join(f"{t}*" for t in tokens)
    try:
        rows = _db().execute(
            """
            SELECT b.book AS book, v.chapter AS chapter, v.verse AS verse, v.text AS text
            FROM verse_fts f
            JOIN verse v ON v.rowid = f.rowid
            JOIN book  b ON b.translation = v.translation AND b.book_num = v.book_num
            WHERE f.text MATCH ? AND v.translation = ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts, translation, limit),
        ).fetchall()
    except Exception:
        return {"ok": True, "results": [], "count": 0, "terms": tokens}
    results = [
        {"ref": f"{r['book']} {r['chapter']}:{r['verse']}", "text": r["text"]}
        for r in rows
    ]
    return {"ok": True, "results": results, "count": len(results),
            "capped": len(results) >= limit, "terms": tokens}
