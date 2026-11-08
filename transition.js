import { recordedIntroStarted } from "./loader.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const markURL = new URL("./assets/studio.svg", import.meta.url);
const covered = "inset(0% 0 0% 0)";
const below = "inset(100% 0 0% 0)";
const above = "inset(0% 0 100% 0)";
const minimumVisibleDuration = 1000;
const turnDuration = 900;

let paintedKey = null;
let pending = null;
let run = null;
let phase = "idle";

function allowsMotion() {
  return !document.hidden && !reduceMotion.matches &&
    !document.documentElement.classList.contains("motion-paused") &&
    typeof Element.prototype.animate === "function";
}

function current(owner) {
  return run === owner && !owner.events.signal.aborted;
}

function front(owner) {
  // The cover can sit above a newly opened player without taking its focus.
  const cover = owner.cover;
  if (!cover.showPopover) return;
  if (cover.matches(":popover-open")) cover.hidePopover();
  cover.showPopover();
}

function cancel(owner) {
  owner.events.abort();
  owner.clip?.cancel();
  owner.turn?.cancel();
}

function clearCover() {
  const owner = run;
  run = null;
  if (owner) { cancel(owner); owner.cover.remove(); }
  phase = "idle";
}

function createCover(start = covered) {
  let cover = run?.cover, logo = run?.logo, angle = -90;
  if (run) {
    // A navigation during reveal continues from the visible angle rather
    // than snapping the same mark back to the beginning of its quarter turn.
    const matrix = new DOMMatrixReadOnly(getComputedStyle(logo).transform);
    angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    cancel(run);
  } else {
    cover = document.createElement("div");
    cover.className = "studio-route-cover";
    cover.setAttribute("aria-hidden", "true");
    if (cover.showPopover) cover.setAttribute("popover", "manual");
    logo = new Image();
    logo.className = "studio-route-mark";
    logo.alt = "";
    logo.draggable = false;
    logo.src = markURL;
    cover.append(logo);
    document.body.append(cover);
  }
  logo.style.transform = `rotate(${angle}deg)`;
  cover.style.clipPath = start;
  const owner = run = { cover, logo, angle, events:new AbortController(), clip:null, turn:null };
  front(owner);
  return owner;
}

function paint(request) {
  if (!request || request.hash !== location.hash) return;
  paintedKey = request.key;
  request.render();
}

function paintPending(owner) {
  const latest = pending;
  pending = null;
  paint(latest);
  if (current(owner) && document.querySelector("dialog[open]")) front(owner);
}

function settle(request = pending) {
  pending = null;
  clearCover();
  try { paint(request); }
  finally { window.studioBoot?.release(); }
}

function wait(owner, duration) {
  return new Promise(resolve => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      owner.events.signal.removeEventListener("abort", finish);
      resolve(current(owner));
    };
    owner.events.signal.addEventListener("abort", finish, {once:true});
    timer = setTimeout(finish, duration);
  });
}

function painted(owner) {
  return new Promise(resolve => {
    let frame, remaining = 2;
    const finish = () => {
      cancelAnimationFrame(frame);
      owner.events.signal.removeEventListener("abort", finish);
      resolve(current(owner));
    };
    const next = () => {
      if (!current(owner) || --remaining === 0) finish();
      else frame = requestAnimationFrame(next);
    };
    owner.events.signal.addEventListener("abort", finish, {once:true});
    frame = requestAnimationFrame(next);
  });
}

function decoded(owner) {
  return new Promise(resolve => {
    const {logo} = owner;
    let finished = false;
    const finish = success => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      logo.removeEventListener("load", loaded);
      logo.removeEventListener("error", failed);
      owner.events.signal.removeEventListener("abort", failed);
      resolve(success && current(owner));
    };
    const loaded = () => {
      if (logo.decode) logo.decode().then(() => finish(true), () => finish(logo.naturalWidth > 0));
      else finish(logo.naturalWidth > 0);
    };
    const failed = () => finish(false);
    // A missing image must not leave a black route cover indefinitely. Its
    // late load remains hidden rather than appearing halfway through a turn.
    const timer = setTimeout(failed, 1500);
    logo.addEventListener("load", loaded, {once:true});
    logo.addEventListener("error", failed, {once:true});
    owner.events.signal.addEventListener("abort", failed, {once:true});
    if (logo.complete) logo.naturalWidth ? loaded() : failed();
  });
}

function playClip(owner, frames, duration, next) {
  owner.clip?.cancel();
  const clip = owner.cover.animate(frames, { duration, fill:"both", easing:"cubic-bezier(.45,0,.2,1)" });
  owner.clip = clip;
  clip.onfinish = () => {
    if (!current(owner) || owner.clip !== clip) return;
    owner.cover.style.clipPath = frames.at(-1).clipPath;
    owner.clip = null;
    clip.cancel();
    next();
  };
}

async function hold(owner) {
  if (!current(owner)) return;
  phase = "holding";
  try {
    paintPending(owner);
    const ready = await decoded(owner);
    if (!current(owner)) return;
    owner.logo.style.opacity = ready ? "1" : "0";
    // Decode and heavy route rendering both finish before the first visible
    // logo frame. Only then start the original angle and the minimum clock.
    if (!await painted(owner)) return;
    if (ready) owner.turn = owner.logo.animate([
      {transform:`rotate(${owner.angle}deg)`},
      {transform:`rotate(${owner.angle + 90}deg)`},
    ], {duration:turnDuration, fill:"forwards", easing:"cubic-bezier(.23,.62,.2,1)"});
    if (!await wait(owner, minimumVisibleDuration)) return;
    // Requests made during the hold replace one pending destination. Render
    // the latest while covered and let its layout paint before revealing it.
    do {
      paintPending(owner);
      if (!await painted(owner)) return;
    } while (pending);
    phase = "revealing";
    playClip(owner, [{clipPath:covered}, {clipPath:above}], 235, clearCover);
  } catch (error) {
    if (current(owner)) settle();
    console.error("Route transition failed", error);
  }
}

/** Keep one latest request; shared photographs and modal-only changes stay immediate. */
export function presentRoute(key, render, sharedPhoto = false) {
  const request = {key, render, hash:location.hash};
  if (!allowsMotion()) { settle(request); return; }

  if (paintedKey === null) {
    // Only an existing early cover can hand off to an initial route wipe.
    // A failed/late bootstrap must never flash a new black layer over Home.
    if (recordedIntroStarted || !window.studioBoot?.pending) { paint(request); return; }
    pending = request;
    let owner;
    try {
      // Keep the early cover until this fully covered layer and route exist.
      owner = createCover();
      paintPending(owner);
    } catch (error) {
      clearCover();
      throw error;
    } finally {
      window.studioBoot?.release();
    }
    void hold(owner);
    return;
  }

  if (key === paintedKey || sharedPhoto) { settle(request); return; }
  pending = request;
  if (phase === "covering" || phase === "holding") return;
  const start = run ? getComputedStyle(run.cover).clipPath : below;
  const owner = createCover(start);
  phase = "covering";
  playClip(owner, [{clipPath:start}, {clipPath:covered}], 145, () => { void hold(owner); });
}

reduceMotion.addEventListener("change", () => { if (reduceMotion.matches) settle(); });
window.addEventListener("studio-motion", event => { if (!event.detail) settle(); });
window.addEventListener("keydown", event => { if (event.key === "Escape" && run) settle(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); });
window.addEventListener("pagehide", () => settle());
