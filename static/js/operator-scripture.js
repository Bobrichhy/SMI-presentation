// Operator panel — Scripture: Find (reference/word search), Browse
// (book/chapter/verse), Quick (presets + recents), version compare, and
// the scripture item editor in the order of service. (api() lives in
// operator-core.js — it's used well beyond just this file.)

const PRESETS = [
  "John 3:16", "Psalm 23", "Romans 8:28", "Philippians 4:13", "Jeremiah 29:11",
  "Psalm 91", "1 Corinthians 13:4-7", "Isaiah 41:10", "Proverbs 3:5-6",
  "Matthew 11:28-30", "Psalm 121", "Romans 12:2", "Joshua 1:9", "Psalm 46:1",
];

let offlineCodes = [];
let bookChapters = {};      // book name -> chapter count (for current version)
let browseChapterVerses = null;  // verses of the chapter currently shown in Browse
let lastLookup = null;      // last resolved passage {reference, book, chapter, start, end, verses, translation}

const version = () => $("bible-version").value;
const vps = () => $("verses-per-slide").value;

// --- slide building (client-side, honours verses-per-slide) ---
function rangeLabel(grp) {
  const first = grp[0], last = grp[grp.length - 1];
  const m = first.ref.match(/^(.*):(\d+)$/);
  const base = m ? m[1] : first.ref;
  return first.verse === last.verse ? first.ref : `${base}:${first.verse}-${last.verse}`;
}
function buildSlides(verses, translation, perSlide) {
  if (!verses.length) return [];
  const make = (grp) => ({
    type: "scripture", translation, text: grp.map((v) => v.text).join("\n"),
    ref: rangeLabel(grp), startVerse: grp[0].verse, endVerse: grp[grp.length - 1].verse,
  });
  if (perSlide === "all") return [make(verses)];
  const n = parseInt(perSlide, 10);
  const slides = [];
  for (let i = 0; i < verses.length; i += n) slides.push(make(verses.slice(i, i + n)));
  return slides;
}

