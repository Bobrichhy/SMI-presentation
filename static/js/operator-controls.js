// Operator panel — smaller live-control features: stage timer/clock,
// lower-third/notice overlay, global Quick-Launch (Ctrl/⌘+K), the operator
// PIN lock screen, and app bootstrap (init()).

// ============ Stage timer / clock ============

let liveTimer = null;

function openTimer() {
  const t = liveTimer || { mode: "off" };
  openModal("Stage timer / clock", `
    <p class="hint">Show the current time, or a countdown for whoever is on stage. It appears on the Live Output.</p>
    <div class="row gap">
      <button id="tm-clock" class="btn grow ${t.mode === "clock" ? "active" : ""}">🕐 Show clock</button>
      <button id="tm-off" class="btn grow ${t.mode === "off" ? "active" : ""}">Hide</button>
    </div>
    <label class="mini-label" style="margin-top:12px">Countdown</label>
    <div class="row gap">
      <input id="tm-min" type="number" min="1" max="180" value="5" class="field" style="max-width:90px">
      <span class="hint" style="align-self:center">minutes</span>
      <button id="tm-start" class="btn primary grow">Start countdown</button>
    </div>
    <div class="row gap" style="margin-top:8px">
      <button id="tm-plus" class="btn grow">＋1 min</button>
      <button id="tm-minus" class="btn grow">−1 min</button>
    </div>
    <hr style="border:0;border-top:1px solid var(--stroke);margin:14px 0">
    <label class="mini-label">Message to the stage monitor (<a href="/stage" target="_blank" rel="noopener" style="color:var(--cyan)">/stage ↗</a>)</label>
    <div id="tm-msg-presets" class="chip-row"></div>
    <div class="row gap">
      <input id="tm-msg" class="field" type="text" placeholder="Custom message…">
      <button id="tm-msg-send" class="btn primary">Send</button>
      <button id="tm-msg-clear" class="btn">Clear</button>
    </div>`);
  $("tm-clock").onclick = () => { send("timer", { cmd: "clock" }); closeModal(); };
  $("tm-off").onclick = () => { send("timer", { cmd: "off" }); closeModal(); };
  $("tm-start").onclick = () => {
    const m = Math.max(1, parseInt($("tm-min").value || "5", 10));
    send("timer", { cmd: "countdown", seconds: m * 60 }); closeModal();
  };
  $("tm-plus").onclick = () => send("timer", { cmd: "adjust", seconds: 60 });
  $("tm-minus").onclick = () => send("timer", { cmd: "adjust", seconds: -60 });
  const STAGE_MSGS = ["Wrap up", "5 minutes left", "2 minutes left", "Time's up", "Pick up the pace", "Slow down"];
  $("tm-msg-presets").innerHTML = STAGE_MSGS.map((m) => `<span class="chip" data-m="${esc(m)}">${esc(m)}</span>`).join("");
  $("tm-msg-presets").querySelectorAll(".chip").forEach((el) => { el.onclick = () => send("stage", { message: el.dataset.m }); });
  $("tm-msg-send").onclick = () => send("stage", { message: $("tm-msg").value });
  $("tm-msg-clear").onclick = () => { $("tm-msg").value = ""; send("stage", { message: "" }); };
  $("tm-msg").addEventListener("keydown", (e) => { if (e.key === "Enter") send("stage", { message: $("tm-msg").value }); });
}

// ============ Lower-third / notice overlay ============

const OV_PRESETS = ["Please silence your phones", "Welcome!", "Tithes & Offering", "Prayer", "Communion", "Altar Call"];

function sendOverlay(patch) { send("overlay", { overlay: patch }); }
function showOverlay() {
  sendOverlay({ visible: true, title: $("ov-title-in").value, subtitle: $("ov-sub-in").value, position: $("ov-pos").value });
}
function renderOvPresets() {
  $("ov-presets").innerHTML = OV_PRESETS.map((p) => `<span class="chip" data-t="${esc(p)}">${esc(p)}</span>`).join("");
  $("ov-presets").querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      $("ov-title-in").value = el.dataset.t; $("ov-sub-in").value = "";
      sendOverlay({ visible: true, title: el.dataset.t, subtitle: "", position: $("ov-pos").value });
    };
  });
}
function renderOverlayPreview(o) {
  const box = $("preview-ov");
  if (!o || !o.visible || !(o.title || o.subtitle)) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.classList.toggle("top", o.position === "top");
  $("preview-ov-title").textContent = o.title || "";
  $("preview-ov-sub").textContent = o.subtitle || "";
}

// ============ Global Quick-Launch (Ctrl/⌘+K) ============
// Go live with any scripture reference or song from anywhere — even over the designer.

let qlResults = [];
let qlSel = 0;
let qlToken = 0;
let qlTimer = null;

function openQuickLaunch() {
  $("ql").classList.remove("hidden");
  const inp = $("ql-input");
  inp.value = ""; qlResults = []; qlSel = 0; renderQl();
  setTimeout(() => inp.focus(), 0);
}
function closeQuickLaunch() { $("ql").classList.add("hidden"); }
function toggleQuickLaunch() { $("ql").classList.contains("hidden") ? openQuickLaunch() : closeQuickLaunch(); }
function qlOpen() { return !$("ql").classList.contains("hidden"); }

