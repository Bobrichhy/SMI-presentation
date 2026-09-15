# SMI Presentation Software

A church presentation app (in the spirit of EasyWorship / ProPresenter / OpenLP):
display song lyrics and Bible verses fullscreen on a projector, driven from an
operator panel — with the live output kept in sync over WebSockets.

## What works now

- **Operator panel** (`/`): neon/glass dark UI with three columns — **Sources**
  (Songs + Scripture tabs), **Order of Service**, and **Live control**.
- **Songs**: create songs with slides, build an order of service, project them.
  **Import** (⬇ in the Songs tab) to stop re-typing: paste lyrics (smart verse/chorus
  splitting; cleans CCLI/copyright footers and ChordPro chords), or upload a file —
  **CCLI SongSelect text**, **ChordPro**, **OpenLyrics .xml**, **OpenSong/.usr**, or
  **ProPresenter .pro4/.pro6**. You review in the editor before saving.
- **Scripture studio**: pick a Bible **version**, then
  - **Find** — look up a reference (`John 3:16-18`, `Psalm 23`, `1 cor 13:4`) or
    **search by words/phrase**: type `for God so loved the world` and it finds the
    verse. Prefix matching (`love` → `loved`), relevance-ranked, matches highlighted.
  - **Browse** — tap **Book → Chapter → Verse** (no typing).
  - **Quick** — one-tap common passages + your recent lookups (saved locally).
  - **Verses per slide**: 1 / 2 / whole passage.
  - **Compare versions** side-by-side and project any of them.
  - **Continuous reading**: once live, **Next** flows through the rest of the chapter.
  - **Go Live** (ad-hoc) or **Add to Service**.
- **Design** (Presentation Designer): a free **16:9 canvas** for announcements
  ("Happy Birthday", notices, welcome slides). **New design** starts from a
  **template** (Blank, Happy Birthday, Welcome, Announcement, Verse of the Day,
  Event) or a blank canvas. Add **text / image / video / shape** elements,
  drag to move, drag the handle to resize, double-click text to edit; per-element
  font (incl. custom fonts), size, colour, bold/italic/shadow, alignment; **video
  elements** play on the canvas (loop/sound/fit); each element can have a **motion
  animation** (Fade / Slide / Zoom in, or continuous Float / Pulse / Spin); slide
  background **colour, image, or looping video**; **multiple slides**. Save to the library, add to the
  service, and project — elements are positioned in % so they scale to any screen.
- **Media**: upload **photos**, **music**, and **PDFs**.
  - A **PDF becomes a slide deck** — one page per slide, advanced like PowerPoint.
  - **Photos** project fullscreen.
  - **Video** (any format) projects fullscreen — non-web formats (mov/mkv/avi…)
    are auto-converted to MP4 via ffmpeg on upload.
  - **Music** plays as **background audio** that keeps going while you change
    lyrics/scripture/image slides (transport controls on the operator), and can
    also be triggered as a service item.
- **Saved services**: keep multiple named orders of service (Sunday, Midweek…),
  switch between them, **rename / duplicate / delete**, and **drag items to reorder**.
  Everything autosaves; the app reopens the service you last used.
- **Settings persist**: the Appearance templates and the black-screen watermark are
  saved to disk and survive restarts.
- **CCLI usage logging**: every song you project is auto-logged (de-duped within 10 min).
  Songs Tab → **📊 CCLI usage report** to view counts and **export CSV** for reporting.
  A song's CCLI # is captured on import and editable in the song editor.
- **Dual-language songs**: put a `---` line in a slide block to add a second language;
  it's shown stacked under the primary text on the projector, preview, and stage.
- **Auto-fit text**: long verses shrink to fit so nothing ever clips (toggle in
  🎨 Appearance).
- **Editing**: edit songs (title + slides) from the library, and adjust a
  scripture item's **reference / version / verses-per-slide** in the service
  (verse wording stays faithful to the translation).
- **Appearance** (🎨 in the top bar / control panel): **separate templates** for
  **Songs** and **Scripture** (EasyWorship-style) — each with its own **font**,
  **text colour**, **background colour**, **text size**, and **background image or
  video**. Plus a shared **slide transition** (fade / slide / zoom / none). Changes
  broadcast live; the projector picks the right template per slide type.
