// Operator panel — Order of service: the playlist itself (add/remove/go-live,
// drag-reorder) and saved services (switch/new/rename/duplicate/delete).

// ============ Playlist ============

async function loadPlaylist() {
  const items = await fetch("/api/playlist").then((r) => r.json());
  $("playlist-empty").classList.toggle("hidden", items.length > 0);
  const ul = $("playlist");
  ul.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.draggable = true;
    li.dataset.id = it.id;
    const badge = it.item_type === "media" ? (it.media_kind || "media") : it.item_type;
    const meta = it.item_type === "media" && it.media_kind === "audio"
      ? "background audio" : `${it.slide_count} slide(s)`;
    const editBtn = it.item_type === "scripture" ? `<button class="btn small edit">Edit</button>` : "";
    const goLabel = it.item_type === "media" && it.media_kind === "audio" ? "Play" : "Go Live";
    li.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="type-badge ${badge}">${badge}</span>
      <span class="grow"><b>${esc(it.title)}</b><small>${meta}</small></span>
      <button class="btn small primary">${goLabel}</button>
      ${editBtn}
      <button class="btn danger">✕</button>`;
    li.querySelector(".primary").onclick = () => goLiveItem(it);
    if (editBtn) li.querySelector(".edit").onclick = () => openScriptureEditor(it);
    li.querySelector(".danger").onclick = () => removeItem(it.id);
    li.addEventListener("dragstart", () => { dragId = it.id; li.classList.add("dragging"); });
    li.addEventListener("dragend", () => { li.classList.remove("dragging"); persistOrder(); });
    ul.appendChild(li);
  }
}

async function addSongToService(songId) {
  await fetch(`/api/playlist/items?song_id=${songId}`, { method: "POST" });
  await loadPlaylist();
}

async function removeItem(id) {
  if (!(await confirmDialog("Remove this item from the order of service?", "Remove"))) return;
  await fetch(`/api/playlist/items/${id}`, { method: "DELETE" });
  await loadPlaylist();
}

async function goLiveItem(item) {
  if (item.item_type === "media" && item.media_kind === "audio") {
    playAudio(item.src, item.title, true);   // background audio, looped
    return;
  }
  let slides, style = null;
  if (item.item_type === "scripture" || item.item_type === "media" || item.item_type === "presentation") {
    slides = item.slides || [];
    style = item.style || null;
  } else {
    const song = await fetch(`/api/songs/${item.song_id}`).then((r) => r.json());
    slides = song.slides;
    style = song.style || null;
    logUsage(song);
  }
  goLiveDeck(item.title, slides, item.id, 0, style);
}

// ============ Saved services + drag-reorder ============

let servicesCache = [];
let activeServiceId = null;
let dragId = null;

async function loadServices() {
  servicesCache = await api("/api/services");
  const act = await api("/api/active-service");
  activeServiceId = act.id;
  const sel = $("service-select");
  sel.innerHTML = "";
  for (const s of servicesCache) {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = `${s.name} · ${s.item_count}`;
    if (s.id === activeServiceId) o.selected = true;
    sel.appendChild(o);
  }
}
async function switchService(id) {
  await fetch(`/api/active-service?service_id=${id}`, { method: "POST" });
  await Promise.all([loadServices(), loadPlaylist()]);
}
async function newService() {
  const name = await promptDialog("New service", "Name", "Service");
  if (name === null) return;
  const s = await fetch("/api/services", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || "New service" }),
  }).then((r) => r.json());
  await switchService(s.id);
}
async function renameService() {
  const cur = servicesCache.find((s) => s.id === activeServiceId);
  const name = await promptDialog("Rename service", "Name", cur ? cur.name : "");
  if (!name) return;
  await fetch(`/api/services/${activeServiceId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  await loadServices();
}
async function duplicateService() {
  const s = await fetch(`/api/services/${activeServiceId}/duplicate`, { method: "POST" }).then((r) => r.json());
  await switchService(s.id);
}
async function deleteService() {
  if (servicesCache.length <= 1) return alert("You need at least one service.");
  const cur = servicesCache.find((s) => s.id === activeServiceId);
  if (!(await confirmDialog(`Delete service “${cur ? cur.name : ""}” and everything in it?`))) return;
  await fetch(`/api/services/${activeServiceId}`, { method: "DELETE" });
  await Promise.all([loadServices(), loadPlaylist()]);
}

function setupPlaylistDnD() {
  const ul = $("playlist");
  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = ul.querySelector(".list-item.dragging");
    if (!dragging) return;
    const after = [...ul.querySelectorAll(".list-item:not(.dragging)")].find((li) => {
      const r = li.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) ul.insertBefore(dragging, after); else ul.appendChild(dragging);
  });
}
async function persistOrder() {
  const ids = [...$("playlist").querySelectorAll(".list-item")].map((li) => +li.dataset.id);
  await fetch("/api/playlist/reorder", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: ids }),
  });
}
