// Shared read-only render for a "design" slide (bg + elements). Used by the
// Presentation Designer's own preview panes (template picker, slide thumbnails),
// the projector output (live.js), and the stage/confidence monitor (stage.js) —
// one implementation so all three always render a design identically.
//
// opts:
//   playVideo  - actually call .play() on <video> elements (default true)
//   animate    - apply the element's dz-anim-* entrance animation (default true)
//   muteAll    - force every element video muted, regardless of its own setting
//                (used by the stage monitor, which must never play sound)
//   bgVideo    - render the slide's background video (default true)

function designBgVideo(canvas, src) {
  const v = document.createElement("video");
  v.src = src; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
  v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;";
  canvas.appendChild(v);
  v.play && v.play().catch(() => {});
}

function designAnimClass(el) {
  return (el.anim && el.anim !== "none") ? " dz-anim-" + el.anim : "";
}

function designRender(canvas, design, heightPx, opts = {}) {
  const { playVideo = true, animate = true, muteAll = false, bgVideo = true } = opts;
  const bg = (design && design.bg) || {};
  canvas.style.background = bg.color || "#000";
  canvas.style.backgroundImage = bg.image ? `url("${bg.image}")` : "";
  canvas.style.backgroundSize = "cover";
  canvas.style.backgroundPosition = "center";
  canvas.innerHTML = "";
  if (bg.video && bgVideo) designBgVideo(canvas, bg.video);
  for (const el of ((design && design.elements) || [])) {
    const d = document.createElement("div");
    d.className = animate ? designAnimClass(el).trim() : "";
    d.style.cssText = `position:absolute;left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%;`;
    if (el.type === "text") {
      d.style.display = "flex";
      d.style.alignItems = el.valign === "top" ? "flex-start" : el.valign === "bottom" ? "flex-end" : "center";
      d.style.justifyContent = el.align === "left" ? "flex-start" : el.align === "right" ? "flex-end" : "center";
      const span = document.createElement("div");
      span.textContent = el.text || "";
      span.style.cssText = `font-family:${el.font};font-size:${(el.size || 8) / 100 * heightPx}px;color:${el.color};font-weight:${el.bold ? 800 : 400};font-style:${el.italic ? "italic" : "normal"};text-align:${el.align};line-height:1.2;white-space:pre-wrap;width:100%;${el.shadow ? "text-shadow:0 2px 14px rgba(0,0,0,.6);" : ""}`;
      d.appendChild(span);
    } else if (el.type === "image" && el.src) {
      const img = document.createElement("img");
      img.src = el.src; img.style.cssText = `width:100%;height:100%;object-fit:${el.fit || "contain"};`;
      d.appendChild(img);
    } else if (el.type === "video" && el.src) {
      const v = document.createElement("video");
      v.src = el.src; v.loop = el.loop !== false; v.muted = muteAll || el.muted !== false; v.autoplay = true; v.playsInline = true;
      v.style.cssText = `width:100%;height:100%;object-fit:${el.fit || "cover"};`;
      d.appendChild(v);
      if (playVideo) v.play().catch(() => {});
    } else if (el.type === "shape") {
      d.style.background = el.color || "#22d3ee";
      d.style.borderRadius = el.shape === "ellipse" ? "50%" : ((el.radius || 0) + "px");
    }
    canvas.appendChild(d);
  }
}
