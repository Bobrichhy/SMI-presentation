"""Server-owned live state and WebSocket fan-out.

The server is the single source of truth for what is currently on the projector.
It stores *which* playlist item and slide are live (plus black/clear flags) and
resolves that into a concrete render payload that every connected client receives.

Because the server holds this state, a Live Output page opened late (e.g. after the
service has started, or after a projector reconnect) immediately gets the current
slide on connect — no click required.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional, Set

from fastapi import WebSocket

_DEFAULT_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"


def _slide_theme() -> dict:
    return {"font": _DEFAULT_FONT, "color": "#ffffff", "bg": "#000000",
            "bgImage": None, "bgVideo": None, "size": 6.0}


def _default_theme() -> dict:
    # Songs and scripture each get their own independent template (EasyWorship-style).
    return {"anim": "fade", "autoFit": True, "song": _slide_theme(), "scripture": _slide_theme()}


@dataclass
class LiveState:
    """What is currently live. The operator pushes a fully-resolved deck (list of
    slide dicts) on go_live; the server owns the live *position* and screen flags
    and is the source of truth for late joiners. Decks come from songs or scripture,
    so the same model drives both."""
    title: Optional[str] = None         # e.g. song title or "John 3:16-18 (KJV)"
    slides: list = field(default_factory=list)  # [{type, text|src, ref?}, ...]
    slide_index: int = 0
    source_id: Optional[int] = None     # PlaylistItem.id (for operator highlight)
    style_override: Optional[dict] = None   # per-item appearance (beats the template)
    black: bool = False                 # full black screen
    clear: bool = False                 # hide text (background only)
    # Background audio channel (independent of the visual deck).
    audio_src: Optional[str] = None
    audio_title: Optional[str] = None
    audio_playing: bool = False
    audio_loop: bool = False
    # Separate appearance templates for songs vs scripture (+ a shared transition).
    theme: dict = field(default_factory=_default_theme)
    # Stage clock / countdown overlay for the speaker.
    timer: dict = field(default_factory=lambda: {
        "mode": "off",          # off | clock | countdown
        "endsAt": None,         # epoch ms (countdown target)
        "label": "",
    })
    # Black-screen watermark / branding (shown when Black is pressed).
    branding: dict = field(default_factory=lambda: {
        "text": "SMI · Saints Ministry International",
        "logo": None,
    })
    # Lower-third / notice overlay shown OVER whatever is live (doesn't replace it).
    overlay: dict = field(default_factory=lambda: {
        "visible": False, "title": "", "subtitle": "", "position": "bottom",
    })
    # Message pushed to the stage/confidence monitor (e.g. "Wrap up").
    stage_message: str = ""

    def payload(self) -> dict:
        out = {
            "type": "state", "black": self.black, "clear": self.clear,
            "hasContent": False, "title": self.title, "sourceId": self.source_id,
            "styleOverride": self.style_override,
            "slideType": None, "slideText": None, "slideText2": None,
            "slideRef": None, "slideSrc": None,
            "design": None, "nextSlide": None, "stageMessage": self.stage_message,
            "slideIndex": 0, "totalSlides": len(self.slides),
            "audio": {
                "src": self.audio_src, "title": self.audio_title,
                "playing": self.audio_playing, "loop": self.audio_loop,
            },
            "theme": self.theme,
            "timer": {**self.timer, "now": int(time.time() * 1000)},
            "branding": self.branding,
            "overlay": self.overlay,
        }
        if not self.slides:
            return out
        idx = max(0, min(self.slide_index, len(self.slides) - 1))
        self.slide_index = idx
        slide = self.slides[idx]
        out.update(
            hasContent=True, slideType=slide.get("type", "verse"),
            slideText=slide.get("text", ""), slideText2=slide.get("text2"),
            slideRef=slide.get("ref"), slideSrc=slide.get("src"), slideIndex=idx,
        )
        if slide.get("type") == "design":
            out["design"] = slide          # full canvas (bg + elements) for the projector
        if idx + 1 < len(self.slides):
            out["nextSlide"] = self.slides[idx + 1]   # for the stage/confidence monitor
        return out


class ConnectionManager:
    """Tracks connected WebSocket clients and broadcasts payloads to all."""

    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def send(self, ws: WebSocket, payload: dict) -> None:
        await ws.send_json(payload)

    async def broadcast(self, payload: dict) -> None:
        async with self._lock:
            clients = list(self._clients)
        dead = []
        for ws in clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)
