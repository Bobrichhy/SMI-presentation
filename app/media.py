"""Media handling: save uploads and turn PDFs into image slide decks.

Files live under <project>/media/<uuid>/. Images and rendered PDF pages become
`image` slides ({"type": "image", "src": "/media/.../page-1.png"}) so they flow
through the exact same live-deck pipeline as songs and scripture. Audio is stored
as-is and played by the Live Output as a background track.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import fitz  # PyMuPDF

from . import paths

MEDIA_DIR = paths.user_data_dir() / "media"
FONTS_DIR = paths.user_data_dir() / "fonts"

# Server-side upload caps, so a mistaken or malicious huge upload can't fill the
# disk — the client-side progress UI alone doesn't stop anything. Overridable via
# env for installs that legitimately need bigger service-recording videos, etc.
MAX_UPLOAD_BYTES = int(os.environ.get("SMI_MAX_UPLOAD_MB", "1024")) * 1024 * 1024
MAX_FONT_BYTES = int(os.environ.get("SMI_MAX_FONT_MB", "25")) * 1024 * 1024


class UploadTooLarge(ValueError):
    """Raised by stream_to_file() when an upload exceeds its size cap."""


def stream_to_file(src, dest_path: Path, max_bytes: int, chunk_size: int = 1024 * 1024) -> None:
    """Copy a file-like upload to disk in chunks, aborting (and deleting the
    partial file) as soon as it exceeds max_bytes — so an oversized upload never
    fully lands on disk before being rejected."""
    written = 0
    with open(dest_path, "wb") as out:
        while True:
            chunk = src.read(chunk_size)
            if not chunk:
                return
            written += len(chunk)
            if written > max_bytes:
                out.close()
                dest_path.unlink(missing_ok=True)
                raise UploadTooLarge(f"File too large — max {max_bytes // (1024 * 1024)} MB.")
            out.write(chunk)

FONT_EXTS = {".ttf": "truetype", ".otf": "opentype", ".woff": "woff", ".woff2": "woff2"}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"}
PDF_EXTS = {".pdf"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".wmv", ".flv",
              ".m4v", ".mpeg", ".mpg", ".3gp", ".ogv", ".ts"}
# Formats browsers play natively; everything else gets transcoded to mp4.
WEB_VIDEO_EXTS = {".mp4", ".webm"}

# Render PDF pages at this zoom (2.0 ~ 144 DPI — crisp on a projector).
PDF_ZOOM = 2.0


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def kind_for(filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in PDF_EXTS:
        return "pdf"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in VIDEO_EXTS:
        return "video"
    return None


def _url(rel: Path) -> str:
    return "/media/" + rel.as_posix()


def save_upload(filename: str, src_path: Path) -> dict:
    """Persist an already-on-disk upload and return a dict ready to build a
    MediaItem. `src_path` is a temp file holding the uploaded bytes (streamed,
    so large videos never sit fully in memory).

    Returns: {kind, title, filename, src, slides}.
    Raises ValueError for unsupported types.
    """
    kind = kind_for(filename)
    if kind is None:
        raise ValueError(f"Unsupported file type: {filename}")

    token = uuid.uuid4().hex[:12]
    folder = MEDIA_DIR / token
    folder.mkdir(parents=True, exist_ok=True)
    title = Path(filename).stem

    if kind == "image":
        ext = Path(filename).suffix.lower()
        dest = folder / f"image{ext}"
        shutil.copyfile(src_path, dest)
        src = _url(dest.relative_to(MEDIA_DIR))
        return {"kind": "image", "title": title, "filename": filename,
                "src": src, "slides": [{"type": "image", "src": src}]}

    if kind == "audio":
        ext = Path(filename).suffix.lower()
        dest = folder / f"audio{ext}"
        shutil.copyfile(src_path, dest)
        src = _url(dest.relative_to(MEDIA_DIR))
        return {"kind": "audio", "title": title, "filename": filename,
                "src": src, "slides": None}

    if kind == "video":
        ext = Path(filename).suffix.lower()
        orig = folder / f"source{ext}"
        shutil.copyfile(src_path, orig)
        # Web-friendly formats stream as-is; anything else is transcoded to mp4.
        if ext in WEB_VIDEO_EXTS:
            play_path = orig
        elif _has_ffmpeg():
            play_path = folder / "video.mp4"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(orig), "-c:v", "libx264",
                     "-preset", "veryfast", "-crf", "23", "-c:a", "aac",
                     "-movflags", "+faststart", str(play_path)],
                    check=True, capture_output=True, timeout=1800,
                )
                orig.unlink(missing_ok=True)
            except Exception as e:  # noqa: BLE001
                raise ValueError(f"Could not convert video: {e}")
        else:
            play_path = orig  # best effort; browser may not support it
        src = _url(play_path.relative_to(MEDIA_DIR))
        poster = None
        if _has_ffmpeg():
            poster_path = folder / "poster.jpg"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-ss", "1", "-i", str(play_path),
                     "-frames:v", "1", "-vf", "scale=480:-1", str(poster_path)],
                    check=True, capture_output=True, timeout=120,
                )
                if poster_path.exists():
                    poster = _url(poster_path.relative_to(MEDIA_DIR))
            except Exception:
                poster = None
        return {"kind": "video", "title": title, "filename": filename, "src": src,
                "slides": [{"type": "video", "src": src, "poster": poster}]}

    # PDF -> one image slide per page
    pdf_path = folder / "source.pdf"
    shutil.copyfile(src_path, pdf_path)
    slides = []
    matrix = fitz.Matrix(PDF_ZOOM, PDF_ZOOM)
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img_path = folder / f"page-{i}.png"
            pix.save(img_path)
            slides.append({"type": "image", "src": _url(img_path.relative_to(MEDIA_DIR))})
    if not slides:
        raise ValueError("PDF had no renderable pages.")
    return {"kind": "pdf", "title": title, "filename": filename,
            "src": slides[0]["src"], "slides": slides}


def save_font(filename: str, src_path: Path) -> dict:
    """Store an uploaded font file and return {family, filename, src, fmt}."""
    ext = Path(filename).suffix.lower()
    if ext not in FONT_EXTS:
        raise ValueError(f"Unsupported font type: {filename} (use ttf/otf/woff/woff2)")
    token = uuid.uuid4().hex[:12]
    folder = FONTS_DIR / token
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"font{ext}"
    shutil.copyfile(src_path, dest)
    family = re.sub(r"[^A-Za-z0-9 ]", " ", Path(filename).stem).strip() or "Custom Font"
    return {"family": family, "filename": filename,
            "src": "/fonts/" + dest.relative_to(FONTS_DIR).as_posix(),
            "fmt": FONT_EXTS[ext]}


def delete_font_files(src: str | None) -> None:
    if not src or not src.startswith("/fonts/"):
        return
    folder = (FONTS_DIR / src[len("/fonts/"):]).parent
    try:
        if folder.is_dir() and folder.resolve().is_relative_to(FONTS_DIR.resolve()):
            for f in folder.iterdir():
                f.unlink(missing_ok=True)
            folder.rmdir()
    except Exception:
        pass


def delete_files(src: str | None, slides: list | None) -> None:
    """Remove the upload folder for a media item (best-effort)."""
    sample = src or (slides[0]["src"] if slides else None)
    if not sample or not sample.startswith("/media/"):
        return
    rel = sample[len("/media/"):]
    folder = (MEDIA_DIR / rel).parent
    try:
        if folder.is_dir() and folder.resolve().is_relative_to(MEDIA_DIR.resolve()):
            for f in folder.iterdir():
                f.unlink(missing_ok=True)
            folder.rmdir()
    except Exception:
        pass
