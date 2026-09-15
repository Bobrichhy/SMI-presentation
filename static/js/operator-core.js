// Operator panel — shared core: DOM/escaping helpers, the auth-token fetch
// patch, the WebSocket connection + live-state rendering, generic modal
// dialogs (openModal/closeModal/confirmDialog/promptDialog), and the api()
// JSON-fetch helper used throughout the rest of the operator scripts.
// Load this before every other operator-*.js file.

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const firstLine = (t) => (t || "").split("\n")[0];

// Attach the operator token (if any) to every same-origin request, so a PIN-locked
// server accepts our mutations. Patched globally → designer.js fetches get it too.
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const token = localStorage.getItem("smi_token");
  if (token && typeof url === "string" && url.startsWith("/")) {
    opts = { ...opts, headers: { ...(opts.headers || {}), "X-SMI-Token": token } };
  }
  return _origFetch(url, opts);
};

let lastPreviewKey = null;
function previewReplay(el, anim) {
  if (!el || anim === "none") return;
  el.classList.remove("anim-fade", "anim-slide", "anim-zoom");
  void el.offsetWidth;
  el.classList.add("anim-" + (anim || "fade"));
}

let ws, reconnectTimer;
let songsCache = [];
let currentDeck = { title: null, slides: [], sourceId: null };  // what's loaded in the control column

// ============ WebSocket + live-state rendering ============


function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = encodeURIComponent(localStorage.getItem("smi_token") || "");
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onopen = () => { $("ws-dot").classList.add("on"); $("ws-label").textContent = "live"; };
  ws.onclose = () => {
    $("ws-dot").classList.remove("on"); $("ws-label").textContent = "reconnecting…";
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "state") renderLiveState(data);
  };
}

function send(action, extra = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action, ...extra }));
}

function goLiveDeck(title, slides, sourceId, index = 0, style = null) {
  currentDeck = { title, slides, sourceId, style };
  renderDeck();
  send("go_live", { title, slides, source_id: sourceId, slide_index: index, style });
}

// ============ Live state rendering ============

function renderLiveState(s) {
  $("live-title").textContent = s.hasContent ? s.title : "Nothing live";
  $("slide-counter").textContent = s.hasContent ? `${s.slideIndex + 1} / ${s.totalSlides}` : "—";

  const isThisDeck = s.title === currentDeck.title;
  document.querySelectorAll("#slide-list li").forEach((li) => {
    li.classList.toggle("active", isThisDeck && Number(li.dataset.index) === s.slideIndex);
  });

  const pv = $("preview"), pt = $("preview-text"), pr = $("preview-ref"), pi = $("preview-image"), pvid = $("preview-video"), pd = $("preview-design");
  pv.classList.toggle("black", !!s.black);
  const hideVid = () => { if (!pvid.classList.contains("hidden")) { pvid.pause(); pvid.classList.add("hidden"); } };
  const hidePd = () => pd.classList.add("hidden");
  if (s.black || s.clear || !s.hasContent) {
    pr.textContent = ""; pi.classList.add("hidden"); hideVid(); hidePd();
    pt.textContent = (s.black && s.branding && s.branding.text) ? s.branding.text : "";
  } else if (s.slideType === "design" && s.design) {
    pt.textContent = ""; pr.textContent = ""; pi.classList.add("hidden"); hideVid();
    pd.classList.remove("hidden");
    if (typeof designRender === "function") designRender(pd, s.design, pd.clientHeight || 90);
  } else if (s.slideType === "image" && s.slideSrc) {
    pt.textContent = ""; pr.textContent = ""; pi.src = s.slideSrc; pi.classList.remove("hidden"); hideVid(); hidePd();
  } else if (s.slideType === "video" && s.slideSrc) {
    pt.textContent = ""; pr.textContent = ""; pi.classList.add("hidden"); hidePd();
    if (pvid.getAttribute("src") !== s.slideSrc) { pvid.setAttribute("src", s.slideSrc); }
    pvid.classList.remove("hidden"); pvid.play().catch(() => {});
  } else {
    pi.classList.add("hidden"); hideVid(); hidePd();
    pt.textContent = s.slideText || "";
    pr.textContent = s.slideType === "scripture" ? (s.slideRef || "") : "";
  }
  const pt2 = $("preview-text2");
  const showText2 = !s.black && !s.clear && s.hasContent && s.slideText2 && s.slideType !== "image" && s.slideType !== "video" && s.slideType !== "design";
  pt2.textContent = showText2 ? s.slideText2 : "";
  pt2.style.display = showText2 ? "" : "none";

  $("black").classList.toggle("active", !!s.black);
  $("clear").classList.toggle("active", !!s.clear);
  renderAudioBar(s.audio);
  liveTheme = s.theme || liveTheme;
  liveTimer = s.timer || liveTimer;
  liveBranding = s.branding || liveBranding;
  renderOverlayPreview(s.overlay);
  applyThemeToPreview(s);

  const pkey = (s.black || s.clear || !s.hasContent)
    ? "blank" : `${s.slideType}|${s.slideIndex}|${s.slideSrc || ""}|${(s.slideText || "").slice(0, 24)}`;
  if (pkey !== lastPreviewKey && pkey !== "blank") {
    const anim = (s.theme && s.theme.anim) || "fade";
    if (s.slideType === "image") previewReplay($("preview-image"), anim);
    else if (s.slideType !== "video") previewReplay($("preview-text"), anim);
  }
  lastPreviewKey = pkey;
}

