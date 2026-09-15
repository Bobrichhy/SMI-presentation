// Presentation Designer — a free canvas for announcements ("Happy Birthday", etc.)
// Slides are 16:9; elements (text / image / shape) are positioned in % so they scale
// to any projector. Shares globals from operator.js ($, esc, api, send, FONTS,
// fontOptionsHtml, mediaCache, confirmDialog, openModal/closeModal, loadPlaylist)
// and from design-render.js (designRender, designBgVideo, designAnimClass) — the
// read-only slide renderer shared with the projector output and stage monitor.

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============ Presentation library ============

let presentationsCache = [];

async function loadPresentations() {
  presentationsCache = await api("/api/presentations");
  renderPresentationList();
}
function renderPresentationList() {
  const ul = $("presentation-list");
  if (!ul) return;
  ul.innerHTML = presentationsCache.length
    ? presentationsCache.map((p) => `<li class="list-item" data-id="${p.id}">
        <span class="type-badge image">design</span>
        <span class="grow"><b>${esc(p.title)}</b><small>${p.slides.length} slide(s)</small></span>
        <button class="btn small primary add">Add</button>
        <button class="btn small edit">Edit</button>
        <button class="btn danger del">✕</button></li>`).join("")
    : `<p class="hint">No designs yet — tap “New design”.</p>`;
  ul.querySelectorAll(".list-item").forEach((li) => {
    const p = presentationsCache.find((x) => x.id === +li.dataset.id);
    li.querySelector(".add").onclick = () => addPresentationToService(p.id);
    li.querySelector(".edit").onclick = () => openDesigner(p);
    li.querySelector(".del").onclick = () => deletePresentation(p);
  });
}
async function addPresentationToService(id) {
  await fetch(`/api/playlist/presentation?presentation_id=${id}`, { method: "POST" });
  await loadPlaylist();
}
async function deletePresentation(p) {
  if (!(await confirmDialog(`Delete the design “${p.title}”?`))) return;
  await fetch(`/api/presentations/${p.id}`, { method: "DELETE" });
  await Promise.all([loadPresentations(), loadPlaylist()]);
}

// ============ Designer state ============

let dz = null;          // { id, title, slides:[...], cur, sel }
let canvasEl = null;

const blankSlide = () => ({ type: "design", bg: { color: "#0b1326", image: null }, elements: [] });
const newText = () => ({ id: uid(), type: "text", x: 12, y: 36, w: 76, h: 26, text: "Double-click to edit", font: FONTS[0].stack, size: 11, color: "#ffffff", align: "center", valign: "middle", bold: true, italic: false, shadow: true, anim: "none" });
const newImage = (src) => ({ id: uid(), type: "image", x: 32, y: 22, w: 36, h: 46, src, fit: "contain", anim: "none" });
const newShape = (shape) => ({ id: uid(), type: "shape", shape, x: 36, y: 32, w: 28, h: 28, color: "#22d3ee", radius: 12, anim: "none" });
const newVideo = (src) => ({ id: uid(), type: "video", x: 28, y: 20, w: 44, h: 50, src, fit: "cover", loop: true, muted: true, anim: "none" });

const ANIMS = [["none", "None"], ["fade", "Fade in"], ["slideL", "Slide in ←"], ["slideR", "Slide in →"],
  ["slideU", "Slide in ↑"], ["slideD", "Slide in ↓"], ["zoom", "Zoom in"], ["float", "Float ↕"], ["pulse", "Pulse"], ["spin", "Spin"]];
const animClass = designAnimClass;

// ============ Starter templates ============

