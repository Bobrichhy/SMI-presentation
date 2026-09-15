"""FastAPI application: REST CRUD + Bible lookup + WebSocket live sync.

Run:  uvicorn app.main:app --reload   (or: python run.py)
      Operator -> http://127.0.0.1:8001/
      Live     -> http://127.0.0.1:8001/live   (drag to projector)

Live model: the operator pushes a fully-resolved slide deck (from a song or a
scripture passage) on `go_live`. The server owns the live position + black/clear
flags and broadcasts the current slide to every client, so a Live Output opened
late immediately shows what's on screen.
"""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

import secrets

from fastapi import (
    Depends, FastAPI, File, Header, HTTPException, Request, UploadFile,
    WebSocket, WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from . import bible, media, providers, songimport
from .database import engine, init_db
from .live_state import ConnectionManager, LiveState
from .models import (
    Font,
    FontRead,
    ImportText,
    MediaItem,
    MediaRead,
    PlaylistItem,
    PlaylistItemRead,
    PlaylistItemUpdate,
    Presentation,
    PresentationCreate,
    PresentationRead,
    ReorderRequest,
    ScriptureAdd,
    Service,
    ServiceCreate,
    ServiceRead,
    Setting,
    Song,
    SongCreate,
    SongRead,
    UsageAdd,
    UsageLog,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

live = LiveState()
manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    media.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    media.FONTS_DIR.mkdir(parents=True, exist_ok=True)
    load_settings_into_live()
    yield


# --- Persisted settings (theme + branding survive restarts) -----------------

def save_setting(key: str, value: dict) -> None:
    with Session(engine) as session:
        row = session.get(Setting, key)
        if row:
            row.value = value
        else:
            row = Setting(key=key, value=value)
        session.add(row)
        session.commit()


def load_settings_into_live() -> None:
    # Merge persisted values onto fresh defaults so newly-added keys always exist.
    with Session(engine) as session:
        t = session.get(Setting, "theme")
        if t and t.value:
            merged = LiveState().theme
            for k in ("anim", "autoFit"):
                if k in t.value:
                    merged[k] = t.value[k]
            for grp in ("song", "scripture"):
                if isinstance(t.value.get(grp), dict):
                    merged[grp].update(t.value[grp])
            live.theme = merged
        b = session.get(Setting, "branding")
        if b and b.value:
            merged_b = LiveState().branding
            merged_b.update(b.value)
            live.branding = merged_b


# --- Optional operator PIN (gate LAN control; viewing stays open) ------------

VALID_TOKENS: set[str] = set()

# Failed-attempt tracker for /api/auth, keyed by client IP: caps brute-forcing a
# short numeric PIN. Not persisted — resets on restart, same as VALID_TOKENS.
_AUTH_ATTEMPTS: dict[str, list[float]] = {}
_MAX_AUTH_ATTEMPTS = 5
_AUTH_LOCKOUT_SECONDS = 60


def _auth_rate_limited(key: str) -> bool:
    now = time.time()
    recent = [t for t in _AUTH_ATTEMPTS.get(key, []) if now - t < _AUTH_LOCKOUT_SECONDS]
    _AUTH_ATTEMPTS[key] = recent
    return len(recent) >= _MAX_AUTH_ATTEMPTS


def _auth_record_failure(key: str) -> None:
    _AUTH_ATTEMPTS.setdefault(key, []).append(time.time())


def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.sha256((salt + pin).encode()).hexdigest()


def _pin_setting() -> dict:
    with Session(engine) as session:
        row = session.get(Setting, "operator_pin")
        return (row.value if row and row.value else {}) or {}


def pin_is_set() -> bool:
    d = _pin_setting()
    return bool(d.get("hash") or d.get("pin"))  # "pin" = legacy plaintext, pre-hashing


def verify_pin(candidate: str) -> bool:
    d = _pin_setting()
    if d.get("hash"):
        return hmac.compare_digest(_hash_pin(candidate, d.get("salt", "")), d["hash"])
    legacy = d.get("pin", "")
    if legacy:
        ok = hmac.compare_digest(candidate, legacy)
        if ok:
            # Opportunistically upgrade an old plaintext PIN to a salted hash.
            salt = secrets.token_hex(8)
            save_setting("operator_pin", {"salt": salt, "hash": _hash_pin(candidate, salt)})
        return ok
    return True  # no PIN configured


def get_active_service_id(session: Session) -> int:
    row = session.get(Setting, "active_service")
    if row and row.value.get("id"):
        if session.get(Service, row.value["id"]):
            return row.value["id"]
    svc = session.exec(select(Service)).first()
    return svc.id if svc else None


app = FastAPI(title="SMI Presentation Software", lifespan=lifespan)


def get_session():
    with Session(engine) as session:
        yield session


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    # When a PIN is set, mutating requests need a valid token. GETs (viewing) stay open.
    if request.method in ("POST", "PUT", "DELETE", "PATCH") and request.url.path != "/api/auth":
        if pin_is_set() and request.headers.get("x-smi-token", "") not in VALID_TOKENS:
            return JSONResponse({"detail": "Locked — enter the operator PIN."}, status_code=401)
    return await call_next(request)


@app.get("/api/auth/status")
def auth_status(x_smi_token: str = Header(None)):
    pin_set = pin_is_set()
    return {"pinSet": pin_set, "authed": (not pin_set) or (x_smi_token in VALID_TOKENS)}


@app.post("/api/auth")
def auth_login(data: dict, request: Request):
    key = request.client.host if request.client else "unknown"
    if _auth_rate_limited(key):
        raise HTTPException(429, "Too many attempts — wait a minute and try again.")
    if pin_is_set() and not verify_pin(str(data.get("pin", ""))):
        _auth_record_failure(key)
        raise HTTPException(401, "Wrong PIN")
    token = secrets.token_hex(16)
    VALID_TOKENS.add(token)
    return {"ok": True, "token": token}


@app.post("/api/pin")
def set_pin(data: dict):
    # Guarded by auth_guard once a PIN already exists; open on first set.
    pin = str(data.get("pin", "")).strip()
    if pin:
        salt = secrets.token_hex(8)
        save_setting("operator_pin", {"salt": salt, "hash": _hash_pin(pin, salt)})
    else:
        save_setting("operator_pin", {"salt": "", "hash": ""})
    return {"ok": True}


async def broadcast_state() -> None:
    await manager.broadcast(live.payload())


def _slide_count(item: PlaylistItem, session: Session) -> int:
    if item.item_type in ("scripture", "media", "presentation"):
        return len(item.slides or [])
    if item.song_id is not None:
        song = session.get(Song, item.song_id)
        return len(song.slides) if song else 0
    return 0


def _item_read(item: PlaylistItem, session: Session) -> PlaylistItemRead:
    if item.item_type in ("scripture", "media", "presentation"):
        title = item.title or "(item)"
        slides = item.slides
    else:
        song = session.get(Song, item.song_id) if item.song_id else None
        title = song.title if song else "(unknown)"
        slides = None
    return PlaylistItemRead(
        id=item.id, order_index=item.order_index, item_type=item.item_type,
        song_id=item.song_id, title=title, slide_count=_slide_count(item, session),
        slides=slides, media_kind=item.media_kind, src=item.src, style=item.style,
    )


# --- Song REST --------------------------------------------------------------

@app.get("/api/songs", response_model=list[SongRead])
def list_songs(session: Session = Depends(get_session)):
    return session.exec(select(Song).order_by(Song.title)).all()


@app.post("/api/songs", response_model=SongRead)
def create_song(data: SongCreate, session: Session = Depends(get_session)):
    song = Song(title=data.title, slides=[s.model_dump() for s in data.slides], style=data.style, ccli=data.ccli)
    session.add(song)
    session.commit()
    session.refresh(song)
    return song


@app.get("/api/songs/{song_id}", response_model=SongRead)
def get_song(song_id: int, session: Session = Depends(get_session)):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    return song


@app.put("/api/songs/{song_id}", response_model=SongRead)
def update_song(song_id: int, data: SongCreate, session: Session = Depends(get_session)):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    song.title = data.title
    song.slides = [s.model_dump() for s in data.slides]
    song.style = data.style
    song.ccli = data.ccli
    session.add(song)
    session.commit()
    session.refresh(song)
    return song


# --- CCLI usage logging -----------------------------------------------------

@app.post("/api/usage")
def add_usage(data: UsageAdd, session: Session = Depends(get_session)):
    now = datetime.now()
    cutoff = (now - timedelta(minutes=10)).isoformat()
    # De-dupe: don't log the same song again within 10 minutes (slide re-clicks etc.).
    q = select(UsageLog).where(UsageLog.at >= cutoff)
    q = q.where(UsageLog.song_id == data.song_id) if data.song_id is not None else q.where(UsageLog.title == data.title)
    if session.exec(q).first():
        return {"ok": True, "deduped": True}
    svc = session.get(Service, get_active_service_id(session))
    session.add(UsageLog(song_id=data.song_id, title=data.title, ccli=data.ccli,
                         service=svc.name if svc else None, at=now.isoformat(timespec="seconds")))
    session.commit()
    return {"ok": True}


@app.get("/api/usage")
def list_usage(session: Session = Depends(get_session)):
    rows = session.exec(select(UsageLog).order_by(UsageLog.id.desc())).all()
    return [{"id": r.id, "title": r.title, "ccli": r.ccli, "service": r.service, "at": r.at} for r in rows]


@app.get("/api/usage/report")
def usage_report(session: Session = Depends(get_session)):
    agg: dict = {}
    for r in session.exec(select(UsageLog)).all():
        key = (r.title, r.ccli or "")
        agg.setdefault(key, {"title": r.title, "ccli": r.ccli or "", "count": 0, "last": ""})
        agg[key]["count"] += 1
        if (r.at or "") > agg[key]["last"]:
            agg[key]["last"] = r.at or ""
    return sorted(agg.values(), key=lambda x: -x["count"])


@app.get("/api/usage/export.csv")
def usage_csv(session: Session = Depends(get_session)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Time", "Song Title", "CCLI #", "Service"])
    for r in session.exec(select(UsageLog).order_by(UsageLog.at)).all():
        d, _, t = (r.at or "").partition("T")
        w.writerow([d, t, r.title, r.ccli or "", r.service or ""])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=ccli-usage.csv"})


@app.delete("/api/usage")
def clear_usage(session: Session = Depends(get_session)):
    for r in session.exec(select(UsageLog)).all():
        session.delete(r)
    session.commit()
    return {"ok": True}


@app.post("/api/songs/import/text")
def import_song_text(data: ImportText):
    return songimport.parse_text(data.text)


@app.post("/api/songs/import/file")
def import_song_file(file: UploadFile = File(...)):
    return songimport.import_file(file.filename or "song.txt", file.file.read())


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: int, session: Session = Depends(get_session)):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    for it in session.exec(select(PlaylistItem).where(PlaylistItem.song_id == song_id)).all():
        session.delete(it)
    session.delete(song)
    session.commit()
    return {"ok": True}


# --- Presentation REST ------------------------------------------------------

@app.get("/api/presentations", response_model=list[PresentationRead])
def list_presentations(session: Session = Depends(get_session)):
    return session.exec(select(Presentation).order_by(Presentation.title)).all()


@app.post("/api/presentations", response_model=PresentationRead)
def create_presentation(data: PresentationCreate, session: Session = Depends(get_session)):
    p = Presentation(title=data.title, slides=data.slides)
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@app.get("/api/presentations/{pid}", response_model=PresentationRead)
def get_presentation(pid: int, session: Session = Depends(get_session)):
    p = session.get(Presentation, pid)
    if not p:
        raise HTTPException(404, "Presentation not found")
    return p


@app.put("/api/presentations/{pid}", response_model=PresentationRead)
def update_presentation(pid: int, data: PresentationCreate, session: Session = Depends(get_session)):
    p = session.get(Presentation, pid)
    if not p:
        raise HTTPException(404, "Presentation not found")
    p.title = data.title
    p.slides = data.slides
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@app.delete("/api/presentations/{pid}")
def delete_presentation(pid: int, session: Session = Depends(get_session)):
    p = session.get(Presentation, pid)
    if not p:
        raise HTTPException(404, "Presentation not found")
    session.delete(p)
    session.commit()
    return {"ok": True}


# --- Bible REST -------------------------------------------------------------

@app.get("/api/bible/translations")
def bible_translations():
    offline = bible.translations() if bible.available() else []
    return {"offline": offline, "online": providers.online_translations()}


@app.get("/api/bible/books")
def bible_books(translation: str):
    if not bible.available():
        raise HTTPException(503, "Bible data not installed")
    return bible.books(translation)


@app.get("/api/bible/lookup")
def bible_lookup(ref: str, translation: str):
    if providers.is_online(translation):
        result = providers.lookup(ref, translation)
        if result is None:
            raise HTTPException(400, "Translation not available")
        return result
    if not bible.available():
        raise HTTPException(503, "Bible data not installed")
    return bible.lookup(ref, translation)


@app.get("/api/bible/chapter")
def bible_chapter(translation: str, book: str, chapter: int):
    if not bible.available():
        raise HTTPException(503, "Bible data not installed")
    return bible.chapter(translation, book, chapter)


@app.get("/api/bible/search")
def bible_search(q: str, translation: str):
    if not bible.available():
        raise HTTPException(503, "Bible data not installed")
    return bible.search(q, translation)


# --- Media REST -------------------------------------------------------------

def _media_read(m: MediaItem) -> MediaRead:
    return MediaRead(
        id=m.id, kind=m.kind, title=m.title, filename=m.filename,
        src=m.src, slides=m.slides, slide_count=len(m.slides or []),
    )


@app.get("/api/media", response_model=list[MediaRead])
def list_media(session: Session = Depends(get_session)):
    items = session.exec(select(MediaItem).order_by(MediaItem.id.desc())).all()
    return [_media_read(m) for m in items]


@app.post("/api/media", response_model=MediaRead)
def upload_media(file: UploadFile = File(...), session: Session = Depends(get_session)):
    # Sync endpoint -> FastAPI runs it in a worker thread, so the heavy work
    # (PDF render / ffmpeg transcode) never blocks the event loop or WebSockets.
    import uuid as _uuid

    media.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = media.MEDIA_DIR / f".upload-{_uuid.uuid4().hex}.tmp"
    try:
        media.stream_to_file(file.file, tmp, media.MAX_UPLOAD_BYTES)
        info = media.save_upload(file.filename or "upload", tmp)
    except media.UploadTooLarge as e:
        raise HTTPException(413, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp.unlink(missing_ok=True)

    m = MediaItem(
        kind=info["kind"], title=info["title"], filename=info["filename"],
        src=info["src"], slides=info["slides"],
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return _media_read(m)


@app.get("/api/fonts", response_model=list[FontRead])
def list_fonts(session: Session = Depends(get_session)):
    fonts = session.exec(select(Font).order_by(Font.family)).all()
    return [FontRead(id=f.id, family=f.family, src=f.src, fmt=f.fmt) for f in fonts]


@app.post("/api/fonts", response_model=FontRead)
def upload_font(file: UploadFile = File(...), session: Session = Depends(get_session)):
    import uuid as _uuid
    media.FONTS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = media.FONTS_DIR / f".upload-{_uuid.uuid4().hex}.tmp"
    try:
        media.stream_to_file(file.file, tmp, media.MAX_FONT_BYTES)
        info = media.save_font(file.filename or "font", tmp)
    except media.UploadTooLarge as e:
        raise HTTPException(413, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp.unlink(missing_ok=True)
    f = Font(family=info["family"], filename=info["filename"], src=info["src"], fmt=info["fmt"])
    session.add(f)
    session.commit()
    session.refresh(f)
    return FontRead(id=f.id, family=f.family, src=f.src, fmt=f.fmt)


@app.delete("/api/fonts/{font_id}")
def delete_font(font_id: int, session: Session = Depends(get_session)):
    f = session.get(Font, font_id)
    if not f:
        raise HTTPException(404, "Font not found")
    media.delete_font_files(f.src)
    session.delete(f)
    session.commit()
    return {"ok": True}


@app.get("/api/fonts.css")
def fonts_css(session: Session = Depends(get_session)):
    from fastapi.responses import Response
    lines = []
    for f in session.exec(select(Font)).all():
        lines.append(
            f"@font-face {{ font-family: '{f.family}'; "
            f"src: url('{f.src}') format('{f.fmt}'); font-display: swap; }}"
        )
    return Response("\n".join(lines), media_type="text/css")


@app.delete("/api/media/{media_id}")
def delete_media(media_id: int, session: Session = Depends(get_session)):
    m = session.get(MediaItem, media_id)
    if not m:
        raise HTTPException(404, "Media not found")
    for it in session.exec(select(PlaylistItem).where(PlaylistItem.media_id == media_id)).all():
        session.delete(it)
    media.delete_files(m.src, m.slides)
    session.delete(m)
    session.commit()
    return {"ok": True}


# --- Playlist REST ----------------------------------------------------------

@app.get("/api/playlist", response_model=list[PlaylistItemRead])
def get_playlist(session: Session = Depends(get_session)):
    sid = get_active_service_id(session)
    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.service_id == sid).order_by(PlaylistItem.order_index)
    ).all()
    return [_item_read(it, session) for it in items]


def _next_order(session: Session) -> int:
    sid = get_active_service_id(session)
    last = session.exec(
        select(PlaylistItem.order_index)
        .where(PlaylistItem.service_id == sid)
        .order_by(PlaylistItem.order_index.desc())
    ).first()
    return (last + 1) if last is not None else 0


@app.post("/api/playlist/reorder")
def reorder_playlist(data: ReorderRequest, session: Session = Depends(get_session)):
    sid = get_active_service_id(session)
    for i, item_id in enumerate(data.order):
        it = session.get(PlaylistItem, item_id)
        if it and it.service_id == sid:
            it.order_index = i
            session.add(it)
    session.commit()
    return {"ok": True}


@app.post("/api/playlist/items", response_model=PlaylistItemRead)
def add_song_to_playlist(song_id: int, session: Session = Depends(get_session)):
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    item = PlaylistItem(order_index=_next_order(session), service_id=get_active_service_id(session),
                        item_type="song", song_id=song_id)
    session.add(item)
    session.commit()
    session.refresh(item)
    return _item_read(item, session)


@app.post("/api/playlist/presentation", response_model=PlaylistItemRead)
def add_presentation_to_playlist(presentation_id: int, session: Session = Depends(get_session)):
    p = session.get(Presentation, presentation_id)
    if not p:
        raise HTTPException(404, "Presentation not found")
    item = PlaylistItem(
        order_index=_next_order(session), service_id=get_active_service_id(session),
        item_type="presentation", title=p.title, slides=p.slides,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return _item_read(item, session)


@app.post("/api/playlist/scripture", response_model=PlaylistItemRead)
def add_scripture_to_playlist(data: ScriptureAdd, session: Session = Depends(get_session)):
    title = f"{data.reference} ({data.translation})"
    item = PlaylistItem(
        order_index=_next_order(session), service_id=get_active_service_id(session),
        item_type="scripture", title=title, slides=data.slides,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return _item_read(item, session)


@app.post("/api/playlist/media", response_model=PlaylistItemRead)
def add_media_to_playlist(media_id: int, session: Session = Depends(get_session)):
    m = session.get(MediaItem, media_id)
    if not m:
        raise HTTPException(404, "Media not found")
    item = PlaylistItem(
        order_index=_next_order(session), service_id=get_active_service_id(session),
        item_type="media", media_id=m.id,
        media_kind=m.kind, title=m.title, slides=m.slides, src=m.src,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return _item_read(item, session)


@app.put("/api/playlist/items/{item_id}", response_model=PlaylistItemRead)
async def update_playlist_item(
    item_id: int, data: PlaylistItemUpdate, session: Session = Depends(get_session)
):
    item = session.get(PlaylistItem, item_id)
    if not item:
        raise HTTPException(404, "Playlist item not found")
    if item.item_type == "song":
        raise HTTPException(400, "Edit songs from the Song Library")
    if data.title is not None:
        item.title = data.title
    if data.slides is not None:
        item.slides = data.slides
    if data.set_style:
        item.style = data.style
    session.add(item)
    session.commit()
    session.refresh(item)
    # If this item is live, re-push the edited deck + style.
    if live.source_id == item_id and item.slides is not None:
        live.slides = item.slides
        live.title = item.title
        if data.set_style:
            live.style_override = item.style
        await broadcast_state()
    return _item_read(item, session)


@app.delete("/api/playlist/items/{item_id}")
async def remove_playlist_item(item_id: int, session: Session = Depends(get_session)):
    item = session.get(PlaylistItem, item_id)
    if not item:
        raise HTTPException(404, "Playlist item not found")
    session.delete(item)
    session.commit()
    if live.source_id == item_id:
        live.slides = []
        live.title = None
        live.source_id = None
        live.slide_index = 0
        await broadcast_state()
    return {"ok": True}


# --- Services (saved orders of service) -------------------------------------

def _service_read(svc: Service, session: Session) -> ServiceRead:
    n = len(session.exec(select(PlaylistItem).where(PlaylistItem.service_id == svc.id)).all())
    return ServiceRead(id=svc.id, name=svc.name, item_count=n)


@app.get("/api/services", response_model=list[ServiceRead])
def list_services(session: Session = Depends(get_session)):
    return [_service_read(s, session) for s in session.exec(select(Service).order_by(Service.id)).all()]


@app.get("/api/active-service", response_model=ServiceRead)
def active_service(session: Session = Depends(get_session)):
    sid = get_active_service_id(session)
    svc = session.get(Service, sid)
    if not svc:
        raise HTTPException(404, "No service")
    return _service_read(svc, session)


@app.post("/api/active-service", response_model=ServiceRead)
def set_active_service(service_id: int, session: Session = Depends(get_session)):
    svc = session.get(Service, service_id)
    if not svc:
        raise HTTPException(404, "Service not found")
    save_setting("active_service", {"id": service_id})
    return _service_read(svc, session)


@app.post("/api/services", response_model=ServiceRead)
def create_service(data: ServiceCreate, session: Session = Depends(get_session)):
    svc = Service(name=data.name or "New service")
    session.add(svc)
    session.commit()
    session.refresh(svc)
    return _service_read(svc, session)


@app.put("/api/services/{service_id}", response_model=ServiceRead)
def rename_service(service_id: int, data: ServiceCreate, session: Session = Depends(get_session)):
    svc = session.get(Service, service_id)
    if not svc:
        raise HTTPException(404, "Service not found")
    svc.name = data.name
    session.add(svc)
    session.commit()
    return _service_read(svc, session)


@app.post("/api/services/{service_id}/duplicate", response_model=ServiceRead)
def duplicate_service(service_id: int, session: Session = Depends(get_session)):
    src = session.get(Service, service_id)
    if not src:
        raise HTTPException(404, "Service not found")
    dup = Service(name=f"{src.name} (copy)")
    session.add(dup)
    session.commit()
    session.refresh(dup)
    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.service_id == service_id).order_by(PlaylistItem.order_index)
    ).all()
    for it in items:
        session.add(PlaylistItem(
            service_id=dup.id, order_index=it.order_index, item_type=it.item_type,
            song_id=it.song_id, media_id=it.media_id, media_kind=it.media_kind,
            src=it.src, title=it.title, slides=it.slides, style=it.style,
        ))
    session.commit()
    return _service_read(dup, session)


@app.delete("/api/services/{service_id}")
def delete_service(service_id: int, session: Session = Depends(get_session)):
    svc = session.get(Service, service_id)
    if not svc:
        raise HTTPException(404, "Service not found")
    if len(session.exec(select(Service)).all()) <= 1:
        raise HTTPException(400, "Can't delete the only service")
    for it in session.exec(select(PlaylistItem).where(PlaylistItem.service_id == service_id)).all():
        session.delete(it)
    session.delete(svc)
    session.commit()
    # If it was active, switch to another service.
    if get_active_service_id(session) == service_id or not session.get(Service, get_active_service_id(session)):
        other = session.exec(select(Service)).first()
        if other:
            save_setting("active_service", {"id": other.id})
    return {"ok": True}


# --- Static pages -----------------------------------------------------------

@app.get("/")
def operator_page():
    return FileResponse(STATIC_DIR / "operator.html")


@app.get("/live")
def live_page():
    return FileResponse(STATIC_DIR / "live.html")


@app.get("/stage")
def stage_page():
    return FileResponse(STATIC_DIR / "stage.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
media.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
media.FONTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=media.MEDIA_DIR), name="media")
app.mount("/fonts", StaticFiles(directory=media.FONTS_DIR), name="fonts")


# --- WebSocket live sync ----------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    # Viewers (Live Output / Stage) connect without a token and just receive state;
    # control messages are only honoured for an authed operator (or when no PIN is set).
    token = ws.query_params.get("token", "")
    authed = (not pin_is_set()) or (token in VALID_TOKENS)
    try:
        await manager.send(ws, live.payload())   # sync late joiners immediately
        while True:
            msg = await ws.receive_json()
            if not authed:
                continue                          # ignore commands from unauthenticated clients
            action = msg.get("action")

            if action == "go_live":
                live.slides = msg.get("slides", [])
                live.title = msg.get("title")
                live.source_id = msg.get("source_id")
                live.slide_index = int(msg.get("slide_index", 0))
                live.style_override = msg.get("style")    # per-item appearance, or None
                live.black = False
                live.clear = False
            elif action == "next":
                live.slide_index += 1
            elif action == "prev":
                live.slide_index = max(0, live.slide_index - 1)
            elif action == "goto":
                live.slide_index = int(msg.get("slide_index", 0))
            elif action == "black":
                live.black = bool(msg.get("on", not live.black))
            elif action == "clear":
                live.clear = bool(msg.get("on", not live.clear))
            elif action == "show":
                live.black = False
                live.clear = False
            elif action == "audio":
                cmd = msg.get("cmd")
                if cmd == "play":
                    live.audio_src = msg.get("src")
                    live.audio_title = msg.get("title")
                    live.audio_loop = bool(msg.get("loop", False))
                    live.audio_playing = True
                elif cmd == "pause":
                    live.audio_playing = False
                elif cmd == "resume":
                    if live.audio_src:
                        live.audio_playing = True
                elif cmd == "stop":
                    live.audio_src = None
                    live.audio_title = None
                    live.audio_playing = False
                elif cmd == "loop":
                    live.audio_loop = bool(msg.get("on", not live.audio_loop))
                else:
                    continue
            elif action == "theme":
                target = msg.get("target")        # "song" | "scripture"
                if target in ("song", "scripture"):
                    patch = msg.get("patch", {})
                    for k in ("font", "color", "bg", "bgImage", "bgVideo", "size"):
                        if k in patch:
                            live.theme[target][k] = patch[k]
                if "anim" in msg:
                    live.theme["anim"] = msg["anim"]
                if "autoFit" in msg:
                    live.theme["autoFit"] = bool(msg["autoFit"])
                save_setting("theme", live.theme)
            elif action == "branding":
                patch = msg.get("branding", {})
                for k in ("text", "logo"):
                    if k in patch:
                        live.branding[k] = patch[k]
                save_setting("branding", live.branding)
            elif action == "overlay":
                patch = msg.get("overlay", {})
                for k in ("visible", "title", "subtitle", "position"):
                    if k in patch:
                        live.overlay[k] = patch[k]
            elif action == "stage":
                live.stage_message = str(msg.get("message", ""))
            elif action == "refresh_fonts":
                await manager.broadcast({"type": "fonts"})
                continue
            elif action == "timer":
                cmd = msg.get("cmd")
                if cmd == "clock":
                    live.timer = {"mode": "clock", "endsAt": None, "label": msg.get("label", "")}
                elif cmd == "countdown":
                    import time as _t
                    secs = int(msg.get("seconds", 0))
                    live.timer = {"mode": "countdown",
                                  "endsAt": int(_t.time() * 1000) + secs * 1000,
                                  "label": msg.get("label", "")}
                elif cmd == "adjust":   # add/subtract minutes on the fly
                    if live.timer.get("endsAt"):
                        live.timer["endsAt"] += int(msg.get("seconds", 0)) * 1000
                elif cmd == "off":
                    live.timer = {"mode": "off", "endsAt": None, "label": ""}
                else:
                    continue
            else:
                continue

            await broadcast_state()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:
        await manager.disconnect(ws)
