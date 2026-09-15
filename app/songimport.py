"""Import songs from pasted text or files, so operators stop re-typing lyrics.

Supports:
- Smart plain text / clipboard paste (blank-line blocks, section labels, CCLI footer
  stripping, ChordPro chords + directives).
- CCLI SongSelect text exports (same path as smart text).
- OpenLyrics .xml (OpenLP and others).
- OpenSong / SongSelect .usr xml.
- ProPresenter .pro4/.pro6 (best-effort RTF extraction). PP7 .pro is binary -> guidance.

Every parser returns {"title": str, "slides": [{"type": "verse|chorus|bridge", "text": str}]}.
"""

from __future__ import annotations

import base64
import html
import re
import xml.etree.ElementTree as ET

# A whole line that's just a section label, e.g. "Verse 1", "[Chorus]", "(Bridge)", "C2:".
_SECTION_RE = re.compile(
    r"^\s*[\[\(]?\s*(verse|vs|chorus|pre[\s-]?chorus|bridge|tag|intro|outro|ending|"
    r"refrain|interlude|vamp|coda|hook)\s*\d*\s*[\]\)]?\s*:?\s*$", re.I)
_SHORT_LABEL_RE = re.compile(r"^\s*[\[\(]?\s*(v|c|b|p|pc|t|r)\s*\d*\s*[\]\)]?\s*:?\s*$", re.I)
# Inline chords like [G], [Am7], [D/F#] (not section labels).
_CHORD_RE = re.compile(r"\[(?:[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d?(?:/[A-G][#b]?)?)\]")
# Footer / metadata lines to drop.
_FOOTER_RE = re.compile(
    r"^\s*(ccli|©|\(c\)|copyright|words and music|music and words|administ|"
    r"public domain|used by permission|all rights reserved|songselect|verse order)", re.I)


def _label_type(line: str):
    m = _SECTION_RE.match(line)
    if m:
        name = m.group(1).lower().replace(" ", "").replace("-", "")
        if name in ("chorus", "refrain", "hook"):
            return "chorus"
        if name == "bridge":
            return "bridge"
        return "verse"
    m = _SHORT_LABEL_RE.match(line)
    if m:
        c = m.group(1).lower()
        return {"c": "chorus", "b": "bridge"}.get(c, "verse")
    return None


def parse_text(text: str) -> dict:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    ct = re.search(r"\{\s*(?:title|t)\s*:\s*([^}]*)\}", text, re.I)
    chordpro_title = ct.group(1).strip() if ct else None
    cm = re.search(r"CCLI\s*(?:Song)?\s*#?\s*([0-9]{3,})", text, re.I)
    ccli = cm.group(1) if cm else None
    lines = []
    for ln in text.split("\n"):
        ln = _CHORD_RE.sub("", ln)              # strip inline chords
        ln = re.sub(r"\{[^}]*\}", "", ln)        # strip ChordPro {directives}
        if _FOOTER_RE.match(ln):
            continue                             # drop CCLI/copyright metadata
        lines.append(ln.rstrip())

    # Group into blocks: blank lines separate; a standalone label starts a new block.
    blocks, cur = [], []
    for ln in lines:
        if ln.strip() == "":
            if cur:
                blocks.append(cur); cur = []
        elif _label_type(ln) is not None:
            if cur:
                blocks.append(cur)
            cur = [ln]
        else:
            cur.append(ln)
    if cur:
        blocks.append(cur)

    # Title: a lone first line that isn't a section label.
    title = ""
    if blocks and len(blocks[0]) == 1 and _label_type(blocks[0][0]) is None and len(blocks[0][0]) <= 60:
        title = blocks[0][0].strip()
        blocks = blocks[1:]

    slides = []
    for blk in blocks:
        typ = "verse"
        if blk and _label_type(blk[0]) is not None:
            typ = _label_type(blk[0])
            blk = blk[1:]
        body = "\n".join(blk).strip("\n").rstrip()
        if body.strip():
            slides.append({"type": typ, "text": body})

    return {"title": chordpro_title or title or "Untitled", "slides": slides, "ccli": ccli}


