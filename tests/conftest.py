"""Pytest fixtures. Points the app at a throwaway SQLite DB so tests never touch
the real data.db. The bundled read-only data/bible.db is reused as-is."""

import os
import tempfile

# Must be set BEFORE importing the app (the engine is created at import time).
os.environ["SMI_DB_PATH"] = os.path.join(tempfile.mkdtemp(prefix="smi-test-"), "test.db")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    # The context manager runs the lifespan (init_db: tables + seed + services).
    with TestClient(app) as c:
        yield c


@pytest.fixture
def clean_pin(client):
    """Guarantees the operator PIN is cleared after the test, even if an assertion
    fails partway through. The `client` fixture is session-scoped (shared across
    every test), so a PIN left set here would 401 every test that runs after it —
    clearing via the DB row directly (rather than the gated /api/pin endpoint)
    works even when the test never got as far as obtaining a valid token."""
    yield
    from sqlmodel import Session

    from app.database import engine
    from app.main import VALID_TOKENS
    from app.models import Setting

    with Session(engine) as session:
        row = session.get(Setting, "operator_pin")
        if row:
            session.delete(row)
            session.commit()
    VALID_TOKENS.clear()
