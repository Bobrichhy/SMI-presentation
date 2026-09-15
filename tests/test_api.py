"""API + WebSocket regression tests, against an isolated temp database."""

import pytest

from app import main, media


def _a_translation(client):
    tr = client.get("/api/bible/translations").json()
    if not tr["offline"]:
        pytest.skip("no bundled Bible data")
    return tr["offline"][0]["code"]


def test_pages_serve(client):
    for p in ("/", "/live", "/stage"):
        assert client.get(p).status_code == 200


def test_seed_song_service_and_playlist(client):
    assert any(s["title"] == "Amazing Grace" for s in client.get("/api/songs").json())
    assert len(client.get("/api/services").json()) >= 1
    assert any(i["title"] == "Amazing Grace" for i in client.get("/api/playlist").json())


def test_song_crud_with_ccli(client):
    r = client.post("/api/songs", json={"title": "Test", "slides": [{"type": "verse", "text": "hi"}], "ccli": "999"})
    assert r.status_code == 200
    sid, body = r.json()["id"], r.json()
    assert body["ccli"] == "999"
    assert client.get(f"/api/songs/{sid}").json()["title"] == "Test"
    client.put(f"/api/songs/{sid}", json={"title": "Test2", "slides": [{"type": "chorus", "text": "yo"}]})
    assert client.get(f"/api/songs/{sid}").json()["title"] == "Test2"
    assert client.delete(f"/api/songs/{sid}").json()["ok"]
    assert client.get(f"/api/songs/{sid}").status_code == 404


def test_import_text_endpoint(client):
    d = client.post("/api/songs/import/text", json={"text": "X\n\nVerse 1\nhello\n\nChorus\nworld"}).json()
    assert d["title"] == "X" and len(d["slides"]) == 2
    assert d["slides"][1]["type"] == "chorus"


def test_bible_lookup_search_chapter(client):
    v = _a_translation(client)
    d = client.get("/api/bible/lookup", params={"ref": "John 3:16", "translation": v}).json()
    assert d["ok"] and d["reference"].startswith("John 3:16") and d["slides"]
    s = client.get("/api/bible/search", params={"q": "shepherd", "translation": v}).json()
    assert s["ok"] and s["count"] > 0
    ch = client.get("/api/bible/chapter", params={"translation": v, "book": "John", "chapter": 3}).json()
    assert ch["ok"] and len(ch["verses"]) > 10


def test_scripture_added_to_playlist(client):
    v = _a_translation(client)
    d = client.get("/api/bible/lookup", params={"ref": "Psalm 23:1", "translation": v}).json()
    it = client.post("/api/playlist/scripture", json={"reference": d["reference"], "translation": v, "slides": d["slides"]}).json()
    assert it["item_type"] == "scripture" and it["slide_count"] >= 1
    assert client.delete(f"/api/playlist/items/{it['id']}").json()["ok"]


def test_services_scoping_reorder_duplicate(client):
    s = client.post("/api/services", json={"name": "Test Svc"}).json()
    sid = s["id"]
    client.post("/api/active-service", params={"service_id": sid})
    assert client.get("/api/active-service").json()["id"] == sid
    assert client.get("/api/playlist").json() == []          # new service is isolated/empty
    song = client.get("/api/songs").json()[0]
    client.post("/api/playlist/items", params={"song_id": song["id"]})
    pl = client.get("/api/playlist").json()
    assert len(pl) == 1
    assert client.post("/api/playlist/reorder", json={"order": [pl[0]["id"]]}).json()["ok"]
    dup = client.post(f"/api/services/{sid}/duplicate").json()
    assert dup["item_count"] == 1
    client.delete(f"/api/services/{sid}")
    client.delete(f"/api/services/{dup['id']}")
    # back to the seeded service, still intact
    assert any(i["title"] == "Amazing Grace" for i in client.get("/api/playlist").json())


def test_cannot_delete_only_service(client):
    svcs = client.get("/api/services").json()
    if len(svcs) == 1:
        assert client.delete(f"/api/services/{svcs[0]['id']}").status_code == 400


def test_usage_logging_dedupe_report_csv(client):
    client.delete("/api/usage")
    client.post("/api/usage", json={"song_id": 1, "title": "Amazing Grace", "ccli": "22025"})
    assert client.post("/api/usage", json={"song_id": 1, "title": "Amazing Grace", "ccli": "22025"}).json().get("deduped")
    rep = client.get("/api/usage/report").json()
    assert any(x["title"] == "Amazing Grace" and x["count"] == 1 for x in rep)
    csv = client.get("/api/usage/export.csv")
    assert "Song Title" in csv.text and "Amazing Grace" in csv.text
    client.delete("/api/usage")


def test_media_upload_rejects_over_size_cap(client, monkeypatch):
    monkeypatch.setattr(media, "MAX_UPLOAD_BYTES", 10)  # tiny cap for the test
    r = client.post("/api/media", files={"file": ("big.png", b"x" * 100, "image/png")})
    assert r.status_code == 413
    assert not list(media.MEDIA_DIR.glob(".upload-*.tmp")), "oversized temp upload was not cleaned up"


