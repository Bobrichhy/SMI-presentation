"""Desktop entry point: runs the server in a background thread and opens the
operator panel in a native window (pywebview) instead of a plain browser tab.
This is what the packaged Linux/Windows/macOS builds run (see
.github/workflows/build.yml) — `python run.py` still serves the app for
regular browser-tab / LAN-controlled use, unchanged.

Live Output (/live) and Stage (/stage) keep opening via their existing links
in the system's default browser, exactly like the browser-tab workflow — handy
for dragging either onto a second display or a projector.
"""

from __future__ import annotations

import os
import threading
import time
import urllib.request

import uvicorn
import webview

from app.main import app as fastapi_app
from run import _lan_ip


def _run_server(port: int) -> None:
    uvicorn.run(fastapi_app, host="0.0.0.0", port=port, log_level="warning")


def _wait_for_server(port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main() -> None:
    port = int(os.environ.get("PORT", "8001"))
    threading.Thread(target=_run_server, args=(port,), daemon=True).start()
    _wait_for_server(port)

    ip = _lan_ip()
    print("\n  SMI Presentation is starting…")
    print(f"  • This computer : http://127.0.0.1:{port}/")
    print(f"  • Phone/tablet  : http://{ip}:{port}/        (same Wi-Fi)")
    print(f"  • Projector     : http://{ip}:{port}/live\n")

    webview.create_window(
        "SMI Presentation", f"http://127.0.0.1:{port}/",
        width=1440, height=900, min_size=(1024, 700),
    )
    webview.start()


if __name__ == "__main__":
    main()
