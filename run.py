"""Convenience launcher: `python run.py` starts the server.

Binds to 0.0.0.0 so you can control it from a phone/tablet on the SAME Wi-Fi:
open http://<this-computer-LAN-IP>:<PORT>/ on the mobile device.

Port can be overridden with the PORT env var, e.g. `PORT=8077 python run.py`.
"""

import os
import socket

import uvicorn


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))   # no packets sent; just picks the outbound iface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    ip = _lan_ip()
    print("\n  SMI Presentation is starting…")
    print(f"  • This computer : http://127.0.0.1:{port}/")
    print(f"  • Phone/tablet  : http://{ip}:{port}/        (same Wi-Fi)")
    print(f"  • Projector     : http://{ip}:{port}/live\n")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
