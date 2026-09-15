// Operator panel — Songs: library CRUD, the song editor modal, lyric import
// (paste / file), and CCLI usage logging + report.

// ============ Songs ============

async function loadSongs() {
  songsCache = await fetch("/api/songs").then((r) => r.json());
  renderSongs();
}

function renderSongs() {
  const q = $("song-filter").value.trim().toLowerCase();
  const ul = $("song-list");
  ul.innerHTML = "";
  const match = (s) => s.title.toLowerCase().includes(q) ||
    (s.slides || []).some((sl) => (sl.text || "").toLowerCase().includes(q));
  for (const song of songsCache.filter(match)) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <span class="grow"><b>${esc(song.title)}</b><small>${song.slides.length} slide(s)</small></span>
      <button class="btn small primary">Add</button>
      <button class="btn small edit">Edit</button>
      <button class="btn danger">✕</button>`;
    li.querySelector(".primary").onclick = () => addSongToService(song.id);
    li.querySelector(".edit").onclick = () => openSongEditor(song);
    li.querySelector(".danger").onclick = () => deleteSong(song.id);
    ul.appendChild(li);
  }
}

function parseSlides(raw) {
  return raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
    let type = "verse";
    const m = block.match(/^\[(verse|chorus|bridge)\]\s*\n?/i);
    if (m) { type = m[1].toLowerCase(); block = block.slice(m[0].length).trim(); }
    // A line of --- or === splits a slide into two languages (primary / secondary).
    const parts = block.split(/\n\s*[-=]{3,}\s*\n/);
    const slide = { type, text: parts[0].trim() };
    if (parts.length > 1 && parts.slice(1).join("\n").trim()) slide.text2 = parts.slice(1).join("\n").trim();
    return slide;
  });
}

async function saveSong() {
  const title = $("new-title").value.trim();
  const slides = parseSlides($("new-slides").value);
  if (!title || !slides.length) return alert("Need a title and at least one slide.");
  await fetch("/api/songs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, slides }),
  });
  $("new-title").value = ""; $("new-slides").value = "";
  await loadSongs();
}

async function deleteSong(id) {
  const song = songsCache.find((s) => s.id === id);
  if (!(await confirmDialog(`Delete the song “${song ? song.title : ""}”? This can't be undone.`))) return;
  await fetch(`/api/songs/${id}`, { method: "DELETE" });
  await Promise.all([loadSongs(), loadPlaylist()]);
}

function slidesToText(slides) {
  return slides.map((s) => {
    const tag = (s.type && s.type !== "verse") ? `[${s.type}]\n` : "";
    return tag + (s.text || "") + (s.text2 ? `\n---\n${s.text2}` : "");
  }).join("\n\n");
}

function openSongEditor(song) {
  const creating = !song.id;
  openModal(creating ? "New song" : "Edit song", `
    <div class="row gap two">
      <div class="grow"><label class="mini-label">Title</label><input id="edit-title" class="field" value="${esc(song.title)}"></div>
      <div><label class="mini-label">CCLI #</label><input id="edit-ccli" class="field" style="max-width:110px" value="${esc(song.ccli || "")}" placeholder="optional"></div>
    </div>
    <label class="mini-label">Slides — blank line between blocks · [chorus]/[bridge] to tag · a "---" line adds a 2nd language</label>
    <textarea id="edit-slides" class="field mono" rows="9">${esc(slidesToText(song.slides || []))}</textarea>
    ${styleSectionHtml(song.style)}
    <div class="row gap" style="margin-top:10px">
      <button id="edit-save" class="btn primary grow">${creating ? "Create song" : "Save changes"}</button>
      <button id="edit-cancel" class="btn grow">Cancel</button>
    </div>`);
  wireStyleSection();
  $("edit-cancel").onclick = closeModal;
  $("edit-save").onclick = async () => {
    const title = $("edit-title").value.trim();
    const slides = parseSlides($("edit-slides").value);
    if (!title || !slides.length) return alert("Need a title and at least one slide.");
    const body = JSON.stringify({ title, slides, style: readStyleSection(), ccli: $("edit-ccli").value.trim() || null });
    const headers = { "Content-Type": "application/json" };
    if (creating) await fetch("/api/songs", { method: "POST", headers, body });
    else await fetch(`/api/songs/${song.id}`, { method: "PUT", headers, body });
    closeModal();
    await Promise.all([loadSongs(), loadPlaylist()]);
  };
}