def _strip_ns(tag: str) -> str:
    return tag.split("}")[-1]


def _lines_text(el) -> str:
    s = ET.tostring(el, encoding="unicode")
    s = re.sub(r"<[^>]*\bbr\b[^>]*>", "\n", s, flags=re.I)   # br, even namespaced
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def parse_openlyrics(data: bytes) -> dict:
    root = ET.fromstring(data)
    title = "Untitled"
    for el in root.iter():
        if _strip_ns(el.tag) == "title" and el.text:
            title = el.text.strip()
            break
    slides = []
    for verse in root.iter():
        if _strip_ns(verse.tag) != "verse":
            continue
        name = (verse.get("name") or "").lower()
        typ = "chorus" if name.startswith("c") else "bridge" if name.startswith("b") else "verse"
        parts = [_lines_text(le) for le in verse if _strip_ns(le.tag) == "lines"]
        body = "\n".join(p for p in parts if p).strip()
        if body:
            slides.append({"type": typ, "text": body})
    return {"title": title, "slides": slides}


def parse_opensong(data: bytes) -> dict:
    root = ET.fromstring(data)
    title, lyr = "Untitled", ""
    for el in root.iter():
        t = _strip_ns(el.tag)
        if t == "title" and el.text:
            title = el.text.strip()
        elif t == "lyrics" and el.text:
            lyr = el.text
    out = []
    for line in lyr.split("\n"):
        st = line.strip()
        if st.startswith(".") or st.startswith(";"):   # chord / comment lines
            continue
        out.append(re.sub(r"^ ", "", line.rstrip()))    # drop one indent space
    res = parse_text("\n".join(out))
    res["title"] = title
    return res


def _strip_rtf(rtf: str) -> str:
    rtf = re.sub(r"\\par[d]?\b", "\n", rtf)
    rtf = re.sub(r"\\line\b", "\n", rtf)
    rtf = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: bytes([int(m.group(1), 16)]).decode("latin-1", "ignore"), rtf)
    rtf = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", rtf)        # control words
    rtf = rtf.replace("{", "").replace("}", "")
    rtf = re.sub(r"\\[^a-zA-Z]", "", rtf)
    return rtf.strip()


def parse_propresenter(data: bytes, filename: str) -> dict:
    if filename.lower().endswith(".pro"):
        return {"title": "", "slides": [],
                "error": "ProPresenter 7 (.pro) is a binary format. Please export the song as plain text and paste it instead."}
    try:
        root = ET.fromstring(data)
    except Exception:
        return {"title": "", "slides": [], "error": "Couldn't read that ProPresenter file."}
    title = root.get("CCLISongTitle") or root.get("CCLITitle") or root.get("docname") or "Untitled"
    slides = []
    for el in root.iter():
        rtf_b64 = el.get("RTFData")
        if not rtf_b64:
            continue
        try:
            rtf = base64.b64decode(rtf_b64).decode("utf-8", "ignore")
            txt = _strip_rtf(rtf)
            if txt.strip():
                slides.append({"type": "verse", "text": txt})
        except Exception:
            pass
    return {"title": title, "slides": slides}


def import_file(filename: str, data: bytes) -> dict:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    head = data[:600].decode("utf-8", "ignore").lower()
    if ext in ("pro", "pro4", "pro5", "pro6"):
        return parse_propresenter(data, filename)
    if ext == "xml" or head.lstrip().startswith("<?xml") or "<song" in head:
        if "openlyrics" in head:
            return parse_openlyrics(data)
        try:
            return parse_opensong(data)
        except Exception:
            try:
                return parse_openlyrics(data)
            except Exception:
                pass
    return parse_text(data.decode("utf-8", "ignore"))