- **UI theme** (🌈 in the top bar): recolour the operator panel itself with preset
  accent palettes (saved per device; doesn't affect the projector).
- **Live Output** (`/live`): bare fullscreen renderer for the projector — text
  slides, image/PDF slides, and the background audio track. Scripture slides show
  a glowing reference header above the verse.
- **Quick-Launch** (**Ctrl/⌘+K**, or the ⚡ button): from *anywhere* — even mid-design —
  type a reference (`John 3:16`) or a song/lyric, press **Enter**, and it goes live
  instantly. Designed for unplanned jumps when the preacher calls a verse on the fly.
- **Lower-third / notice overlay**: show a name + subtitle (or a notice like “Please
  silence your phones”) as a banner **over** whatever's live — without replacing the
  slide. Bottom or top, with quick presets. In the Live-control panel under
  **▭ Lower-third / notice**.
- **Instant sync** over one WebSocket. The **server owns the live state**, so a
  Live Output opened *late* immediately shows the current slide.
- **Black / Clear / Show** projector states. Songs and playlist persist in SQLite.

## Bible versions

Translation *text* is copyright-protected, so what can ship offline is limited:

**Bundled, offline, free** (in `data/bible.db`):

| Code | Version | Note |
|------|---------|------|
| KJV  | King James Version | traditional |
| WEB  | World English Bible | **modern English** — the readable, NIV-style stand-in |
| ASV  | American Standard Version | formal/literal |
| YLT  | Young's Literal Translation | very literal |
| BBE  | Bible in Basic English | simple English |
| WB   | Webster's Bible | |
| AKJV | American King James Version | |
| DRB  | Douay-Rheims Bible | includes deuterocanon |

> This project's *code* is MIT-licensed (see `LICENSE`) — that covers the app
> itself, not the bundled Bible text. All eight versions above are Public
> Domain except **AKJV**, which is "free non-commercial distribution" (see
> `data/build_bible.py`'s `TRANSLATIONS` map for each version's exact license).

**NIV / NKJV / ESV / NASB etc. are copyrighted** and **cannot be legally bundled**
in any app. To use them you supply your **own licensed online key** and the app
fetches verses live (nothing copyrighted is stored). See *Online versions* below.

### Online versions (optional, your own key)

Set environment variables before launching — copyrighted versions then appear in
the version dropdown under "Online":

```bash
# ESV — free for non-commercial use: https://api.esv.org/
export ESV_API_KEY=your_key

# API.Bible — https://scripture.api.bible/  (carries NKJV and others, subject to
# each publisher's terms; NIV is generally NOT available even here)
export API_BIBLE_KEY=your_key
export API_BIBLE_IDS="NKJV:de4e12af7f28f599-02"   # code:bibleId,code:bibleId,…
```

## Tech

- Backend: FastAPI + WebSockets; PyMuPDF renders PDF pages to slide images;
  **ffmpeg** (system install, optional) transcodes non-web video formats to MP4 +
  makes posters — the app works fine without it, non-web videos just won't
  auto-convert
- Storage: SQLite — `data.db` (user content) + bundled read-only `data/bible.db`;
  uploads live under `media/` (served at `/media`). In the packaged desktop app
  these live under the OS's normal per-user app-data folder instead (so they
  survive updates/reinstalls) — see `app/paths.py`.
- Frontend: vanilla HTML/CSS/JS, no build step
- Desktop packaging: `desktop.py` opens the app in a native window via
  **pywebview**; `.github/workflows/build.yml` builds Linux/Windows/macOS
  binaries with PyInstaller — see *Download* and *Building the desktop app* below.

## Download

Prebuilt Linux/Windows/macOS binaries are attached to each
[Release](releases) — no Python install required. Grab the one for your
OS, run it, and the operator panel opens in its own window.

> First run creates its data folder under your OS's normal per-user app-data
> location (e.g. `~/.local/share/SMI Presentation` on Linux,
> `~/Library/Application Support/SMI Presentation` on macOS, `%APPDATA%\SMI
> Presentation` on Windows) — that's where your songs, services, and uploads
> are kept from then on.

## Run it

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py                        # serves on http://127.0.0.1:8001
```

> Default port is **8001** (8000 was taken on the dev machine). Override with
> `PORT=9000 python run.py`.

> Uploads are capped server-side at **1024 MB** for media (photos/music/video/PDF)
> and **25 MB** for fonts, so a mistaken or oversized upload can't fill the disk.
> Override with `SMI_MAX_UPLOAD_MB` / `SMI_MAX_FONT_MB`.

### Building the desktop app from source

Prefer a prebuilt binary from [Releases](releases) unless you're changing the
code. To build one yourself:

```bash
pip install -r requirements-desktop.txt
# Linux only — pywebview's GTK backend needs these system libraries first:
#   sudo apt install libgirepository1.0-dev libcairo2-dev pkg-config \
#     python3-dev libgtk-3-dev gir1.2-gtk-3.0 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-dev
#   pip install pygobject

python desktop.py     # run it straight from source, in its own window

# or package it into a single binary (run on each target OS — PyInstaller
# doesn't cross-compile, which is also why .github/workflows/build.yml
# builds all three platforms on GitHub's own Linux/Windows/macOS runners):
pyinstaller --name SMI-Presentation --onefile --windowed \
  --add-data "static:static" --add-data "data:data" desktop.py   # Windows: use ; not :
