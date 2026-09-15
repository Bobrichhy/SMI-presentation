// Stage / confidence monitor — read-only view for the preacher/operator:
// current slide, next slide, a clock, the countdown, and a pushed message.
// Design slides render via the shared designRender() from design-render.js,
// forced muted and without the background video (a lightweight confidence view).

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const stClock = $("st-clock"), stCount = $("st-count"), stNow = $("st-now"),
  stNext = $("st-next"), stMsg = $("st-msg"), stStatus = $("st-status");

let ws, reconnectTimer, timerState = { mode: "off" }, serverOffset = 0;

function renderSlideInto(el, sl) {
  el.innerHTML = "";
  if (!sl) { el.innerHTML = `<span class="st-empty">—</span>`; return; }
  if (sl.type === "design") {
    const c = document.createElement("div");
    c.className = "st-design";
    el.appendChild(c);
    designRender(c, sl, c.clientHeight || el.clientHeight || 200, { muteAll: true, bgVideo: false });
    return;
  }
  if (sl.type === "image") { const i = document.createElement("img"); i.src = sl.src; i.className = "st-img"; el.appendChild(i); return; }
  if (sl.type === "video") {
    if (sl.poster) { const i = document.createElement("img"); i.src = sl.poster; i.className = "st-img"; el.appendChild(i); }
    else el.innerHTML = `<span class="st-empty">▶ Video</span>`;
    return;
  }
  let html = "";
  if (sl.type === "scripture" && sl.ref) html += `<div class="st-ref">${esc(sl.ref)}</div>`;
  html += `<div class="st-text">${esc(sl.text || "")}</div>`;
  if (sl.text2) html += `<div class="st-text2">${esc(sl.text2)}</div>`;
  el.innerHTML = html;
}

function nowSlide(s) {
  if (!s.hasContent || s.black || s.clear) return null;
  if (s.slideType === "design") return s.design;
  return { type: s.slideType, text: s.slideText, text2: s.slideText2, ref: s.slideRef, src: s.slideSrc };
}

function render(s) {
  if (s.black) { stNow.innerHTML = `<span class="st-empty">● Black</span>`; }
  else if (s.clear) { stNow.innerHTML = `<span class="st-empty">Cleared</span>`; }
  else renderSlideInto(stNow, nowSlide(s));
  renderSlideInto(stNext, s.nextSlide || null);

  stMsg.textContent = s.stageMessage || "";
  stMsg.classList.toggle("show", !!s.stageMessage);

  if (s.timer) { timerState = s.timer; serverOffset = (s.timer.now || Date.now()) - Date.now(); }
}

function tick() {
  const now = Date.now() + serverOffset;
  stClock.textContent = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (timerState.mode === "countdown") {
    const rem = (timerState.endsAt || 0) - now;
    const neg = rem < 0, a = Math.abs(rem), m = Math.floor(a / 1000 / 60), sec = Math.floor(a / 1000) % 60;
    stCount.textContent = (neg ? "-" : "") + m + ":" + String(sec).padStart(2, "0");
    stCount.className = "st-count" + (rem <= 0 ? " over" : rem <= 60000 ? " warn" : "");
  } else { stCount.textContent = ""; stCount.className = "st-count"; }
}
setInterval(tick, 250);

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { stStatus.classList.add("hidden"); };
  ws.onmessage = (ev) => { const d = JSON.parse(ev.data); if (d.type === "state") render(d); };
  ws.onclose = () => {
    stStatus.classList.remove("hidden"); stStatus.textContent = "disconnected — reconnecting…";
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
}
connect();
