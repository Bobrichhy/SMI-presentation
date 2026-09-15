"""SQLite engine setup and one-time seeding."""

from __future__ import annotations

import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from . import paths
from .models import PlaylistItem, Service, Setting, Song

# Overridable so the test suite (and packaging) can point at a different file.
DB_PATH = Path(os.environ.get("SMI_DB_PATH", str(paths.user_data_dir() / "data.db")))
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


def get_session() -> Session:
    return Session(engine)


def _ensure_columns() -> None:
    """Lightweight migration: add new nullable columns to existing tables so we
    never have to wipe user data when the model gains a field."""
    wanted = {
        "song": {"style": "JSON", "ccli": "VARCHAR"},
        "playlistitem": {"style": "JSON", "media_id": "INTEGER",
                         "media_kind": "VARCHAR", "src": "VARCHAR",
                         "title": "VARCHAR", "slides": "JSON", "service_id": "INTEGER"},
    }
    with engine.begin() as conn:
        for table, cols in wanted.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not existing:
                continue
            for name, decl in cols.items():
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def ensure_services() -> None:
    """Guarantee at least one Service exists, every playlist item belongs to one,
    and there's an active-service setting (so restart resumes the same service)."""
    with Session(engine) as session:
        svc = session.exec(select(Service)).first()
        if not svc:
            svc = Service(name="Sunday Service")
            session.add(svc)
            session.commit()
            session.refresh(svc)
        orphans = session.exec(select(PlaylistItem).where(PlaylistItem.service_id == None)).all()  # noqa: E711
        for it in orphans:
            it.service_id = svc.id
            session.add(it)
        if orphans:
            session.commit()
        if not session.get(Setting, "active_service"):
            session.add(Setting(key="active_service", value={"id": svc.id}))
            session.commit()


def init_db() -> None:
    """Create tables and seed a sample song on first run."""
    SQLModel.metadata.create_all(engine)
    _ensure_columns()
    with Session(engine) as session:
        has_songs = session.exec(select(Song)).first()
        if has_songs:
            ensure_services()   # existing DB: just make sure services/active exist
            return

        sample = Song(
            title="Amazing Grace",
            slides=[
                {"type": "verse", "text": "Amazing grace! how sweet the sound,\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see."},
                {"type": "verse", "text": "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed!"},
                {"type": "verse", "text": "Through many dangers, toils and snares,\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home."},
            ],
        )
        session.add(sample)
        session.commit()
        session.refresh(sample)

        session.add(PlaylistItem(order_index=0, item_type="song", song_id=sample.id))
        session.commit()

    # Run last so the freshly-seeded playlist item gets assigned to the default service.
    ensure_services()