```

> `--windowed` hides the console, so the phone/tablet LAN address (below)
> won't be visible in the desktop build — use `python run.py` or drop
> `--windowed` if you need to see it.

Open these windows:

| Page        | URL                          | Where               |
|-------------|------------------------------|---------------------|
| Operator    | http://127.0.0.1:8001/       | Control screen      |
| Live Output | http://127.0.0.1:8001/live   | Projector / 2nd screen |
| Stage monitor | http://127.0.0.1:8001/stage | Confidence screen for the preacher / operator |

The **Stage monitor** shows the **current slide + next slide**, a **clock**, the
**countdown**, and any **message** you push from the operator (Timer → "Message to the
stage monitor", e.g. *Wrap up*, *5 minutes left*).

Double-click the Live Output to toggle fullscreen.

### Control from your phone / tablet

The server binds to `0.0.0.0`, so on the **same Wi-Fi** you can run the whole
operator from a mobile device — the layout is responsive. On startup the console
prints the address, e.g. `http://192.168.x.x:8001/`. Open that on your phone.

**Lock control with a PIN** (🔒 PIN in the top bar): set an operator PIN and any
device controlling the app must enter it (mutations + live commands require it).
The **projector (/live)** and **stage (/stage)** screens are never locked — only
control. No PIN = open (default). Tokens reset on restart (re-enter the PIN).

### Black-screen watermark

Pressing **Black** shows an editable watermark (default *“SMI · Saints Ministry
International”*). Edit the text and pick an optional logo in **🎨 Appearance →
Black-screen watermark**.

Deleting a song / media / font / service item now asks for confirmation first.

## Try it

1. **Songs**: in *Order of Service*, click **Go Live** on Amazing Grace, then use
   **→ / ←** to move through verses — the Live Output follows instantly.
2. **Scripture**: open the **Scripture** tab, choose a version, type `John 3:16-18`,
   click **Look up**, then **Go Live** (ad-hoc) or **Add to Service**.
3. Switch the version dropdown to **WEB** and look up the same verse to compare wording.
4. Try **Search words** with e.g. `love` to find verses by text.

### Keyboard shortcuts (operator)

| Key | Action | | Key | Action |
|-----|--------|-|-----|--------|
| →   | Next slide | | B | Black screen |
| ←   | Prev slide | | C | Clear text |
|     |            | | S | Show |

## Tests

```bash
pytest            # API + WebSocket + import-parser regression suite
```

Tests run against a throwaway temp database (set via `SMI_DB_PATH`) and never touch
your real `data.db`.

## Project structure

```
app/
  main.py        FastAPI routes + /ws WebSocket sync
  models.py      SQLModel tables + API schemas
  database.py    user SQLite (data.db) + first-run seed
  bible.py       read-only Bible: versions, reference parsing, search
  providers.py   optional online providers (ESV / API.Bible) for licensed versions
  media.py       save uploads; render PDF pages to image slides (PyMuPDF)
  live_state.py  server-owned live deck + background audio + connection manager
  paths.py       where user data lives — project root (dev) vs OS app-data dir
                 (packaged desktop build, so it survives updates/reinstalls)
desktop.py       native-window entry point for the packaged app (pywebview)
run.py           browser-tab entry point (`python run.py`) — dev / LAN control
.github/workflows/build.yml   builds+releases Linux/Windows/macOS binaries
static/
  operator.html / js/operator-*.js   operator panel (neon glass) — split by feature:
                                      core, fonts, songs, media, scripture, playlist,
                                      appearance, controls, init (wire-up, loads last)
  js/designer.js                     Presentation Designer (free-canvas slides)
  js/design-render.js                shared read-only design-slide renderer
                                      (designer preview, live output, stage monitor)
  live.html / js/live.js             projector output
  stage.html / js/stage.js           stage/confidence monitor
  css/style.css
data/
  bible.db       bundled read-only scripture (8 public-domain versions)
  build_bible.py one-off builder (re-download translations + rebuild)
requirements.txt · requirements-desktop.txt · LICENSE · README.md
```

## How sync works

The operator resolves a song or scripture passage into a **slide deck** and pushes
it over `/ws` with `go_live`. The server stores that deck plus the live **position**
and black/clear flags, and broadcasts the current slide to every client. The Live
Output is intentionally dumb — it just draws the payload. Because the server holds
the deck and position, a projector that connects or reconnects mid-service jumps
straight to what's currently on screen.

## Rebuilding the Bible database

`data/bible.db` is generated, not hand-edited. To rebuild or add public-domain
translations, download the getbible.net json files into `data/raw/` and run
`python data/build_bible.py` (see the `TRANSLATIONS` map in that script).

## Roadmap

- Continuous reading across chapter boundaries (roll into the next chapter)
- "Move Live Output to 2nd display" helper for the desktop app (for now, drag
  the Live Output browser window/tab to the projector, same as the browser flow)

> **Audio note:** browsers block autoplaying sound until the page is interacted
> with. On the Live Output, **click once** (or double-click to go fullscreen) to
> unlock audio; background music then plays on operator command.