const TEMPLATES = [
  { name: "Blank", title: "Untitled design", slides: [{ bg: { color: "#0b1326", image: null }, elements: [] }] },
  { name: "Happy Birthday", title: "Happy Birthday", slides: [{ bg: { color: "#2a0a3a", image: null }, elements: [
    { type: "shape", shape: "ellipse", x: 41, y: 9, w: 18, h: 30, color: "#ffd24a" },
    { type: "text", x: 6, y: 45, w: 88, h: 22, text: "Happy Birthday!", font: "Georgia, serif", size: 15, color: "#ffd24a", align: "center", bold: true, shadow: true },
    { type: "text", x: 15, y: 70, w: 70, h: 12, text: "[ Name ]", font: "system-ui, sans-serif", size: 8, color: "#ffffff", align: "center", italic: true, shadow: true },
  ] }] },
  { name: "Welcome", title: "Welcome", slides: [{ bg: { color: "#06121f", image: null }, elements: [
    { type: "shape", shape: "rect", x: 34, y: 31, w: 32, h: 1.4, color: "#22d3ee", radius: 4 },
    { type: "text", x: 5, y: 34, w: 90, h: 24, text: "WELCOME", font: "system-ui, sans-serif", size: 16, color: "#ffffff", align: "center", bold: true, shadow: true },
    { type: "text", x: 10, y: 62, w: 80, h: 12, text: "to Saints Ministry International", font: "system-ui, sans-serif", size: 7, color: "#8fd9ff", align: "center", shadow: true },
  ] }] },
  { name: "Announcement", title: "Announcement", slides: [{ bg: { color: "#0e1322", image: null }, elements: [
    { type: "shape", shape: "rect", x: 0, y: 0, w: 100, h: 20, color: "#e0573e" },
    { type: "text", x: 5, y: 3, w: 90, h: 14, text: "ANNOUNCEMENT", font: "system-ui, sans-serif", size: 9, color: "#ffffff", align: "center", bold: true },
    { type: "text", x: 8, y: 33, w: 84, h: 50, text: "Type your announcement here…", font: "system-ui, sans-serif", size: 7, color: "#ffffff", align: "center", shadow: true },
  ] }] },
  { name: "Verse of the Day", title: "Verse of the Day", slides: [{ bg: { color: "#05101a", image: null }, elements: [
    { type: "text", x: 8, y: 11, w: 84, h: 9, text: "VERSE OF THE DAY", font: "system-ui, sans-serif", size: 5, color: "#22d3ee", align: "center", bold: true },
    { type: "text", x: 8, y: 28, w: 84, h: 44, text: "“For God so loved the world…”", font: "Georgia, serif", size: 9, color: "#ffffff", align: "center", italic: true, shadow: true },
    { type: "text", x: 8, y: 78, w: 84, h: 10, text: "John 3:16", font: "system-ui, sans-serif", size: 6, color: "#8fd9ff", align: "center", bold: true },
  ] }] },
  { name: "Event", title: "Event", slides: [{ bg: { color: "#101012", image: null }, elements: [
    { type: "shape", shape: "rect", x: 8, y: 18, w: 84, h: 0.8, color: "#ffd24a", radius: 2 },
    { type: "text", x: 6, y: 24, w: 88, h: 20, text: "Sunday Service", font: "system-ui, sans-serif", size: 13, color: "#ffd24a", align: "center", bold: true, shadow: true },
    { type: "text", x: 6, y: 52, w: 88, h: 10, text: "Sunday · 9:00 AM", font: "system-ui, sans-serif", size: 7, color: "#ffffff", align: "center" },
    { type: "text", x: 6, y: 64, w: 88, h: 10, text: "Main Auditorium", font: "system-ui, sans-serif", size: 6, color: "#bbbbbb", align: "center" },
  ] }] },
];

function openTemplatePicker() {
  openModal("Start a new design", `
    <p class="hint">Pick a starting point — you can change everything afterwards.</p>
    <div class="tpl-grid">${TEMPLATES.map((t, i) => `
      <div class="tpl-card" data-i="${i}"><div class="tpl-prev" id="tpl-prev-${i}"></div><div class="tpl-name">${esc(t.name)}</div></div>`).join("")}</div>`);
  TEMPLATES.forEach((t, i) => {
    const box = document.getElementById(`tpl-prev-${i}`);
    designRender(box, t.slides[0], box.clientHeight || 84);
    document.querySelector(`.tpl-card[data-i="${i}"]`).onclick = () => {
      closeModal();
      const slides = t.slides.map((s) => ({ type: "design", bg: { ...s.bg }, elements: s.elements.map((e) => ({ ...e, id: uid() })) }));
      openDesigner({ id: null, title: t.title, slides });
    };
  });
}

