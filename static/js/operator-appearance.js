// Operator panel — Appearance: the operator's own accent-colour theme
// (local-only), and the live Song/Scripture template editor (font, colour,
// background, transition, auto-fit, black-screen watermark). FONTS and
// DEFAULT_SUB live in operator-fonts.js — shared with the per-item style
// override used by the song/scripture editors.

// ============ Operator UI accent theme (local) ============

const UI_THEMES = [
  { key: "aurora", name: "Aurora", c1: "#22d3ee", c2: "#a855f7" },
  { key: "emerald", name: "Emerald", c1: "#34d399", c2: "#06b6d4" },
  { key: "sunset", name: "Sunset", c1: "#fb923c", c2: "#f43f5e" },
  { key: "rose", name: "Rose", c1: "#fb7185", c2: "#a855f7" },
  { key: "gold", name: "Gold", c1: "#fbbf24", c2: "#f59e0b" },
  { key: "ocean", name: "Ocean", c1: "#38bdf8", c2: "#6366f1" },
  { key: "crimson", name: "Crimson", c1: "#f43f5e", c2: "#fb7185" },
  { key: "lime", name: "Lime", c1: "#a3e635", c2: "#22c55e" },
];

function applyUiTheme(key) {
  const t = UI_THEMES.find((x) => x.key === key) || UI_THEMES[0];
  document.documentElement.style.setProperty("--cyan", t.c1);
  document.documentElement.style.setProperty("--violet", t.c2);
  localStorage.setItem("smi_ui_theme", t.key);
}

function openUiTheme() {
  const cur = localStorage.getItem("smi_ui_theme") || "aurora";
  openModal("Operator UI colour", `
    <p class="hint">Pick an accent colour for this control panel. Saved on this device; it doesn't change the projector.</p>
    <div class="swatch-grid">${UI_THEMES.map((t) => `
      <button class="swatch ${t.key === cur ? "active" : ""}" data-key="${t.key}"
        style="background:linear-gradient(135deg, ${t.c1}, ${t.c2})"><span>${t.name}</span></button>`).join("")}</div>`);
  document.querySelectorAll(".swatch").forEach((el) => {
    el.onclick = () => {
      applyUiTheme(el.dataset.key);
      document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
      el.classList.add("active");
    };
  });
}

// ============ Appearance / theme ============

let liveTheme = null;   // last theme from server state
let liveBranding = null; // last black-screen watermark/branding from server

function sendThemePatch(target, patch) { send("theme", { target, patch }); }
function sendAnim(anim) { send("theme", { anim }); }

function subOf(theme, type) {
  const t = theme || {};
  return (type === "scripture" ? t.scripture : t.song) || {};
}

function applyThemeToPreview(s) {
  const sub = s.styleOverride || subOf(s.theme, s.slideType);
  const pt = $("preview-text"), pv = $("preview");
  pt.style.color = sub.color || "#fff";
  pt.style.fontFamily = sub.font || "";
  const isText = !s.black && !s.clear && s.hasContent && s.slideType !== "image" && s.slideType !== "video";
  pv.style.backgroundColor = (isText && !sub.bgVideo) ? (sub.bg || "#000") : "#000";
  pv.style.backgroundImage = (isText && !sub.bgVideo && sub.bgImage) ? `url("${sub.bgImage}")` : "";
  pv.style.backgroundSize = "cover";
  pv.style.backgroundPosition = "center";
}

let apTarget = "song";

