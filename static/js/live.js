// Live Output: a dumb renderer. Draws whatever render payload the server sends —
// text, image (photos / PDF pages), video, and a background audio track. Design
// slides are rendered via the shared designRender() from design-render.js.
//
// Browsers block sound until the user interacts with the page, so the first state
// that needs audio/video shows a "click to enable sound" button; one click unlocks
// playback for the rest of the service.

const stage = document.getElementById("stage");
const slideText = document.getElementById("slide-text");
const slideText2 = document.getElementById("slide-text2");
const slideRef = document.getElementById("slide-ref");
const slideImage = document.getElementById("slide-image");
const slideVideo = document.getElementById("slide-video");
const bgAudio = document.getElementById("bg-audio");
const bgVideo = document.getElementById("bg-video");
const bgImage = document.getElementById("bg-image");
const enableBtn = document.getElementById("enable-media");
const watermark = document.getElementById("watermark");
const wmText = document.getElementById("wm-text");
const wmLogo = document.getElementById("wm-logo");
const status = document.getElementById("status");

const timerEl = document.getElementById("timer");
const timerTime = document.getElementById("timer-time");
const timerLabel = document.getElementById("timer-label");

let ws, reconnectTimer;
let unlocked = false;
let lastState = null;
let timerState = { mode: "off" };
let serverOffset = 0;

function fmtDur(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return (neg ? "-" : "") + m + ":" + String(s % 60).padStart(2, "0");
}
function tickTimer() {
  if (!timerEl) return;
  if (timerState.mode === "off") { timerEl.classList.add("hidden"); return; }
  timerEl.classList.remove("hidden");
  timerLabel.textContent = timerState.label || "";
  const now = Date.now() + serverOffset;
  if (timerState.mode === "clock") {
    timerTime.textContent = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    timerEl.classList.remove("warn", "over");
  } else if (timerState.mode === "countdown") {
    const rem = (timerState.endsAt || 0) - now;
    timerTime.textContent = fmtDur(rem);
    timerEl.classList.toggle("warn", rem <= 60000 && rem > 0);
    timerEl.classList.toggle("over", rem <= 0);
  }
}
setInterval(tickTimer, 250);

// Black-screen branding: when Black is pressed, show the watermark text/logo.
function applyWatermark(s) {
  const b = s.branding || {};
  if (s.black && (b.text || b.logo)) {
    watermark.classList.remove("hidden");
    wmText.textContent = b.text || "";
    if (b.logo) { wmLogo.src = b.logo; wmLogo.classList.remove("hidden"); }
    else wmLogo.classList.add("hidden");
  } else {
    watermark.classList.add("hidden");
  }
}

// Lower-third / notice that sits OVER the current content (independent layer).
const overlayEl = document.getElementById("overlay");
const ovTitle = document.getElementById("ov-title");
const ovSub = document.getElementById("ov-sub");
function applyOverlay(o) {
  const show = !!(o.visible && (o.title || o.subtitle));
  overlayEl.classList.toggle("pos-top", o.position === "top");
  overlayEl.classList.toggle("pos-bottom", o.position !== "top");
  if (show) {
    ovTitle.textContent = o.title || "";
    ovSub.textContent = o.subtitle || "";
    ovTitle.style.display = o.title ? "" : "none";
    ovSub.style.display = o.subtitle ? "" : "none";
  }
  overlayEl.classList.toggle("show", show);
}

function reloadFonts() {
  const l = document.getElementById("fonts-css");
  if (l) l.href = "/api/fonts.css?ts=" + Date.now();
}
let lastSlideKey = null;   // detect real slide changes to (re)trigger the animation

function slideKey(s) {
  if (s.black || s.clear || !s.hasContent) return "blank";
  return `${s.slideType}|${s.slideIndex}|${s.slideSrc || ""}|${(s.slideText || "").slice(0, 24)}`;
}
function replayAnim(el, anim) {
  if (!el || anim === "none") return;
  el.classList.remove("anim-fade", "anim-slide", "anim-zoom");
  void el.offsetWidth;                 // force reflow so the animation replays
  el.classList.add("anim-" + (anim || "fade"));
}