async function qlSearch() {
  const q = $("ql-input").value.trim();
  const tok = ++qlToken;
  if (!q) { qlResults = []; qlSel = 0; renderQl(); return; }
  const res = [];
  const ql = q.toLowerCase();
  for (const s of songsCache) {
    if (s.title.toLowerCase().includes(ql) || (s.slides || []).some((sl) => (sl.text || "").toLowerCase().includes(ql))) {
      res.push({ kind: "song", label: s.title, sub: `Song · ${s.slides.length} slide(s)`, song: s });
      if (res.length >= 5) break;
    }
  }
  if (looksLikeReference(q)) {
    const d = await api(`/api/bible/lookup?ref=${encodeURIComponent(q)}&translation=${version()}`);
    if (tok !== qlToken) return;
    if (d.ok) res.unshift({ kind: "ref", label: `${d.reference} (${d.translation})`, sub: (d.verses[0].text || "").slice(0, 70), data: d });
  } else if (q.length >= 3) {
    const sd = await api(`/api/bible/search?q=${encodeURIComponent(q)}&translation=${version()}`);
    if (tok !== qlToken) return;
    (sd.results || []).slice(0, 6).forEach((h) => res.push({ kind: "searchref", label: h.ref, sub: (h.text || "").slice(0, 76), ref: h.ref }));
  }
  if (tok !== qlToken) return;
  qlResults = res; qlSel = 0; renderQl();
}

function renderQl() {
  const box = $("ql-results");
  if (!qlResults.length) { box.innerHTML = $("ql-input").value.trim() ? `<div class="ql-empty">No matches — try a reference like “Psalm 23”.</div>` : `<div class="ql-empty">Type a reference, a song title, or a lyric.</div>`; return; }
  box.innerHTML = qlResults.map((r, i) => `
    <div class="ql-row ${i === qlSel ? "sel" : ""}" data-i="${i}">
      <span class="ql-kind ${r.kind === "song" ? "song" : "verse"}">${r.kind === "song" ? "SONG" : "VERSE"}</span>
      <span class="ql-main"><b>${esc(r.label)}</b><small>${esc(r.sub || "")}</small></span>
      <span class="ql-go">Go live ⏎</span></div>`).join("");
  box.querySelectorAll(".ql-row").forEach((el) => {
    el.onmouseenter = () => { qlSel = +el.dataset.i; updateQlSel(); };
    el.onclick = () => activateQl(qlResults[+el.dataset.i]);
  });
}
function updateQlSel() {
  document.querySelectorAll("#ql-results .ql-row").forEach((el, i) => el.classList.toggle("sel", i === qlSel));
  const cur = document.querySelector("#ql-results .ql-row.sel");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}
async function activateQl(item) {
  if (!item) return;
  closeQuickLaunch();
  if (item.kind === "song") {
    goLiveDeck(item.song.title, item.song.slides, null, 0, item.song.style || null);
    logUsage(item.song);
  } else if (item.kind === "ref") {
    goLiveScripture(item.data);
  } else if (item.kind === "searchref") {
    const d = await api(`/api/bible/lookup?ref=${encodeURIComponent(item.ref)}&translation=${version()}`);
    if (d.ok) goLiveScripture(d);
  }
}

// ============ Operator PIN / lock ============

function showLock() {
  $("lock").classList.remove("hidden");
  const inp = $("lock-pin");
  setTimeout(() => inp.focus(), 50);
  const go = async () => {
    const r = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: inp.value }),
    });
    if (!r.ok) { $("lock-err").textContent = "Wrong PIN — try again."; inp.value = ""; return; }
    const d = await r.json();
    localStorage.setItem("smi_token", d.token);
    $("lock").classList.add("hidden");
    init();
  };
  $("lock-go").onclick = go;
  inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
}

async function openSecurity() {
  const st = await fetch("/api/auth/status").then((r) => r.json());
  openModal("Operator PIN", `
    <p class="hint">${st.pinSet
      ? "A PIN is set — controlling this app requires it on every device. The projector (/live) and stage (/stage) screens are never locked."
      : "No PIN is set, so anyone on the Wi-Fi can control the app. Set a PIN to lock control."}</p>
    <label class="mini-label">${st.pinSet ? "New PIN (leave blank to remove)" : "Set a PIN"}</label>
    <input id="sec-pin" class="field" type="text" inputmode="numeric" placeholder="e.g. 1234">
    <div class="row gap" style="margin-top:8px">
      <button id="sec-save" class="btn primary grow">${st.pinSet ? "Update PIN" : "Set PIN"}</button>
      <button id="sec-cancel" class="btn grow">Cancel</button>
    </div>`);
  $("sec-cancel").onclick = closeModal;
  $("sec-save").onclick = async () => {
    const pin = $("sec-pin").value.trim();
    await fetch("/api/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (pin) {
      const d = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }).then((r) => r.json());
      if (d.token) localStorage.setItem("smi_token", d.token);
    } else {
      localStorage.removeItem("smi_token");
    }
    closeModal();
    location.reload();   // reconnect everything with the new auth state
  };
}

function init() {
  connect();
  loadServices();
  loadSongs();
  loadPlaylist();
  loadTranslations();
  loadMedia();
  loadFonts();
  renderPresets();
  renderRecents();
}

async function bootstrap() {
  let st;
  try { st = await fetch("/api/auth/status").then((r) => r.json()); }
  catch (_) { st = { pinSet: false, authed: true }; }
  if (st.pinSet && !st.authed) showLock();
  else init();
}