function openDesigner(presentation) {
  dz = presentation
    ? { id: presentation.id, title: presentation.title, slides: JSON.parse(JSON.stringify(presentation.slides || [])), cur: 0, sel: null }
    : { id: null, title: "Untitled design", slides: [blankSlide()], cur: 0, sel: null };
  if (!dz.slides.length) dz.slides = [blankSlide()];
  buildDesignerDom();
  $("designer").classList.remove("hidden");
  requestAnimationFrame(() => { renderCanvas(); renderThumbs(); renderInspector(); });
}
function closeDesigner() {
  $("designer").classList.add("hidden");
  $("designer").innerHTML = "";
  const pill = document.getElementById("dz-resume");
  if (pill) pill.classList.add("hidden");
  dz = null;
}

// Stash the designer (keep all work) so the operator — scripture, songs, Go Live —
// is instantly usable, then pop back exactly where you left off.
function minimizeDesigner() {
  $("designer").classList.add("hidden");
  let pill = document.getElementById("dz-resume");
  if (!pill) {
    pill = document.createElement("button");
    pill.id = "dz-resume"; pill.className = "dz-resume";
    pill.onclick = restoreDesigner;
    document.body.appendChild(pill);
  }
  pill.textContent = "▢ Resume design — " + (dz ? dz.title : "");
  pill.classList.remove("hidden");
}
function restoreDesigner() {
  if (!dz) return;
  $("designer").classList.remove("hidden");
  const pill = document.getElementById("dz-resume");
  if (pill) pill.classList.add("hidden");
  renderCanvas(); renderThumbs(); renderInspector();
}

function buildDesignerDom() {
  $("designer").innerHTML = `
    <div class="dz-top">
      <input id="dz-title" class="field dz-title" value="${esc(dz.title)}" placeholder="Design title">
      <button id="dz-min" class="btn" title="Stash this design and use the operator (e.g. jump to a scripture) — your work is kept">— Minimize</button>
      <button id="dz-save" class="btn primary">Save</button>
      <button id="dz-saveclose" class="btn">Save & close</button>
      <button id="dz-close" class="btn ghost">✕ Close</button>
    </div>
    <div class="dz-body">
      <div class="dz-tools">
        <button class="dz-tool" id="dz-add-text" title="Add text">T</button>
        <button class="dz-tool" id="dz-add-image" title="Add image">🖼</button>
        <button class="dz-tool" id="dz-add-video" title="Add video">▶</button>
        <button class="dz-tool" id="dz-add-rect" title="Add rectangle">▭</button>
        <button class="dz-tool" id="dz-add-ellipse" title="Add circle">◯</button>
        <button class="dz-tool" id="dz-bg" title="Slide background">▦</button>
      </div>
      <div class="dz-stagewrap" id="dz-stagewrap">
        <div id="dz-canvas" class="dz-canvas"></div>
      </div>
      <div class="dz-inspector" id="dz-inspector"></div>
    </div>
    <div class="dz-slides" id="dz-slides"></div>`;
  canvasEl = $("dz-canvas");

  $("dz-title").oninput = () => { dz.title = $("dz-title").value; };
  $("dz-min").onclick = minimizeDesigner;
  $("dz-close").onclick = closeDesigner;
  $("dz-save").onclick = () => saveDesign(false);
  $("dz-saveclose").onclick = () => saveDesign(true);
  $("dz-add-text").onclick = () => addEl(newText());
  $("dz-add-image").onclick = pickImageForElement;
  $("dz-add-video").onclick = pickVideoForElement;
  $("dz-add-rect").onclick = () => addEl(newShape("rect"));
  $("dz-add-ellipse").onclick = () => addEl(newShape("ellipse"));
  $("dz-bg").onclick = () => { dz.sel = null; renderInspector(); markSel(); };
  $("dz-stagewrap").onpointerdown = (e) => { if (e.target.id === "dz-canvas" || e.target.id === "dz-stagewrap") { dz.sel = null; markSel(); renderInspector(); } };
  window.addEventListener("resize", () => { if (dz) renderCanvas(); });
}

function curSlide() { return dz.slides[dz.cur]; }

function addEl(el) {
  curSlide().elements.push(el);
  dz.sel = el.id;
  renderCanvas(); renderInspector(); renderThumbs();
}

function pickImageForElement() {
  const imgs = mediaCache.filter((m) => m.kind === "image");
  if (!imgs.length) { alert("Upload an image in the Media tab first."); return; }
  openModal("Choose image", `<div class="list">${imgs.map((m) => `<div class="list-item pick-img" data-src="${esc(m.src)}"><img class="m-thumb" src="${esc(m.src)}"><span class="grow">${esc(m.title)}</span></div>`).join("")}</div>`);
  document.querySelectorAll(".pick-img").forEach((el) => { el.onclick = () => { closeModal(); addEl(newImage(el.dataset.src)); }; });
}

