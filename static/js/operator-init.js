// Operator panel — wire-up: tab/subtab switching, all element event
// bindings, keyboard shortcuts, and the final bootstrap() call. Must load
// LAST, after every other operator-*.js file (every function it binds to
// an event has to already be defined by the time this file runs).

// ============ Wire up ============

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  };
});

// Scripture sub-tabs
document.querySelectorAll(".subtab").forEach((sub) => {
  sub.onclick = () => {
    document.querySelectorAll(".subtab").forEach((s) => s.classList.remove("active"));
    document.querySelectorAll(".sub-panel").forEach((p) => p.classList.remove("active"));
    sub.classList.add("active");
    $(`sub-${sub.dataset.sub}`).classList.add("active");
  };
});

$("song-filter").oninput = renderSongs;
$("media-filter").oninput = renderMedia;
$("save-song").onclick = saveSong;
$("import-song").onclick = openImport;
$("ccli-report").onclick = openCcliReport;
$("bible-lookup").onclick = () => bibleLookup();
$("bible-search").onclick = bibleSearch;
$("bible-ref").addEventListener("input", onScriptureInput);
$("bible-ref").addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(searchTimer); bibleLookup(); } });

$("bible-version").onchange = async () => {
  await loadBrowseBooks();
  if (lastLookup) bibleLookup(lastLookup.reference);   // re-show passage in the new version
};
$("verses-per-slide").onchange = () => { if (lastLookup) renderPassage(lastLookup); };
$("browse-book").onchange = (e) => renderChapterGrid(e.target.value);

$("prev").onclick = () => send("prev");
$("next").onclick = () => send("next");
$("black").onclick = () => send("black");
$("clear").onclick = () => send("clear");
$("show").onclick = () => send("show");

// Media + font upload
$("media-file").onchange = (e) => {
  const f = e.target.files[0];
  if (f) uploadMedia(f);
  e.target.value = "";
};
$("font-file").onchange = (e) => {
  const f = e.target.files[0];
  if (f) uploadFont(f);
  e.target.value = "";
};
$("timer-btn").onclick = openTimer;

// Audio transport
$("audio-toggle").onclick = () => send("audio", { cmd: $("audio-toggle").textContent === "Pause" ? "pause" : "resume" });
$("audio-stop").onclick = () => send("audio", { cmd: "stop" });
$("audio-loop").onclick = () => send("audio", { cmd: "loop" });

// Services + drag-reorder
$("service-select").onchange = (e) => switchService(e.target.value);
$("svc-new").onclick = newService;
$("svc-rename").onclick = renameService;
$("svc-dup").onclick = duplicateService;
$("svc-del").onclick = deleteService;
setupPlaylistDnD();

// Lower-third overlay
$("ov-show").onclick = showOverlay;
$("ov-hide").onclick = () => sendOverlay({ visible: false });
$("ov-title-in").addEventListener("keydown", (e) => { if (e.key === "Enter") showOverlay(); });
$("ov-sub-in").addEventListener("keydown", (e) => { if (e.key === "Enter") showOverlay(); });
renderOvPresets();

// Quick-Launch + PIN
$("ql-btn").onclick = openQuickLaunch;
$("pin-btn").onclick = openSecurity;
$("ql").addEventListener("click", (e) => { if (e.target.id === "ql") closeQuickLaunch(); });
$("ql-input").addEventListener("input", () => { clearTimeout(qlTimer); qlTimer = setTimeout(qlSearch, 160); });
$("ql-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); qlSel = Math.min(qlSel + 1, qlResults.length - 1); updateQlSel(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); qlSel = Math.max(0, qlSel - 1); updateQlSel(); }
  else if (e.key === "Enter") { e.preventDefault(); activateQl(qlResults[qlSel]); }
  else if (e.key === "Escape") { e.preventDefault(); closeQuickLaunch(); }
});
// Global hotkey — works even over the designer (capture phase, beats other handlers).
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggleQuickLaunch(); }
}, true);

// Appearance + UI theme
$("appearance-btn").onclick = openAppearance;
$("style-btn").onclick = openAppearance;
$("ui-theme-btn").onclick = openUiTheme;
applyUiTheme(localStorage.getItem("smi_ui_theme") || "aurora");

// Modal
$("modal-close").onclick = closeModal;
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  const dz = $("designer");
  if (dz && !dz.classList.contains("hidden")) return;   // designer captures its own keys
  if (qlOpen()) return;                                  // quick-launch captures its own keys
  const k = e.key.toLowerCase();
  if (e.key === "ArrowRight") send("next");
  else if (e.key === "ArrowLeft") send("prev");
  else if (k === "b") send("black");
  else if (k === "c") send("clear");
  else if (k === "s") send("show");
});

bootstrap();
