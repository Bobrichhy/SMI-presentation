"""Build the version-aware read-only bible.db from downloaded getbible json.

Run once (after downloading translations into data/raw/):
    python data/build_bible.py
Produces data/bible.db with every translation found in data/raw/.
"""

import json
import re
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE / "bible.db"

# filename (in data/raw, without .json) -> (code, display name, license, sort order)
TRANSLATIONS = {
    "kjv":         ("KJV", "King James Version", "Public Domain", 1),
    "web":         ("WEB", "World English Bible (modern)", "Public Domain", 2),
    "asv":         ("ASV", "American Standard Version", "Public Domain", 3),
    "ylt":         ("YLT", "Young's Literal Translation", "Public Domain", 4),
    "basicenglish":("BBE", "Bible in Basic English", "Public Domain", 5),
    "wb":          ("WB",  "Webster's Bible", "Public Domain", 6),
    "akjv":        ("AKJV","American King James Version", "Free non-commercial", 7),
    "douayrheims": ("DRB", "Douay-Rheims Bible", "Public Domain", 8),
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


OUT.unlink(missing_ok=True)
con = sqlite3.connect(OUT)
con.executescript(
    """
    CREATE TABLE translation (code TEXT PRIMARY KEY, name TEXT, license TEXT, ord INTEGER);
    CREATE TABLE book (translation TEXT, book_num INTEGER, book TEXT, book_norm TEXT);
    CREATE TABLE verse (translation TEXT, book_num INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
    """
)

built = []
for fname, (code, name, lic, order) in sorted(TRANSLATIONS.items(), key=lambda kv: kv[1][3]):
    path = RAW / f"{fname}.json"
    if not path.exists():
        print(f"  skip {code}: {path.name} not found")
        continue
    data = json.loads(path.read_text())
    con.execute("INSERT INTO translation VALUES (?,?,?,?)", (code, name, lic, order))

    verses, books = [], []
    for bk in data["books"]:
        bnum, bname = bk["nr"], bk["name"]
        books.append((code, bnum, bname, norm(bname)))
        for ch in bk["chapters"]:
            for v in ch["verses"]:
                verses.append((code, bnum, v["chapter"], v["verse"], v["text"].strip()))
    con.executemany("INSERT INTO book VALUES (?,?,?,?)", books)
    con.executemany("INSERT INTO verse VALUES (?,?,?,?,?)", verses)
    built.append((code, len(verses)))
    print(f"  + {code}: {len(verses)} verses")

con.executescript(
    """
    CREATE INDEX idx_verse ON verse(translation, book_num, chapter, verse);
    CREATE INDEX idx_book ON book(translation, book_norm);
    CREATE VIRTUAL TABLE verse_fts USING fts5(text, content='');
    """
)
con.execute("INSERT INTO verse_fts(rowid, text) SELECT rowid, text FROM verse")
con.commit()
con.close()

print(f"\nbuilt {OUT.name} with {len(built)} translations: " + ", ".join(c for c, _ in built))