function pickVideoForElement() {
  const vids = mediaCache.filter((m) => m.kind === "video");
  if (!vids.length) { alert("Upload a video in the Media tab first."); return; }
  openModal("Choose video", `<div class="list">${vids.map((m) => {
    const poster = m.slides && m.slides[0] && m.slides[0].poster;
    const thumb = poster ? `<img class="m-thumb" src="${esc(poster)}">` : `<span class="m-ico">▶</span>`;
    return `<div class="list-item pick-vid" data-src="${esc(m.src)}">${thumb}<span class="grow">${esc(m.title)}</span></div>`;
  }).join("")}</div>`);
  document.querySelectorAll(".pick-vid").forEach((el) => { el.onclick = () => { closeModal(); addEl(newVideo(el.dataset.src)); }; });
}

// ---- canvas (editable) ----
function fitEditorCanvas() {
  const wrap = $("dz-stagewrap");
  const aw = wrap.clientWidth - 36, ah = wrap.clientHeight - 36;
  let w = aw, h = w * 9 / 16;
  if (h > ah) { h = ah; w = h * 16 / 9; }
  canvasEl.style.width = w + "px";
  canvasEl.style.height = h + "px";
}
function renderCanvas() {
  fitEditorCanvas();
  const slide = curSlide();
  const h = canvasEl.clientHeight;
  canvasEl.style.background = slide.bg.color || "#000";
  canvasEl.style.backgroundImage = slide.bg.image ? `url("${slide.bg.image}")` : "";
  canvasEl.style.backgroundSize = "cover"; canvasEl.style.backgroundPosition = "center";
  canvasEl.innerHTML = "";
  if (slide.bg.video) designBgVideo(canvasEl, slide.bg.video);
  for (const el of slide.elements) {
    const d = document.createElement("div");
    d.className = "dz-el" + (el.id === dz.sel ? " sel" : "") + animClass(el);
    d.dataset.id = el.id;
    d.style.left = el.x + "%"; d.style.top = el.y + "%"; d.style.width = el.w + "%"; d.style.height = el.h + "%";
    renderElInner(d, el, h);
    const handle = document.createElement("div");
    handle.className = "dz-handle";
    d.appendChild(handle);
    d.onpointerdown = (e) => startDrag(e, el, d);
    handle.onpointerdown = (e) => { e.stopPropagation(); startResize(e, el, d); };
    if (el.type === "text") d.ondblclick = (e) => { e.stopPropagation(); editTextInline(el, d); };
    canvasEl.appendChild(d);
  }
}
function renderElInner(d, el, h) {
  [...d.children].forEach((c) => { if (!c.classList.contains("dz-handle")) c.remove(); });
  d.style.background = "transparent"; d.style.borderRadius = "0"; d.style.display = "block";
  if (el.type === "text") {
    d.style.display = "flex";
    d.style.alignItems = el.valign === "top" ? "flex-start" : el.valign === "bottom" ? "flex-end" : "center";
    d.style.justifyContent = el.align === "left" ? "flex-start" : el.align === "right" ? "flex-end" : "center";
    const span = document.createElement("div");
    span.textContent = el.text || "";
    span.style.cssText = `font-family:${el.font};font-size:${el.size / 100 * h}px;color:${el.color};font-weight:${el.bold ? 800 : 400};font-style:${el.italic ? "italic" : "normal"};text-align:${el.align};line-height:1.2;white-space:pre-wrap;width:100%;${el.shadow ? "text-shadow:0 2px 14px rgba(0,0,0,.6);" : ""}`;
    d.insertBefore(span, d.firstChild);
  } else if (el.type === "image") {
    const img = document.createElement("img");
    img.src = el.src || ""; img.style.cssText = `width:100%;height:100%;object-fit:${el.fit || "contain"};pointer-events:none;`;
    d.insertBefore(img, d.firstChild);
  } else if (el.type === "video") {
    const v = document.createElement("video");
    v.src = el.src || ""; v.loop = el.loop !== false; v.muted = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = `width:100%;height:100%;object-fit:${el.fit || "cover"};pointer-events:none;`;
    d.insertBefore(v, d.firstChild); v.play && v.play().catch(() => {});
  } else if (el.type === "shape") {
    d.style.background = el.color || "#22d3ee";
    d.style.borderRadius = el.shape === "ellipse" ? "50%" : ((el.radius || 0) + "px");
  }
}
function markSel() {
  canvasEl.querySelectorAll(".dz-el").forEach((d) => d.classList.toggle("sel", d.dataset.id === dz.sel));
}
function selectEl(id) { dz.sel = id; markSel(); renderInspector(); }

