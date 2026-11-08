import { recordedIntroStarted } from "./loader.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const markURL = new URL("./assets/studio.svg", import.meta.url);
const covered = "inset(0% 0 0% 0)";
const below = "inset(100% 0 0% 0)";
const above = "inset(0% 0 100% 0)";

let paintedKey = null;
let pending = null;
let cover = null;
let animation = null;
let phase = "idle";

function allowsMotion() {
  return !document.hidden && !reduceMotion.matches &&
    !document.documentElement.classList.contains("motion-paused") &&
    typeof Element.prototype.animate === "function";
}

function front() {
  // A freshly opened player is a native modal. A non-focusable manual popover
  // can paint above it while the new dialog keeps keyboard focus throughout.
  if (!cover?.showPopover) return;
  if (cover.matches(":popover-open")) cover.hidePopover();
  cover.showPopover();
}

function ensureCover() {
  if (cover) return;
  cover = document.createElement("div");
  cover.className = "studio-route-cover";
  cover.setAttribute("aria-hidden", "true");
  if (cover.showPopover) cover.setAttribute("popover", "manual");
  const logo = new Image();
  logo.className = "studio-route-mark";
  logo.alt = "";
  logo.draggable = false;
  logo.src = markURL;
  cover.append(logo);
  document.body.append(cover);
  front();
}

function clearCover() {
  animation?.cancel();
  animation = null;
  cover?.remove();
  cover = null;
  phase = "idle";
}

function paint(request) {
  if (!request || request.hash !== location.hash) return;
  paintedKey = request.key;
  request.render();
}

function settle(request = pending) {
  pending = null;
  clearCover();
  paint(request);
}

function playClip(frames, duration, next) {
  animation?.cancel();
  const clip = cover.animate(frames, { duration, fill: "both", easing: "cubic-bezier(.45,0,.2,1)" });
  animation = clip;
  clip.onfinish = () => {
    if (animation !== clip) return;
    // Pin the final clip while changing the underlying view and animation.
    cover.style.clipPath = frames.at(-1).clipPath;
    animation = null;
    clip.cancel();
    next();
  };
}

function reveal(start = covered, direct = false) {
  phase = "revealing";
  const frames = [{ clipPath: start }];
  if (start === covered) frames.push({ clipPath: covered, offset: direct ? .33 : .23 });
  frames.push({ clipPath: above });
  playClip(frames, direct ? 290 : 235, clearCover);
}

/**
 * Keep the latest route request during a wipe. Routes with the same visual
 * identity (including opening and closing its player) render immediately.
 */
export function presentRoute(key, render, sharedPhoto = false) {
  const request = { key, render, hash: location.hash };
  if (!allowsMotion()) {
    try { settle(request); }
    finally { window.studioBoot?.release(); }
    return;
  }

  if (paintedKey === null) {
    // An intro already owns its modal. If the early cover was skipped or
    // timed out, render directly rather than flashing a late black layer.
    if (recordedIntroStarted || !window.studioBoot?.pending) { paint(request); return; }
    try {
      ensureCover();
      paint(request);
      if (document.querySelector("dialog[open]")) front();
      reveal(covered, true);
    } catch (error) {
      clearCover();
      throw error;
    } finally {
      window.studioBoot?.release();
    }
    return;
  }

  if (key === paintedKey || sharedPhoto) {
    pending = null;
    // Back to the still-visible view, an anchor, or a modal-only change.
    // Drop an interrupted wipe so the destination is usable immediately.
    clearCover();
    paint(request);
    return;
  }

  pending = request;
  if (phase === "covering") return;
  const start = cover ? getComputedStyle(cover).clipPath : below;
  ensureCover();
  phase = "covering";
  playClip([{ clipPath: start }, { clipPath: covered }], 145, () => {
    const latest = pending;
    pending = null;
    try {
      paint(latest);
      if (document.querySelector("dialog[open]")) front();
      reveal();
    } catch (error) {
      clearCover();
      throw error;
    }
  });
}

reduceMotion.addEventListener("change", () => { if (reduceMotion.matches) settle(); });
window.addEventListener("studio-motion", event => { if (!event.detail) settle(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); });
window.addEventListener("pagehide", () => settle());