async function openAppearance() {
  const media = await api("/api/media");
  const imgs = media.filter((m) => m.kind === "image");
  const vids = media.filter((m) => m.kind === "video");
  apTarget = "song";
  const t = liveTheme || {};
  openModal("Appearance — separate templates", `
    <div class="subtabs" id="ap-tabs">
      <button class="subtab active" data-t="song">Songs / Lyrics</button>
      <button class="subtab" data-t="scripture">Scripture</button>
    </div>
    <div id="ap-controls"></div>
    <label class="mini-label">Slide transition (applies to both)</label>
    <select id="ap-anim" class="field"></select>
    <label class="mini-label chk"><input type="checkbox" id="ap-autofit" ${(t.autoFit !== false) ? "checked" : ""}> Auto-fit text — shrink long verses so nothing clips</label>
    <hr style="border:0;border-top:1px solid var(--stroke);margin:14px 0">
    <label class="mini-label">Black-screen watermark (shown when you press Black)</label>
    <input id="ap-wm" class="field" type="text" placeholder="e.g. SMI · Saints Ministry International" value="${esc((liveBranding && liveBranding.text) || "")}">
    <label class="mini-label">Watermark logo (optional)</label>
    <select id="ap-wmlogo" class="field">
      <option value="">None</option>
      ${imgs.map((m) => `<option value="${esc(m.src)}" ${(liveBranding && m.src === liveBranding.logo) ? "selected" : ""}>${esc(m.title)}</option>`).join("")}
    </select>
    <div class="row gap" style="margin-top:14px">
      <button id="ap-reset" class="btn grow">Reset this template</button>
      <button id="ap-done" class="btn primary grow">Done</button>
    </div>`);

  $("ap-anim").innerHTML = ["fade", "slide", "zoom", "none"]
    .map((a) => `<option value="${a}" ${a === (t.anim || "fade") ? "selected" : ""}>${a[0].toUpperCase() + a.slice(1)}</option>`).join("");
  $("ap-anim").onchange = () => sendAnim($("ap-anim").value);
  $("ap-autofit").onchange = () => send("theme", { autoFit: $("ap-autofit").checked });
  const pushBranding = () => send("branding", { branding: { text: $("ap-wm").value, logo: $("ap-wmlogo").value || null } });
  $("ap-wm").oninput = pushBranding;
  $("ap-wmlogo").onchange = pushBranding;

  const renderControls = () => {
    const sub = Object.assign(DEFAULT_SUB(), subOf(liveTheme, apTarget));
    const fontOpts = fontOptionsHtml(sub.font);
    const imgOpts = `<option value="">None</option>` + imgs.map((m) => `<option value="${esc(m.src)}" ${m.src === sub.bgImage ? "selected" : ""}>${esc(m.title)}</option>`).join("");
    const vidOpts = `<option value="">None</option>` + vids.map((m) => `<option value="${esc(m.src)}" ${m.src === sub.bgVideo ? "selected" : ""}>${esc(m.title)}</option>`).join("");
    $("ap-controls").innerHTML = `
      <label class="mini-label">Font</label>
      <select id="ap-font" class="field">${fontOpts}</select>
      <div class="row gap two">
        <div class="grow"><label class="mini-label">Text colour</label><input id="ap-color" type="color" class="field color" value="${sub.color || "#ffffff"}"></div>
        <div class="grow"><label class="mini-label">Background colour</label><input id="ap-bg" type="color" class="field color" value="${sub.bg || "#000000"}"></div>
      </div>
      <label class="mini-label">Text size</label>
      <input id="ap-size" type="range" min="3" max="10" step="0.5" value="${sub.size || 6}" class="field range">
      <div class="row gap two">
        <div class="grow"><label class="mini-label">Background image</label><select id="ap-bgimage" class="field">${imgOpts}</select></div>
        <div class="grow"><label class="mini-label">Background video</label><select id="ap-bgvideo" class="field">${vidOpts}</select></div>
      </div>
      <p class="hint">Upload images/videos in the <b>Media</b> tab to use as backgrounds. Video overrides image.</p>`;
    const push = () => sendThemePatch(apTarget, {
      font: $("ap-font").value, color: $("ap-color").value, bg: $("ap-bg").value,
      size: parseFloat($("ap-size").value),
      bgImage: $("ap-bgimage").value || null, bgVideo: $("ap-bgvideo").value || null,
    });
    ["ap-font", "ap-color", "ap-bg", "ap-size", "ap-bgimage", "ap-bgvideo"].forEach((id) => { $(id).oninput = push; $(id).onchange = push; });
  };
  renderControls();

  document.querySelectorAll("#ap-tabs .subtab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll("#ap-tabs .subtab").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      apTarget = tab.dataset.t;
      renderControls();
    };
  });
  $("ap-reset").onclick = () => { sendThemePatch(apTarget, DEFAULT_SUB()); closeModal(); };
  $("ap-done").onclick = closeModal;
}