function startDrag(e, el, d) {
  e.preventDefault(); selectEl(el.id);
  const rect = canvasEl.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y;
  const move = (ev) => {
    el.x = clamp(ox + (ev.clientX - sx) / rect.width * 100, -25, 100);
    el.y = clamp(oy + (ev.clientY - sy) / rect.height * 100, -25, 100);
    d.style.left = el.x + "%"; d.style.top = el.y + "%";
  };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); renderThumbs(); };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
}
function startResize(e, el, d) {
  e.preventDefault(); selectEl(el.id);
  const rect = canvasEl.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY, ow = el.w, oh = el.h;
  const move = (ev) => {
    el.w = clamp(ow + (ev.clientX - sx) / rect.width * 100, 3, 130);
    el.h = clamp(oh + (ev.clientY - sy) / rect.height * 100, 3, 130);
    d.style.width = el.w + "%"; d.style.height = el.h + "%";
  };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); renderThumbs(); };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
}
function editTextInline(el, d) {
  const span = d.querySelector("div");
  if (!span) return;
  span.contentEditable = "true"; span.style.outline = "none"; span.focus();
  document.execCommand && document.execCommand("selectAll", false, null);
  const finish = () => { el.text = span.innerText; span.contentEditable = "false"; renderThumbs(); };
  span.onblur = finish;
}

// ---- inspector ----
function animSelect(el) {
  return `<label class="mini-label">Animation</label>
    <select id="ins-anim" class="field">${ANIMS.map(([v, n]) => `<option value="${v}" ${v === (el.anim || "none") ? "selected" : ""}>${n}</option>`).join("")}</select>`;
}