function openImport() {
  openModal("Import song", `
    <p class="hint">Paste lyrics (works with <b>CCLI SongSelect</b> text & <b>ChordPro</b>), or upload a file (.txt, OpenLyrics .xml, ProPresenter .pro4/.pro6, OpenSong/.usr). CCLI/copyright footers and chords are cleaned up automatically.</p>
    <textarea id="imp-text" class="field mono" rows="9" placeholder="Paste lyrics here…"></textarea>
    <div class="row gap">
      <button id="imp-paste" class="btn grow">📋 Paste</button>
      <label class="btn grow upload-btn">⬆ File<input id="imp-file" type="file" accept=".txt,.xml,.cho,.crd,.chordpro,.pro,.pro4,.pro5,.pro6,.usr,.sng" hidden></label>
      <button id="imp-go" class="btn primary grow">Parse &amp; edit</button>
    </div>
    <div id="imp-status" class="hint"></div>`);
  $("imp-paste").onclick = async () => {
    try { $("imp-text").value = await navigator.clipboard.readText(); }
    catch (_) { $("imp-status").textContent = "Couldn't read the clipboard — paste manually with Ctrl/⌘+V."; }
  };
  $("imp-go").onclick = async () => {
    const t = $("imp-text").value.trim();
    if (!t) { $("imp-status").textContent = "Paste some lyrics first."; return; }
    const d = await fetch("/api/songs/import/text", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }),
    }).then((r) => r.json());
    handleImport(d);
  };
  $("imp-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $("imp-status").textContent = `Reading ${f.name}…`;
    const fd = new FormData(); fd.append("file", f);
    const d = await fetch("/api/songs/import/file", { method: "POST", body: fd }).then((r) => r.json());
    e.target.value = "";
    handleImport(d);
  };
}
function handleImport(d) {
  if (d.error) { $("imp-status").textContent = d.error; return; }
  if (!d.slides || !d.slides.length) { $("imp-status").textContent = "Couldn't find any lyrics in that — try pasting the text."; return; }
  closeModal();
  openSongEditor({ title: d.title, slides: d.slides, ccli: d.ccli });   // create mode — review before saving
}

// ============ CCLI usage logging ============

function logUsage(song) {
  if (!song) return;
  fetch("/api/usage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song_id: song.id || null, title: song.title, ccli: song.ccli || null }),
  }).catch(() => {});
}

async function openCcliReport() {
  const rep = await api("/api/usage/report");
  const rows = rep.length
    ? rep.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.ccli || "—")}</td><td style="text-align:center">${r.count}</td><td class="mono">${esc((r.last || "").replace("T", " "))}</td></tr>`).join("")
    : `<tr><td colspan="4" class="hint">No songs projected yet.</td></tr>`;
  openModal("CCLI usage report", `
    <p class="hint">Every song you project is logged automatically (de-duplicated within 10 minutes). Export this for your CCLI reporting.</p>
    <div style="max-height:46vh;overflow:auto"><table class="ccli-table">
      <thead><tr><th>Song</th><th>CCLI #</th><th>Times</th><th>Last used</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row gap" style="margin-top:12px">
      <a class="btn primary grow" href="/api/usage/export.csv">⬇ Export CSV</a>
      <button id="ccli-clear" class="btn grow danger">Clear log</button>
      <button id="ccli-close" class="btn grow">Close</button>
    </div>`);
  $("ccli-close").onclick = closeModal;
  $("ccli-clear").onclick = async () => {
    if (await confirmDialog("Clear the entire usage log? Export it first if you still need it.")) {
      await fetch("/api/usage", { method: "DELETE" });
      openCcliReport();
    }
  };
}
