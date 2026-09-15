"""Resolves where user-writable data (SQLite DB, uploaded media/fonts) lives.

Plain `python run.py` (dev / browser-tab use): everything sits next to the
source tree, exactly as before — unchanged behaviour.

A packaged desktop build (PyInstaller sets `sys.frozen`) can't rely on that:
its own folder can be read-only (Program Files, /Applications), and a onefile
build's extraction folder is a fresh temp directory deleted when the app
exits. So when frozen, writable data instead lives in the OS's normal
per-user app-data directory, so songs/services/uploads survive restarts.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def user_data_dir() -> Path:
    if not getattr(sys, "frozen", False):
        return PROJECT_ROOT
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    d = base / "SMI Presentation"
    d.mkdir(parents=True, exist_ok=True)
    return d