function renderInspector() {
  const ins = $("dz-inspector");
  const el = curSlide().elements.find((x) => x.id === dz.sel);
  if (!el) { ins.innerHTML = bgInspector(); wireBgInspector(); return; }
  if (el.type === "text") ins.innerHTML = textInspector(el);
  else if (el.type === "image") ins.innerHTML = imageInspector(el);
  else if (el.type === "video") ins.innerHTML = videoInspector(el);
  else ins.innerHTML = shapeInspector(el);
  wireCommon(el);
}
function commonButtons() {
  return `<div class="row gap" style="margin-top:14px">
      <button id="ins-front" class="btn grow">Bring front</button>
      <button id="ins-back" class="btn grow">Send back</button>
    </div>
    <button id="ins-del" class="btn full danger-solid" style="margin-top:8px">Delete element</button>`;
}
function textInspector(el) {
  return `<h3 class="panel-title">Text</h3>
    <label class="mini-label">Text</label>
    <textarea id="ins-text" class="field" rows="3">${esc(el.text)}</textarea>
    <label class="mini-label">Font</label>
    <select id="ins-font" class="field">${fontOptionsHtml(el.font)}</select>
    <label class="mini-label">Size</label>
    <input id="ins-size" type="range" min="3" max="30" step="0.5" value="${el.size}" class="field range">
    <div class="row gap two">
      <div class="grow"><label class="mini-label">Colour</label><input id="ins-color" type="color" class="field color" value="${el.color}"></div>
      <div class="grow"><label class="mini-label">Align</label>
        <select id="ins-align" class="field">${["left", "center", "right"].map((a) => `<option ${a === el.align ? "selected" : ""}>${a}</option>`).join("")}</select></div>
    </div>
    <div class="row gap" style="margin-top:8px">
      <button id="ins-bold" class="btn grow ${el.bold ? "active" : ""}">Bold</button>
      <button id="ins-italic" class="btn grow ${el.italic ? "active" : ""}">Italic</button>
      <button id="ins-shadow" class="btn grow ${el.shadow ? "active" : ""}">Shadow</button>
    </div>${animSelect(el)}${commonButtons()}`;
}
function imageInspector(el) {
  const imgs = mediaCache.filter((m) => m.kind === "image");
  return `<h3 class="panel-title">Image</h3>
    <label class="mini-label">Source</label>
    <select id="ins-src" class="field">${imgs.map((m) => `<option value="${esc(m.src)}" ${m.src === el.src ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</select>
    <label class="mini-label">Fit</label>
    <select id="ins-fit" class="field">${["contain", "cover"].map((f) => `<option ${f === el.fit ? "selected" : ""}>${f}</option>`).join("")}</select>
    ${animSelect(el)}${commonButtons()}`;
}
function videoInspector(el) {
  const vids = mediaCache.filter((m) => m.kind === "video");
  return `<h3 class="panel-title">Video</h3>
    <label class="mini-label">Source</label>
    <select id="ins-vsrc" class="field">${vids.map((m) => `<option value="${esc(m.src)}" ${m.src === el.src ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</select>
    <label class="mini-label">Fit</label>
    <select id="ins-vfit" class="field">${["cover", "contain"].map((f) => `<option ${f === el.fit ? "selected" : ""}>${f}</option>`).join("")}</select>
    <div class="row gap" style="margin-top:8px">
      <button id="ins-loop" class="btn grow ${el.loop !== false ? "active" : ""}">Loop</button>
      <button id="ins-sound" class="btn grow ${el.muted === false ? "active" : ""}">Sound</button>
    </div>
    <p class="hint">Sound needs a one-time click on the Live Output to unlock.</p>
    ${animSelect(el)}${commonButtons()}`;
}
function shapeInspector(el) {
  return `<h3 class="panel-title">Shape</h3>
    <label class="mini-label">Type</label>
    <select id="ins-shape" class="field">${["rect", "ellipse"].map((s) => `<option ${s === el.shape ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label class="mini-label">Colour</label>
    <input id="ins-color" type="color" class="field color" value="${el.color}">
    <label class="mini-label">Corner radius</label>
    <input id="ins-radius" type="range" min="0" max="120" value="${el.radius || 0}" class="field range">
    ${animSelect(el)}${commonButtons()}`;
}
function bgInspector() {
  const imgs = mediaCache.filter((m) => m.kind === "image");
  const vids = mediaCache.filter((m) => m.kind === "video");
  const s = curSlide();
  return `<h3 class="panel-title">Slide background</h3>
    <label class="mini-label">Colour</label>
    <input id="bg-color" type="color" class="field color" value="${s.bg.color || "#000000"}">
    <label class="mini-label">Image</label>
    <select id="bg-image" class="field"><option value="">None</option>${imgs.map((m) => `<option value="${esc(m.src)}" ${m.src === s.bg.image ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</select>
    <label class="mini-label">Video (loops, muted)</label>
    <select id="bg-video" class="field"><option value="">None</option>${vids.map((m) => `<option value="${esc(m.src)}" ${m.src === s.bg.video ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</select>
    <p class="hint">Video plays behind your text/shapes. Select an element to style it; drag to move, drag the cyan dot to resize, double-click text to edit.</p>`;
}
function wireBgInspector() {
  const s = curSlide();
  $("bg-color").oninput = () => { s.bg.color = $("bg-color").value; renderCanvas(); renderThumbs(); };
  $("bg-image").onchange = () => { s.bg.image = $("bg-image").value || null; renderCanvas(); renderThumbs(); };
  $("bg-video").onchange = () => { s.bg.video = $("bg-video").value || null; renderCanvas(); renderThumbs(); };
}
function wireCommon(el) {
  const refresh = () => { renderCanvas(); renderThumbs(); };
  const slide = curSlide();
  if ($("ins-text")) $("ins-text").oninput = () => { el.text = $("ins-text").value; refresh(); };
  if ($("ins-font")) $("ins-font").onchange = () => { el.font = $("ins-font").value; refresh(); };
  if ($("ins-size")) $("ins-size").oninput = () => { el.size = parseFloat($("ins-size").value); refresh(); };
  if ($("ins-color")) $("ins-color").oninput = () => { el.color = $("ins-color").value; refresh(); };
  if ($("ins-align")) $("ins-align").onchange = () => { el.align = $("ins-align").value; refresh(); };
  if ($("ins-bold")) $("ins-bold").onclick = () => { el.bold = !el.bold; renderInspector(); refresh(); };
  if ($("ins-italic")) $("ins-italic").onclick = () => { el.italic = !el.italic; renderInspector(); refresh(); };
  if ($("ins-shadow")) $("ins-shadow").onclick = () => { el.shadow = !el.shadow; renderInspector(); refresh(); };
  if ($("ins-src")) $("ins-src").onchange = () => { el.src = $("ins-src").value; refresh(); };
  if ($("ins-fit")) $("ins-fit").onchange = () => { el.fit = $("ins-fit").value; refresh(); };
  if ($("ins-shape")) $("ins-shape").onchange = () => { el.shape = $("ins-shape").value; refresh(); };
  if ($("ins-radius")) $("ins-radius").oninput = () => { el.radius = parseFloat($("ins-radius").value); refresh(); };
  if ($("ins-vsrc")) $("ins-vsrc").onchange = () => { el.src = $("ins-vsrc").value; refresh(); };
  if ($("ins-vfit")) $("ins-vfit").onchange = () => { el.fit = $("ins-vfit").value; refresh(); };
  if ($("ins-loop")) $("ins-loop").onclick = () => { el.loop = (el.loop === false); renderInspector(); refresh(); };
  if ($("ins-sound")) $("ins-sound").onclick = () => { el.muted = (el.muted === false); renderInspector(); refresh(); };
  if ($("ins-anim")) $("ins-anim").onchange = () => { el.anim = $("ins-anim").value; refresh(); };
  $("ins-del").onclick = () => { slide.elements = slide.elements.filter((x) => x.id !== el.id); dz.sel = null; renderCanvas(); renderInspector(); renderThumbs(); };
  $("ins-front").onclick = () => { const i = slide.elements.indexOf(el); slide.elements.splice(i, 1); slide.elements.push(el); refresh(); };
  $("ins-back").onclick = () => { const i = slide.elements.indexOf(el); slide.elements.splice(i, 1); slide.elements.unshift(el); refresh(); };
}

// ---- slides strip ----
function renderThumbs() {
  const strip = $("dz-slides");
  strip.innerHTML = "";
  dz.slides.forEach((sl, i) => {
    const t = document.createElement("div");
    t.className = "dz-thumb" + (i === dz.cur ? " active" : "");
    t.innerHTML = `<span class="dz-thumb-n">${i + 1}</span>`;
    const inner = document.createElement("div");
    inner.style.cssText = "position:absolute;inset:0;";
    t.appendChild(inner);
    designRender(inner, sl, 58, { playVideo: false, animate: false });   // tiny thumbnails: no playing video, no animation
    t.onclick = () => { dz.cur = i; dz.sel = null; renderCanvas(); renderInspector(); renderThumbs(); };
    strip.appendChild(t);
  });
  const add = document.createElement("button");
  add.className = "dz-addslide"; add.textContent = "+";
  add.onclick = () => { dz.slides.push(blankSlide()); dz.cur = dz.slides.length - 1; dz.sel = null; renderCanvas(); renderInspector(); renderThumbs(); };
  strip.appendChild(add);
}

// ---- save ----
async function saveDesign(close) {
  dz.title = ($("dz-title").value || "Untitled design").trim();
  const body = JSON.stringify({ title: dz.title, slides: dz.slides });
  const headers = { "Content-Type": "application/json" };
  let saved;
  if (dz.id) saved = await fetch(`/api/presentations/${dz.id}`, { method: "PUT", headers, body }).then((r) => r.json());
  else { saved = await fetch("/api/presentations", { method: "POST", headers, body }).then((r) => r.json()); dz.id = saved.id; }
  await Promise.all([loadPresentations(), loadPlaylist()]);
  if (close) closeDesigner();
}

// ---- wire library + keyboard ----
{
  const nb = document.getElementById("new-presentation");
  if (nb) nb.onclick = openTemplatePicker;
  loadPresentations();
}
document.addEventListener("keydown", (e) => {
  if (!dz || $("designer").classList.contains("hidden")) return;
  if (!$("ql").classList.contains("hidden")) return;   // quick-launch is on top
  if (e.key === "Escape") closeDesigner();
  if ((e.key === "Delete" || e.key === "Backspace") && dz.sel && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT" && !document.activeElement.isContentEditable) {
    const s = curSlide(); s.elements = s.elements.filter((x) => x.id !== dz.sel); dz.sel = null;
    renderCanvas(); renderInspector(); renderThumbs();
  }
});
