// Operator panel — fonts + the shared per-item "style override" UI block
// (used by both the song editor and the scripture editor to let one item
// deviate from the Appearance template) and custom font upload/delete.

// ============ Fonts + style-override defaults ============

const FONTS = [
  { name: "Modern Sans", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { name: "Classic Serif", stack: "Georgia, 'Times New Roman', serif" },
  { name: "Elegant", stack: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { name: "Rounded", stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { name: "Slab", stack: "'Rockwell', 'Courier New', Courier, serif" },
  { name: "Monospace", stack: "ui-monospace, 'Courier New', monospace" },
];

const DEFAULT_SUB = () => ({ font: FONTS[0].stack, color: "#ffffff", bg: "#000000", bgImage: null, bgVideo: null, size: 6 });

// Reusable per-item appearance controls (override the global template).
function styleSectionHtml(style) {
  const on = !!style;
  const s = style || DEFAULT_SUB();
  const imgs = mediaCache.filter((m) => m.kind === "image");
  const vids = mediaCache.filter((m) => m.kind === "video");
  const imgOpts = `<option value="">None</option>` + imgs.map((m) => `<option value="${esc(m.src)}" ${m.src === s.bgImage ? "selected" : ""}>${esc(m.title)}</option>`).join("");
  const vidOpts = `<option value="">None</option>` + vids.map((m) => `<option value="${esc(m.src)}" ${m.src === s.bgVideo ? "selected" : ""}>${esc(m.title)}</option>`).join("");
  return `
    <label class="mini-label chk"><input type="checkbox" id="st-on" ${on ? "checked" : ""}> Customise this item's look (override the template)</label>
    <div id="st-controls" class="${on ? "" : "dim"}">
      <label class="mini-label">Font</label>
      <select id="st-font" class="field">${fontOptionsHtml(s.font || FONTS[0].stack)}</select>
      <div class="row gap two">
        <div class="grow"><label class="mini-label">Text colour</label><input id="st-color" type="color" class="field color" value="${s.color || "#ffffff"}"></div>
        <div class="grow"><label class="mini-label">Background colour</label><input id="st-bg" type="color" class="field color" value="${s.bg || "#000000"}"></div>
      </div>
      <label class="mini-label">Text size</label>
      <input id="st-size" type="range" min="3" max="10" step="0.5" value="${s.size || 6}" class="field range">
      <div class="row gap two">
        <div class="grow"><label class="mini-label">Background image</label><select id="st-bgimage" class="field">${imgOpts}</select></div>
        <div class="grow"><label class="mini-label">Background video</label><select id="st-bgvideo" class="field">${vidOpts}</select></div>
      </div>
    </div>`;
}
function wireStyleSection() {
  const upd = () => $("st-controls").classList.toggle("dim", !$("st-on").checked);
  $("st-on").onchange = upd; upd();
}
function readStyleSection() {
  if (!$("st-on") || !$("st-on").checked) return null;
  return {
    font: $("st-font").value, color: $("st-color").value, bg: $("st-bg").value,
    size: parseFloat($("st-size").value),
    bgImage: $("st-bgimage").value || null, bgVideo: $("st-bgvideo").value || null,
  };
}

// ============ Custom fonts ============

let uploadedFonts = [];

async function loadFonts() {
  uploadedFonts = await api("/api/fonts");
  renderFontList();
  refreshFontFace();
}
function refreshFontFace() {
  const l = document.getElementById("fonts-css");
  if (l) l.href = "/api/fonts.css?ts=" + Date.now();
}
function renderFontList() {
  const ul = $("font-list");
  if (!ul) return;
  ul.innerHTML = uploadedFonts.length
    ? uploadedFonts.map((f) => `<li class="list-item">
        <span class="grow"><b style="font-family:'${esc(f.family)}'">${esc(f.family)}</b></span>
        <button class="btn danger" data-id="${f.id}">✕</button></li>`).join("")
    : `<p class="hint">No custom fonts yet.</p>`;
  ul.querySelectorAll(".danger").forEach((b) => { b.onclick = () => deleteFont(b.dataset.id); });
}
function uploadFont(file) {
  $("font-status").textContent = `Uploading ${file.name}…`;
  const fd = new FormData(); fd.append("file", file);
  fetch("/api/fonts", { method: "POST", body: fd })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok) { $("font-status").textContent = `Failed: ${j.detail || "error"}`; return; }
      $("font-status").textContent = `Added “${j.family}”.`;
      send("refresh_fonts");           // tell the projector to pick up the new font
      loadFonts();
    });
}
async function deleteFont(id) {
  if (!(await confirmDialog("Delete this font?"))) return;
  await fetch(`/api/fonts/${id}`, { method: "DELETE" });
  send("refresh_fonts");
  loadFonts();
}
function fontOptionsHtml(selected) {
  const opts = [
    ...FONTS.map((f) => ({ name: f.name, stack: f.stack })),
    ...uploadedFonts.map((f) => ({ name: f.family + " (custom)", stack: `'${f.family}', sans-serif` })),
  ];
  return opts.map((o) => `<option value="${esc(o.stack)}" ${o.stack === selected ? "selected" : ""}>${esc(o.name)}</option>`).join("");
}
