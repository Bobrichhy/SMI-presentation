"""Database models and API schemas.

A Song owns an ordered JSON list of slides. The playlist is a single ordered
list of items (only songs for the MVP) representing the current order of service.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel
from sqlmodel import JSON, Column, Field, SQLModel


# --- Persisted tables -------------------------------------------------------

class Song(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    # Ordered list of slides, each: {"type": "verse"|"chorus"|"bridge", "text": str}
    slides: List[dict] = Field(default_factory=list, sa_column=Column(JSON))
    # Optional per-song appearance override (font/color/bg/...); null = use template.
    style: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    ccli: Optional[str] = None       # CCLI song number, for usage reporting


class UsageLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    song_id: Optional[int] = None
    title: str
    ccli: Optional[str] = None
    service: Optional[str] = None
    at: str = ""                     # ISO-8601 timestamp


class Presentation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    # Ordered list of design slides; each: {"type":"design","bg":{...},"elements":[...]}
    slides: List[dict] = Field(default_factory=list, sa_column=Column(JSON))


class PresentationCreate(BaseModel):
    title: str
    slides: List[dict] = []


class PresentationRead(BaseModel):
    id: int
    title: str
    slides: List[dict]


class Font(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    family: str                      # CSS font-family name to reference
    filename: str = ""
    src: str = ""                    # served url under /fonts
    fmt: str = "truetype"            # @font-face format()


class FontRead(BaseModel):
    id: int
    family: str
    src: str
    fmt: str


class MediaItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str                        # "image" | "pdf" | "audio"
    title: str
    filename: str = ""               # original upload name
    src: Optional[str] = None        # served url (audio file, or primary image)
    # For image/pdf: ordered image slide dicts [{type:"image", src}, ...]
    slides: Optional[List[dict]] = Field(default=None, sa_column=Column(JSON))


class Service(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: dict = Field(default_factory=dict, sa_column=Column(JSON))


class PlaylistItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    service_id: Optional[int] = Field(default=None, foreign_key="service.id", index=True)
    order_index: int = Field(default=0, index=True)
    item_type: str = "song"          # "song" | "scripture" | "media"
    song_id: Optional[int] = Field(default=None, foreign_key="song.id")
    media_id: Optional[int] = Field(default=None, foreign_key="mediaitem.id")
    media_kind: Optional[str] = None  # image | pdf | audio (when item_type == media)
    src: Optional[str] = None         # audio url (for audio media items)
    # For non-song items (scripture / image / pdf): a label and the resolved deck.
    title: Optional[str] = None
    slides: Optional[List[dict]] = Field(default=None, sa_column=Column(JSON))
    style: Optional[dict] = Field(default=None, sa_column=Column(JSON))   # per-item override


# --- API request/response schemas ------------------------------------------

class Slide(BaseModel):
    type: str = "verse"
    text: str


class SongCreate(BaseModel):
    title: str
    slides: List[Slide] = []
    style: Optional[dict] = None
    ccli: Optional[str] = None


class SongRead(BaseModel):
    id: int
    title: str
    slides: List[Slide]
    style: Optional[dict] = None
    ccli: Optional[str] = None


class UsageAdd(BaseModel):
    song_id: Optional[int] = None
    title: str
    ccli: Optional[str] = None


class PlaylistItemRead(BaseModel):
    id: int
    order_index: int
    item_type: str
    song_id: Optional[int]
    title: str
    slide_count: int
    slides: Optional[List[dict]] = None    # populated for scripture/media-image items
    media_kind: Optional[str] = None
    src: Optional[str] = None
    style: Optional[dict] = None


class ServiceRead(BaseModel):
    id: int
    name: str
    item_count: int = 0


class ServiceCreate(BaseModel):
    name: str


class ReorderRequest(BaseModel):
    order: List[int]


class ImportText(BaseModel):
    text: str = ""


class ScriptureAdd(BaseModel):
    reference: str
    translation: str
    slides: List[dict]


class PlaylistItemUpdate(BaseModel):
    title: Optional[str] = None
    slides: Optional[List[dict]] = None
    style: Optional[dict] = None
    set_style: bool = False    # when true, apply `style` (even if null) to clear/override


class MediaRead(BaseModel):
    id: int
    kind: str
    title: str
    filename: str
    src: Optional[str] = None
    slides: Optional[List[dict]] = None
    slide_count: int = 0
