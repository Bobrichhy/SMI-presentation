// Operator panel — Media library: upload photos/music/video/PDF, list,
// filter, and add to the current service.

// ============ Media ============

let mediaCache = [];

async function loadMedia() {
  mediaCache = await api("/api/media");
  renderMedia();
}

function renderMedia() {
  const q = $("media-filter").value.trim().toLowerCase();
  const items = mediaCache.filter((m) => m.title.toLowerCase().includes(q) || m.kind.includes(q));
  const ul = $("media-list");
  ul.innerHTML = "";
  if (!items.length) {
    ul.innerHTML = `<p class="hint">${mediaCache.length ? "No media matches." : "No media yet — upload above."}</p>`;
    return;
  }
  for (const m of items) {
    const li = document.createElement("li");
    li.className = "list-item";
    const poster = m.slides && m.slides[0] && m.slides[0].poster;
    let thumb;
    if (m.kind === "audio") thumb = `<span class="m-ico">♪</span>`;
    else if (m.kind === "video") thumb = poster ? `<img class="m-thumb" src="${esc(poster)}" alt="">` : `<span class="m-ico">▶</span>`;
    else thumb = `<img class="m-thumb" src="${esc(m.src)}" alt="">`;
    const meta = m.kind === "audio" ? "audio"
      : m.kind === "video" ? "video"
      : m.kind === "pdf" ? `${m.slide_count} page(s)` : "image";
    li.innerHTML = `${thumb}
      <span class="grow"><b>${esc(m.title)}</b><small>${m.kind} · ${meta}</small></span>
      <button class="btn small primary">Add</button>
      <button class="btn danger">✕</button>`;
    li.querySelector(".primary").onclick = () => addMediaToService(m.id);
    li.querySelector(".danger").onclick = () => deleteMedia(m.id);
    ul.appendChild(li);
  }
}

function uploadMedia(file) {
  const status = $("media-status");
  const big = file.size > 8 * 1024 * 1024;
  status.textContent = `Uploading ${file.name}… 0%`;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/media");
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    status.textContent = pct < 100
      ? `Uploading ${file.name}… ${pct}%`
      : `Processing ${file.name}…${big ? " (video/PDF can take a moment)" : ""}`;
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      status.textContent = "Added to library.";
      loadMedia();
    } else {
      let msg = xhr.status;
      try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) {}
      status.textContent = `Upload failed: ${msg}`;
    }
  };
  xhr.onerror = () => { status.textContent = "Upload failed (network/connection)."; };
  const fd = new FormData();
  fd.append("file", file);
  xhr.send(fd);
}

async function addMediaToService(id) {
  await fetch(`/api/playlist/media?media_id=${id}`, { method: "POST" });
  await loadPlaylist();
}

async function deleteMedia(id) {
  const m = mediaCache.find((x) => x.id === id);
  if (!(await confirmDialog(`Delete “${m ? m.title : "this media"}” and remove it from the service? This can't be undone.`))) return;
  await fetch(`/api/media/${id}`, { method: "DELETE" });
  await Promise.all([loadMedia(), loadPlaylist()]);
}