function hideVisuals() {
  slideImage.classList.add("hidden");
  if (!slideVideo.classList.contains("hidden")) { slideVideo.pause(); slideVideo.classList.add("hidden"); }
  stage.classList.remove("media");
}
function showText(s) {
  hideVisuals();
  slideText.textContent = s.slideText || "";
  slideText2.textContent = s.slideText2 || "";
  slideText2.style.display = s.slideText2 ? "" : "none";
  slideRef.textContent = s.slideType === "scripture" ? (s.slideRef || "") : "";
}
function showImage(src) {
  slideText.textContent = ""; slideText2.textContent = ""; slideRef.textContent = "";
  if (!slideVideo.classList.contains("hidden")) { slideVideo.pause(); slideVideo.classList.add("hidden"); }
  stage.classList.add("media");
  if (slideImage.getAttribute("src") !== src) slideImage.setAttribute("src", src);
  slideImage.classList.remove("hidden");
}
function showVideo(src) {
  slideText.textContent = ""; slideText2.textContent = ""; slideRef.textContent = "";
  slideImage.classList.add("hidden");
  stage.classList.add("media");
  if (slideVideo.getAttribute("src") !== src) { slideVideo.setAttribute("src", src); slideVideo.load(); }
  slideVideo.classList.remove("hidden");
  if (unlocked) slideVideo.play().catch(() => {});
  else maybePromptUnlock();
}
function showNothing() {
  slideText.textContent = ""; slideText2.textContent = ""; slideRef.textContent = "";
  hideVisuals();
}

const designEl = document.getElementById("design");
const designCanvas = document.getElementById("design-canvas");
let currentDesign = null;

function showDesign(design) {
  showNothing();
  stage.classList.add("hidden");
  currentDesign = design;
  designEl.classList.remove("hidden");
  fitDesign();
}
function hideDesign() {
  if (!designEl.classList.contains("hidden")) { designEl.classList.add("hidden"); currentDesign = null; }
  stage.classList.remove("hidden");
}
function fitDesign() {
  if (!currentDesign) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = vw, h = w * 9 / 16;
  if (h > vh) { h = vh; w = h * 16 / 9; }
  designCanvas.style.width = w + "px";
  designCanvas.style.height = h + "px";
  designRender(designCanvas, currentDesign, h);
}
window.addEventListener("resize", () => { fitDesign(); if (lastState) fitText(lastState); });

function render(s) {
  lastState = s;
  if (s.black) { stage.classList.add("black"); showNothing(); hideDesign(); }
  else {
    stage.classList.remove("black");
    if (s.clear || !s.hasContent) { showNothing(); hideDesign(); }
    else if (s.slideType === "design" && s.design) showDesign(s.design);
    else { hideDesign();
      if (s.slideType === "image" && s.slideSrc) showImage(s.slideSrc);
      else if (s.slideType === "video" && s.slideSrc) showVideo(s.slideSrc);
      else showText(s);
    }
  }
  applyTheme(s);
  fitText(s);
  applyBackground(s);
  applyWatermark(s);

  // Animate when the slide actually changes (not on theme/audio-only updates).
  const key = slideKey(s);
  if (key !== lastSlideKey && key !== "blank") {
    const anim = (s.theme && s.theme.anim) || "fade";
    if (s.slideType === "design") replayAnim(designCanvas, anim);
    else if (s.slideType === "image") replayAnim(slideImage, anim);
    else if (s.slideType !== "video") { replayAnim(slideText, anim); replayAnim(slideRef, anim); }
  }
  lastSlideKey = key;

  if (s.overlay) applyOverlay(s.overlay);
  if (s.audio) reconcileAudio(s.audio);
  if (s.timer) {
    timerState = s.timer;
    serverOffset = (s.timer.now || Date.now()) - Date.now();
    tickTimer();
  }
}

// Per-item style beats the per-type template; otherwise pick template by slide type.
function subTheme(s) {
  if (s.styleOverride) return s.styleOverride;
  const t = s.theme || {};
  return (s.slideType === "scripture") ? (t.scripture || {}) : (t.song || {});
}

function applyTheme(s) {
  const sub = subTheme(s);
  slideText.style.color = sub.color || "#fff";
  slideText.style.fontFamily = sub.font || "";
  slideText.style.fontSize = (sub.size || 6) + "vmin";
  slideText2.style.color = sub.color || "#fff";
  slideText2.style.fontFamily = sub.font || "";
  slideText2.style.fontSize = ((sub.size || 6) * 0.78) + "vmin";
}