def test_media_upload_within_cap_still_works(client, monkeypatch):
    monkeypatch.setattr(media, "MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
    # save_upload() only inspects the extension for "image" kind, not the bytes.
    r = client.post("/api/media", files={"file": ("tiny.png", b"not really a png but fine", "image/png")})
    assert r.status_code == 200
    m = r.json()
    assert m["kind"] == "image"
    client.delete(f"/api/media/{m['id']}")


def test_font_upload_rejects_over_size_cap(client, monkeypatch):
    monkeypatch.setattr(media, "MAX_FONT_BYTES", 10)
    r = client.post("/api/fonts", files={"file": ("big.ttf", b"x" * 100, "font/ttf")})
    assert r.status_code == 413
    assert not list(media.FONTS_DIR.glob(".upload-*.tmp")), "oversized temp font upload was not cleaned up"


def test_presentation_crud_and_playlist(client):
    p = client.post("/api/presentations", json={"title": "Notice", "slides": [{"type": "design", "bg": {"color": "#000"}, "elements": []}]}).json()
    assert p["title"] == "Notice"
    it = client.post("/api/playlist/presentation", params={"presentation_id": p["id"]}).json()
    assert it["item_type"] == "presentation"
    client.delete(f"/api/playlist/items/{it['id']}")
    client.delete(f"/api/presentations/{p['id']}")


def test_ws_go_live_next_and_nextslide(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "state"
        song = client.get(f"/api/songs/{client.get('/api/songs').json()[0]['id']}").json()
        ws.send_json({"action": "go_live", "title": song["title"], "slides": song["slides"], "source_id": None, "slide_index": 0})
        st = ws.receive_json()
        assert st["hasContent"] and st["slideText"]
        if len(song["slides"]) > 1:
            assert st["nextSlide"] is not None
            ws.send_json({"action": "next"})
            assert ws.receive_json()["slideIndex"] == 1


def test_ws_theme_overlay_and_stage(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"action": "theme", "target": "song", "patch": {"color": "#abcdef"}})
        assert ws.receive_json()["theme"]["song"]["color"] == "#abcdef"
        ws.send_json({"action": "overlay", "overlay": {"visible": True, "title": "Guest"}})
        st = ws.receive_json()
        assert st["overlay"]["visible"] and st["overlay"]["title"] == "Guest"
        ws.send_json({"action": "stage", "message": "Wrap up"})
        assert ws.receive_json()["stageMessage"] == "Wrap up"


def test_pin_gate_then_open_again(client, clean_pin):
    # Open by default.
    assert client.get("/api/auth/status").json() == {"pinSet": False, "authed": True}
    # Set a PIN (allowed while open).
    assert client.post("/api/pin", json={"pin": "1234"}).json()["ok"]
    assert client.get("/api/auth/status").json()["pinSet"] is True
    # A mutation without a token is now blocked.
    assert client.post("/api/songs", json={"title": "X", "slides": [{"type": "verse", "text": "y"}]}).status_code == 401
    # Wrong PIN rejected; correct PIN yields a token.
    assert client.post("/api/auth", json={"pin": "0000"}).status_code == 401
    token = client.post("/api/auth", json={"pin": "1234"}).json()["token"]
    h = {"X-SMI-Token": token}
    assert client.get("/api/auth/status", headers=h).json()["authed"] is True
    r = client.post("/api/songs", json={"title": "X", "slides": [{"type": "verse", "text": "y"}]}, headers=h)
    assert r.status_code == 200
    client.delete(f"/api/songs/{r.json()['id']}", headers=h)
    # Remove the PIN (needs token) → open again.
    assert client.post("/api/pin", json={"pin": ""}, headers=h).json()["ok"]
    assert client.get("/api/auth/status").json() == {"pinSet": False, "authed": True}


def test_pin_is_stored_hashed_not_plaintext(client, clean_pin):
    assert client.post("/api/pin", json={"pin": "4321"}).json()["ok"]
    stored = main._pin_setting()
    assert stored.get("hash"), "PIN should be stored as a hash"
    assert "4321" not in str(stored), "the raw PIN must never be persisted"
    # ...but it still verifies correctly.
    assert main.verify_pin("4321") is True
    assert main.verify_pin("0000") is False


def test_legacy_plaintext_pin_still_verifies_and_gets_upgraded(client, clean_pin):
    # Simulate a PIN set by a pre-hashing version of the app.
    main.save_setting("operator_pin", {"pin": "9999"})
    assert main.pin_is_set() is True
    assert main.verify_pin("0000") is False
    assert main.verify_pin("9999") is True   # correct legacy PIN still works...
    upgraded = main._pin_setting()
    assert upgraded.get("hash") and "9999" not in str(upgraded)   # ...and is now hashed
    assert main.verify_pin("9999") is True   # still verifies after the upgrade


def test_auth_rate_limited_after_repeated_failures(client, clean_pin, monkeypatch):
    monkeypatch.setattr(main, "_AUTH_ATTEMPTS", {})   # isolate from other tests' attempts
    assert client.post("/api/pin", json={"pin": "1111"}).json()["ok"]
    for _ in range(main._MAX_AUTH_ATTEMPTS):
        assert client.post("/api/auth", json={"pin": "0000"}).status_code == 401
    # The cap is now hit — even the CORRECT pin is rejected until the window passes.
    r = client.post("/api/auth", json={"pin": "1111"})
    assert r.status_code == 429


def test_ws_dual_language_and_design_payload(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"action": "go_live", "title": "D", "source_id": None,
                      "slides": [{"type": "verse", "text": "Hello", "text2": "Hola"}]})
        st = ws.receive_json()
        assert st["slideText"] == "Hello" and st["slideText2"] == "Hola"
        ws.send_json({"action": "go_live", "title": "Des", "source_id": None,
                      "slides": [{"type": "design", "bg": {"color": "#111"}, "elements": [{"type": "text", "x": 1, "y": 1, "w": 1, "h": 1, "text": "T"}]}]})
        st = ws.receive_json()
        assert st["slideType"] == "design" and st["design"]["bg"]["color"] == "#111"
