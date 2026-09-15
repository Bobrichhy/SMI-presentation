"""Optional online providers for COPYRIGHTED translations (ESV, NIV, NKJV, …).

These versions cannot be legally bundled offline. Instead, the operator supplies
their own licensed API key and the app fetches verses live. Nothing here ships any
copyrighted text — it only calls an API the user is authorized to use.

Enable by setting environment variables before launching:

    ESV_API_KEY=...        # free for non-commercial use: https://api.esv.org/
    API_BIBLE_KEY=...      # https://scripture.api.bible/  (carries NKJV and others
                           # subject to each publisher's terms; NIV is generally
                           # NOT available even here without direct permission)
    API_BIBLE_IDS=NKJV:de4e12af7f28f599-02,...   # code:bibleId pairs

If no keys are set, only the bundled public-domain versions are offered.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx


def online_translations() -> list[dict]:
    """Extra translations available because the user configured a provider key."""
    out = []
    if os.environ.get("ESV_API_KEY"):
        out.append({"code": "ESV", "name": "English Standard Version (online)", "license": "Licensed via api.esv.org", "online": True})
    for code, _ in _api_bible_map().items():
        out.append({"code": code, "name": f"{code} (online)", "license": "Licensed via api.bible", "online": True})
    return out


def is_online(code: str) -> bool:
    if code == "ESV" and os.environ.get("ESV_API_KEY"):
        return True
    return code in _api_bible_map()


def lookup(reference: str, code: str) -> Optional[dict]:
    """Return a passage dict (same shape as bible.lookup) or None if unsupported."""
    if code == "ESV" and os.environ.get("ESV_API_KEY"):
        return _esv_lookup(reference)
    if code in _api_bible_map():
        return _api_bible_lookup(reference, code)
    return None


# --- ESV API ---------------------------------------------------------------

def _esv_lookup(reference: str) -> dict:
    try:
        r = httpx.get(
            "https://api.esv.org/v3/passage/text/",
            params={
                "q": reference, "include-headings": False, "include-footnotes": False,
                "include-verse-numbers": False, "include-short-copyright": False,
                "include-passage-references": False,
            },
            headers={"Authorization": f"Token {os.environ['ESV_API_KEY']}"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        passages = data.get("passages") or []
        if not passages:
            return {"ok": False, "error": "Passage not found (ESV)."}
        text = passages[0].strip()
        canonical = data.get("canonical", reference)
        slides = [{"type": "scripture", "text": p.strip(), "ref": canonical, "translation": "ESV"}
                  for p in text.split("\n\n") if p.strip()]
        return {"ok": True, "reference": canonical, "translation": "ESV",
                "verses": [{"ref": canonical, "text": text}], "slides": slides or
                [{"type": "scripture", "text": text, "ref": canonical, "translation": "ESV"}]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"ESV API error: {e}"}


# --- API.Bible -------------------------------------------------------------

def _api_bible_map() -> dict[str, str]:
    if not os.environ.get("API_BIBLE_KEY"):
        return {}
    pairs = os.environ.get("API_BIBLE_IDS", "")
    out = {}
    for pair in pairs.split(","):
        if ":" in pair:
            code, bible_id = pair.split(":", 1)
            out[code.strip().upper()] = bible_id.strip()
    return out


def _api_bible_lookup(reference: str, code: str) -> dict:
    bible_id = _api_bible_map().get(code)
    try:
        # Resolve the human reference to a passage id via search, then fetch text.
        r = httpx.get(
            f"https://api.scripture.api.bible/v1/bibles/{bible_id}/search",
            params={"query": reference, "limit": 1},
            headers={"api-key": os.environ["API_BIBLE_KEY"]},
            timeout=15,
        )
        r.raise_for_status()
        passages = r.json().get("data", {}).get("passages") or []
        if not passages:
            return {"ok": False, "error": f"Passage not found ({code})."}
        p = passages[0]
        import re
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", p.get("content", ""))).strip()
        ref = p.get("reference", reference)
        return {"ok": True, "reference": ref, "translation": code,
                "verses": [{"ref": ref, "text": text}],
                "slides": [{"type": "scripture", "text": text, "ref": ref, "translation": code}]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"API.Bible error: {e}"}