// Auto-fit: shrink the verse so long slides never clip (never grows past the theme size).
function fitText(s) {
  if (s.black || s.clear || !s.hasContent) return;
  if (["image", "video", "design"].includes(s.slideType)) return;
  if (s.theme && s.theme.autoFit === false) return;
  const sub = subTheme(s);
  const vminPx = Math.min(stage.clientWidth, stage.clientHeight) / 100;
  let px = (sub.size || 6) * vminPx;
  const apply = () => { slideText.style.fontSize = px + "px"; slideText2.style.fontSize = (px * 0.78) + "px"; };
  apply();
  let guard = 0;
  while (stage.scrollHeight > stage.clientHeight + 1 && px > 12 && guard < 80) {
    px *= 0.95; guard++; apply();
  }
}

// A background image or looping video only shows behind text/scripture slides;
// photos, videos and black/clear take the whole screen on their own.
function applyBackground(s) {
  const sub = subTheme(s);
  const isText = !s.black && !s.clear && s.hasContent && s.slideType !== "image" && s.slideType !== "video";

  // background video
  const vsrc = (isText && sub.bgVideo) ? sub.bgVideo : "";
  if ((bgVideo.dataset.src || "") !== vsrc) {
    if (vsrc) { bgVideo.src = vsrc; bgVideo.dataset.src = vsrc; bgVideo.play().catch(() => {}); }
    else { bgVideo.removeAttribute("src"); bgVideo.dataset.src = ""; bgVideo.load(); }
  }
  // background image
  const isrc = (isText && !vsrc && sub.bgImage) ? sub.bgImage : "";
  if ((bgImage.dataset.src || "") !== isrc) {
    bgImage.style.backgroundImage = isrc ? `url("${isrc}")` : "";
    bgImage.dataset.src = isrc;
  }

  bgVideo.classList.toggle("hidden", !vsrc);
  bgImage.classList.toggle("hidden", !isrc);
  if (vsrc && bgVideo.paused) bgVideo.play().catch(() => {});

  if (vsrc || isrc) stage.style.background = "transparent";
  else stage.style.background = (!s.black && isText) ? (sub.bg || "#000") : "#000";
}

function reconcileAudio(a) {
  const cur = bgAudio.dataset.src || "";
  if ((a.src || "") !== cur) {
    if (a.src) { bgAudio.src = a.src; bgAudio.dataset.src = a.src; }
    else { bgAudio.removeAttribute("src"); bgAudio.dataset.src = ""; bgAudio.load(); }
  }
  bgAudio.loop = !!a.loop;
  if (a.src && a.playing) {
    if (unlocked) { if (bgAudio.paused) bgAudio.play().catch(() => {}); }
    else maybePromptUnlock();
  } else if (!bgAudio.paused) {
    bgAudio.pause();
  }
}

function needsSound(s) {
  if (!s) return false;
  const audioWanted = s.audio && s.audio.src && s.audio.playing;
  const videoWanted = !s.black && !s.clear && s.hasContent && s.slideType === "video";
  return audioWanted || videoWanted;
}
function maybePromptUnlock() {
  if (!unlocked && needsSound(lastState)) enableBtn.classList.remove("hidden");
}

function unlock() {
  unlocked = true;
  enableBtn.classList.add("hidden");
  // Resume whatever should currently be playing.
  if (lastState) {
    if (lastState.audio && lastState.audio.src && lastState.audio.playing) bgAudio.play().catch(() => {});
    if (!lastState.black && !lastState.clear && lastState.hasContent && lastState.slideType === "video") {
      slideVideo.play().catch(() => {});
    }
  }
}

enableBtn.addEventListener("click", unlock);
document.body.addEventListener("click", () => { if (!unlocked) unlock(); });
document.body.addEventListener("dblclick", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { status.textContent = ""; status.classList.add("hidden"); };
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === "state") render(d);
    else if (d.type === "fonts") reloadFonts();
  };
  ws.onclose = () => {
    status.classList.remove("hidden"); status.textContent = "disconnected — reconnecting…";
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
}

connect();