async function loadTranslations() {
  const data = await api("/api/bible/translations");
  offlineCodes = data.offline.map((t) => t.code);
  const sel = $("bible-version");
  sel.innerHTML = "";
  for (const t of data.offline) {
    const o = document.createElement("option");
    o.value = t.code; o.textContent = `${t.code} — ${t.name}`;
    sel.appendChild(o);
  }
  if (data.online.length) {
    const grp = document.createElement("optgroup");
    grp.label = "Online (your key)";
    for (const t of data.online) {
      const o = document.createElement("option");
      o.value = t.code; o.textContent = `${t.code} — ${t.name}`;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }
  $("bible-note").textContent = data.offline.length
    ? `${data.offline.length} offline version(s). NIV/NKJV/ESV need an online key (README).`
    : "No Bible data installed.";
  await loadBrowseBooks();
}

// --- Find (live as you type) ---
let searchTimer = null;

function looksLikeReference(q) {
  return /[a-zA-Z]\s*\d/.test(q);   // a book word followed by a number
}

function onScriptureInput() {
  clearTimeout(searchTimer);
  const q = $("bible-ref").value.trim();
  if (q.length < 2) { $("bible-result").innerHTML = ""; return; }
  searchTimer = setTimeout(() => {
    if (looksLikeReference(q)) bibleLookup(q, false);
    else if (q.length >= 3) bibleSearch();
  }, 220);
}

async function bibleLookup(refArg, record = true) {
  const ref = (refArg || $("bible-ref").value).trim();
  if (!ref) return;
  if (refArg) $("bible-ref").value = ref;
  const data = await api(`/api/bible/lookup?ref=${encodeURIComponent(ref)}&translation=${version()}`);
  if (!data.ok) {
    // While live-typing, fail quietly instead of flashing errors.
    $("bible-result").innerHTML = record ? `<p class="hint">${esc(data.error || "Not found.")}</p>` : "";
    return;
  }
  lastLookup = data;
  if (record) pushRecent(data.reference, data.translation);
  renderPassage(data);
}

async function bibleSearch() {
  const q = $("bible-ref").value.trim();
  if (!q) return;
  const box = $("bible-result");
  box.innerHTML = `<p class="hint">Searching…</p>`;
  const data = await api(`/api/bible/search?q=${encodeURIComponent(q)}&translation=${version()}`);
  if (!data.results || !data.results.length) {
    box.innerHTML = `<p class="hint">No verses found containing those words in ${esc(version())}.</p>`;
    return;
  }
  const head = `<div class="search-head">${data.count}${data.capped ? "+" : ""} verse(s) · ${esc(version())} · most relevant first</div>`;
  box.innerHTML = head + data.results.map((hit) =>
    `<div class="search-hit" data-ref="${esc(hit.ref)}">
       <div class="sref">${esc(hit.ref)}</div>
       <div class="stext">${highlightTerms(hit.text, data.terms)}</div></div>`).join("");
  box.querySelectorAll(".search-hit").forEach((el) => { el.onclick = () => bibleLookup(el.dataset.ref); });
}

function highlightTerms(text, terms) {
  let safe = esc(text);
  for (const t of (terms || [])) {
    if (!t || t.length < 2) continue;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*)`, "gi");
    safe = safe.replace(re, "<mark>$1</mark>");
  }
  return safe;
}

// --- Passage card (shared by Find / Browse / Quick) ---
function renderPassage(data) {
  const slides = buildSlides(data.verses, data.translation, vps());
  const versesHtml = data.verses.map((v) =>
    `<p><span class="vn">${v.verse ?? ""}</span>${esc(v.text)}</p>`).join("");
  $("bible-result").innerHTML = `
    <div class="passage-card">
      <h3>${esc(data.reference)}</h3>
      <div class="tver">${esc(data.translation)} · ${slides.length} slide(s) · ${vps() === "all" ? "whole passage" : vps() + "/slide"}</div>
      <div class="passage-verses">${versesHtml}</div>
      <div class="row gap">
        <button id="scr-golive" class="btn primary grow">Go Live</button>
        <button id="scr-add" class="btn grow">Add to Service</button>
      </div>
      <button id="scr-compare" class="btn full" style="margin-top:8px">Compare versions</button>
    </div>`;
  $("scr-golive").onclick = () => goLiveScripture(data);
  $("scr-add").onclick = () => addScriptureToService(data, slides);
  $("scr-compare").onclick = () => renderCompare(data);
}

// Continuous reading: project the whole chapter, starting at the looked-up verse.
async function goLiveScripture(data) {
  const ch = await api(`/api/bible/chapter?translation=${data.translation}&book=${encodeURIComponent(data.book)}&chapter=${data.chapter}`);
  const deck = buildSlides(ch.ok ? ch.verses : data.verses, data.translation, vps());
  let startIdx = deck.findIndex((s) => data.start >= s.startVerse && data.start <= s.endVerse);
  if (startIdx < 0) startIdx = 0;
  goLiveDeck(`${data.reference} (${data.translation})`, deck, null, startIdx);
}

async function addScriptureToService(data, slides) {
  await fetch("/api/playlist/scripture", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: data.reference, translation: data.translation, slides }),
  });
  await loadPlaylist();
}

// --- Compare versions ---
async function renderCompare(data) {
  const box = $("bible-result");
  box.innerHTML = `<div class="passage-card"><h3>${esc(data.reference)}</h3>
    <div class="tver">comparing ${offlineCodes.length} versions…</div>
    <button id="cmp-back" class="btn full">← Back to passage</button>
    <div id="compare-list" class="compare-list"></div></div>`;
  $("cmp-back").onclick = () => renderPassage(lastLookup);
  const list = $("compare-list");
  const results = await Promise.all(offlineCodes.map((code) =>
    api(`/api/bible/lookup?ref=${encodeURIComponent(data.reference)}&translation=${code}`).then((d) => ({ code, d }))));
  list.innerHTML = "";
  for (const { code, d } of results) {
    if (!d.ok) continue;
    const text = d.verses.map((v) => v.text).join(" ");
    const card = document.createElement("div");
    card.className = "compare-card";
    card.innerHTML = `<div class="chead"><span class="ccode">${code}</span>
      <button class="btn small csend">Go Live</button></div>
      <div class="ctext">${esc(text)}</div>`;
    card.querySelector(".csend").onclick = () => goLiveScripture(d);
    list.appendChild(card);
  }
}

// --- Browse: book -> chapter -> verse ---
async function loadBrowseBooks() {
  const books = await api(`/api/bible/books?translation=${version()}`);
  bookChapters = {};
  const sel = $("browse-book");
  sel.innerHTML = `<option value="">Choose a book…</option>`;
  for (const b of books) {
    bookChapters[b.book] = b.chapters;
    const o = document.createElement("option");
    o.value = b.book; o.textContent = b.book;
    sel.appendChild(o);
  }
  $("browse-chapters").innerHTML = "";
  $("browse-verses").innerHTML = "";
}

function renderChapterGrid(book) {
  const wrap = $("browse-chapters");
  $("browse-verses").innerHTML = "";
  if (!book) { wrap.innerHTML = ""; return; }
  const n = bookChapters[book] || 0;
  let html = `<span class="grid-label">Chapter</span>`;
  for (let c = 1; c <= n; c++) html += `<div class="pick" data-ch="${c}">${c}</div>`;
  wrap.innerHTML = html;
  wrap.querySelectorAll(".pick").forEach((el) => {
    el.onclick = () => {
      wrap.querySelectorAll(".pick").forEach((p) => p.classList.remove("active"));
      el.classList.add("active");
      openBrowseChapter(book, parseInt(el.dataset.ch, 10));
    };
  });
}

async function openBrowseChapter(book, chapter) {
  const data = await api(`/api/bible/chapter?translation=${version()}&book=${encodeURIComponent(book)}&chapter=${chapter}`);
  if (!data.ok) return;
  browseChapterVerses = data.verses;
  const wrap = $("browse-verses");
  let html = `<span class="grid-label">Verse</span><div class="pick" data-v="all">All</div>`;
  for (const v of data.verses) html += `<div class="pick" data-v="${v.verse}">${v.verse}</div>`;
  wrap.innerHTML = html;
  wrap.querySelectorAll(".pick").forEach((el) => {
    el.onclick = () => {
      wrap.querySelectorAll(".pick").forEach((p) => p.classList.remove("active"));
      el.classList.add("active");
      if (el.dataset.v === "all") {
        lastLookup = { ok: true, reference: `${data.book} ${chapter}`, translation: data.translation,
          book: data.book, chapter, start: data.verses[0].verse, end: data.verses.at(-1).verse, verses: data.verses };
      } else {
        const v = browseChapterVerses.find((x) => x.verse === parseInt(el.dataset.v, 10));
        lastLookup = { ok: true, reference: v.ref, translation: data.translation,
          book: data.book, chapter, start: v.verse, end: v.verse, verses: [v] };
      }
      pushRecent(lastLookup.reference, lastLookup.translation);
      renderPassage(lastLookup);
    };
  });
}

// --- Quick: presets + recents ---
function renderPresets() {
  $("quick-presets").innerHTML = PRESETS.map((r) => `<span class="chip" data-ref="${esc(r)}">${esc(r)}</span>`).join("");
  $("quick-presets").querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => bibleLookup(el.dataset.ref);
  });
}
function getRecents() {
  try { return JSON.parse(localStorage.getItem("smi_recents") || "[]"); } catch { return []; }
}
function pushRecent(reference, translation) {
  let r = getRecents().filter((x) => x.reference !== reference);
  r.unshift({ reference, translation });
  localStorage.setItem("smi_recents", JSON.stringify(r.slice(0, 12)));
  renderRecents();
}
function renderRecents() {
  const recents = getRecents();
  const wrap = $("quick-recents");
  if (!recents.length) { wrap.innerHTML = `<span class="hint">No recent lookups yet.</span>`; return; }
  wrap.innerHTML = recents.map((x) =>
    `<span class="chip" data-ref="${esc(x.reference)}" data-v="${esc(x.translation)}">${esc(x.reference)}</span>`).join("");
  wrap.querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      if (offlineCodes.includes(el.dataset.v)) $("bible-version").value = el.dataset.v;
      bibleLookup(el.dataset.ref);
    };
  });
}

// Scripture editing: pick reference / version / verses-per-slide, AND optionally
// edit the wording of each slide directly.
function openScriptureEditor(item) {
  const m = item.title.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  const ref0 = m ? m[1] : item.title;
  const ver0 = m ? m[2] : version();
  const verOpts = offlineCodes.map((c) => `<option value="${c}" ${c === ver0 ? "selected" : ""}>${c}</option>`).join("");
  openModal("Edit scripture", `
    <label class="mini-label">Reference</label>
    <input id="se-ref" class="field" value="${esc(ref0)}">
    <div class="row gap two">
      <div class="grow"><label class="mini-label">Version</label><select id="se-ver" class="field">${verOpts}</select></div>
      <div><label class="mini-label">Verses / slide</label>
        <select id="se-vps" class="field"><option value="1">1</option><option value="2">2</option><option value="all">Whole</option></select></div>
    </div>
    <button id="se-reload" class="btn full">Reload from Bible</button>
    <label class="mini-label" style="margin-top:10px">Slides — edit the wording if you like</label>
    <div id="se-slides"></div>
    ${styleSectionHtml(item.style)}
    <div class="row gap" style="margin-top:10px">
      <button id="se-save" class="btn primary grow">Save changes</button>
      <button id="se-cancel" class="btn grow">Cancel</button>
    </div>`);
  let slides = (item.slides || []).map((s) => ({ ...s }));   // start from existing
  wireStyleSection();
  $("se-cancel").onclick = closeModal;

  function renderSlides() {
    $("se-slides").innerHTML = slides.map((sl, i) => `
      <label class="mini-label">${esc(sl.ref || "verse " + (i + 1))}</label>
      <textarea class="field mono se-slide" rows="3" data-i="${i}">${esc(sl.text)}</textarea>`).join("")
      || `<p class="hint">No slides — reload from the Bible.</p>`;
  }
  function collect() {
    document.querySelectorAll(".se-slide").forEach((ta) => { slides[+ta.dataset.i].text = ta.value; });
  }
  $("se-reload").onclick = async () => {
    const ref = $("se-ref").value.trim(), ver = $("se-ver").value, per = $("se-vps").value;
    const d = await api(`/api/bible/lookup?ref=${encodeURIComponent(ref)}&translation=${ver}`);
    if (!d.ok) { alert(d.error || "Reference not found."); return; }
    slides = buildSlides(d.verses, d.translation, per);
    renderSlides();
  };
  $("se-save").onclick = async () => {
    collect();
    if (!slides.length) return alert("Nothing to save.");
    const ref = $("se-ref").value.trim(), ver = $("se-ver").value;
    await fetch(`/api/playlist/items/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${ref} (${ver})`, slides, style: readStyleSection(), set_style: true }),
    });
    closeModal();
    await loadPlaylist();
  };
  renderSlides();
}