function renderAudioBar(a) {
  const bar = $("audio-bar");
  if (!a || !a.src) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  $("audio-title").textContent = a.title || "Audio";
  $("audio-toggle").textContent = a.playing ? "Pause" : "Play";
  $("audio-loop").classList.toggle("active", !!a.loop);
}

function playAudio(src, title, loop) {
  send("audio", { cmd: "play", src, title, loop: !!loop });
}

function renderDeck() {
  const ul = $("slide-list");
  ul.innerHTML = "";
  currentDeck.slides.forEach((slide, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    if (slide.type === "design") {
      li.innerHTML = `<span class="tag">design</span><span class="snippet">Slide ${i + 1}</span>`;
    } else if (slide.type === "image") {
      li.innerHTML = `<img class="slide-thumb" src="${esc(slide.src)}" alt=""><span class="snippet">Slide ${i + 1}</span>`;
    } else if (slide.type === "video") {
      const p = slide.poster ? `<img class="slide-thumb" src="${esc(slide.poster)}" alt="">` : `<span class="tag">▶</span>`;
      li.innerHTML = `${p}<span class="snippet">Video</span>`;
    } else {
      const label = slide.type === "scripture" ? (slide.ref || "verse") : slide.type;
      li.innerHTML = `<span class="tag">${esc(label)}</span><span class="snippet">${esc(firstLine(slide.text))}</span>`;
    }
    li.onclick = () => goLiveDeck(currentDeck.title, currentDeck.slides, currentDeck.sourceId, i, currentDeck.style);
    ul.appendChild(li);
  });
}

// ============ Generic modal dialogs ============

function openModal(title, bodyHtml) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal").classList.remove("hidden");
}
function closeModal() {
  $("modal").classList.add("hidden");
  $("modal-body").innerHTML = "";
}

// In-app confirmation (replaces the native confirm so it always shows + matches the UI).
function confirmDialog(message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    openModal("Please confirm", `
      <p style="margin:0 0 16px; line-height:1.5">${esc(message)}</p>
      <div class="row gap">
        <button id="cf-no" class="btn primary grow">Cancel</button>
        <button id="cf-yes" class="btn grow danger-solid">${esc(confirmLabel)}</button>
      </div>`);
    const done = (v) => { closeModal(); resolve(v); };
    $("cf-yes").onclick = () => done(true);
    $("cf-no").onclick = () => done(false);
  });
}

// Modal prompt for a single text value (replaces the native prompt).
function promptDialog(title, label, value = "") {
  return new Promise((resolve) => {
    openModal(title, `
      <label class="mini-label">${esc(label)}</label>
      <input id="pd-input" class="field" value="${esc(value)}">
      <div class="row gap" style="margin-top:8px">
        <button id="pd-no" class="btn grow">Cancel</button>
        <button id="pd-yes" class="btn primary grow">OK</button>
      </div>`);
    const inp = $("pd-input");
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const done = (v) => { closeModal(); resolve(v); };
    $("pd-yes").onclick = () => done(inp.value.trim());
    $("pd-no").onclick = () => done(null);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(inp.value.trim());
      else if (e.key === "Escape") done(null);
    });
  });
}

// ============ Generic JSON-fetch helper ============

const api = (p) => fetch(p).then((r) => r.json());
