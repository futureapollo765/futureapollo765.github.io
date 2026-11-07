import { createOrbitFilm } from "./assets/orbit/film.js";

const assets = new URL("./assets/orbit/", import.meta.url);
const wrap = angle => ((angle % 360) + 360) % 360;

// Reduced-data visits and browsers without WebGL can still turn the model.
// Keep a small neighborhood around the requested angle, including across 0°.
function createStillFrames(stage, onFrame, active) {
  let target = 0;
  let visible = 0;
  let mounted = null;
  const loaded = new Map();
  const loading = new Set();
  const failed = new Set();
  function show() {
    const image = loaded.get(target);
    if (target === visible || (target && !image)) return;
    if (image) stage.append(image);
    mounted?.remove();
    mounted = image ?? null;
    visible = target;
    stage.classList.toggle("orbit-turned", target !== 0);
    onFrame(target * 5);
  }
  function pump() {
    if (!active()) return;
    show();
    for (const offset of [0, 1, -1, 2, -2]) {
      if (loading.size >= 3) break;
      const index = (target + offset + 72) % 72;
      if (!index || loaded.has(index) || loading.has(index) || failed.has(index)) continue;
      loading.add(index);
      const image = new Image();
      image.alt = "";
      image.draggable = false;
      image.className = "orbit-turn-frame";
      image.onload = () => {
        loading.delete(index);
        loaded.set(index, image);
        if (loaded.size > 13) {
          const keys = [...loaded.keys()].filter(key => key !== visible && key !== target);
          const distance = key => Math.min((72 + key - target) % 72, (72 + target - key) % 72);
          keys.sort((a, b) => distance(b) - distance(a));
          loaded.delete(keys[0]);
        }
        pump();
      };
      image.onerror = () => { loading.delete(index); failed.add(index); pump(); };
      image.src = new URL(`angle-${String(index).padStart(2, "0")}.webp`, assets).href;
    }
  }
  return angle => { target = Math.round(wrap(angle) / 5) % 72; pump(); };
}

function mountTurntable(stage) {
  const readout = stage.closest("figure")?.querySelector("[data-angle]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const reduceData = matchMedia("(prefers-reduced-data: reduce)");
  const connection = navigator.connection;
  let requested = !document.documentElement.classList.contains("motion-paused");
  let enabled = false;
  let onscreen = false;
  let angle = 0;
  let progress = 0;
  let film = null;
  let ready = false;
  let filmFailed = false;
  let seeking = false;
  let pointer = null;
  let pointerX = 0;
  let pointerAngle = 0;
  let idleDelay = 0;
  let fallbackTick = 0;
  const visible = () => onscreen && !document.hidden;
  const setReadout = degrees => {
    if (readout) readout.textContent = String(Math.round(wrap(degrees)) % 360).padStart(3, "0") + "°";
  };
  const showStill = createStillFrames(stage, setReadout, () => visible() && !ready);

  function onFilmFrame(time) {
    if (!film || !visible()) return;
    const degrees = wrap(time / film.video.duration * 360);
    if (!Number.isFinite(degrees)) return;
    if (!seeking) angle = degrees;
    stage.classList.add("orbit-filmed");
    setReadout(degrees);
  }

  function failFilm() {
    if (filmFailed) return;
    filmFailed = true;
    ready = false;
    const broken = film;
    film = null;
    broken?.dispose();
    stage.classList.remove("orbit-filmed");
    if (visible()) showStill(angle);
    reconcile();
  }

  function prepareFilm() {
    if (film || filmFailed) return;
    film = createOrbitFilm(stage, onFilmFrame, failFilm);
    if (!film) { filmFailed = true; return; }
    const video = film.video;
    video.addEventListener("loadeddata", () => {
      if (!film) return;
      ready = true;
      seeking = true;
      applySeek();
      reconcile();
    }, { once: true });
    video.addEventListener("seeked", () => { applySeek(); reconcile(); });
    video.preload = "auto";
    video.src = new URL("turntable.mp4", assets).href;
  }

  // Coalesce drag and scroll updates while the decoder is seeking. Preserve the
  // latest control angle and resume playback from that exact point on release.
  function applySeek() {
    if (!ready || !seeking || !visible() || film.video.seeking) return;
    const video = film.video;
    const target = Math.min(angle / 360 * video.duration, video.duration - 1 / 24);
    if (Math.abs(video.currentTime - target) > .02) {
      video.currentTime = target;
      return;
    }
    seeking = false;
    film.draw(video.currentTime);
  }

  function reconcile() {
    clearInterval(fallbackTick);
    fallbackTick = 0;
    if (!visible()) { film?.pause(); return; }
    if (enabled && !filmFailed) prepareFilm();
    if (seeking) applySeek();
    const moving = enabled && pointer === null && !idleDelay && !seeking;
    if (moving && ready) film.play();
    else film?.pause();
    if (moving && filmFailed) {
      fallbackTick = setInterval(() => { angle = wrap(angle + 5); showStill(angle); }, 208);
    }
  }

  function setAngle(next) {
    angle = wrap(next);
    film?.pause();
    seeking = ready;
    if (ready) applySeek();
    else showStill(angle);
  }

  function deferIdle(delay) {
    clearInterval(fallbackTick);
    clearTimeout(idleDelay);
    idleDelay = setTimeout(() => { idleDelay = 0; reconcile(); }, delay);
  }

  function clearLight() {
    stage.style.removeProperty("--orbit-x");
    stage.style.removeProperty("--orbit-y");
    stage.style.removeProperty("--orbit-rx");
    stage.style.removeProperty("--orbit-ry");
    film?.light(.5, .5, 0);
    if (ready && visible() && film.video.paused && !seeking) film.draw(film.video.currentTime);
  }

  function updatePreference() {
    const savingData = reduceData.matches || Boolean(connection?.saveData);
    enabled = requested && !reduce.matches && !savingData;
    stage.dataset.motion = enabled ? "playing" : "paused";
    stage.dispatchEvent(new CustomEvent("orbitmotionstate", {
      detail: { enabled, reduced: reduce.matches, savingData },
    }));
    if (!enabled) clearLight();
    reconcile();
  }

  stage.addEventListener("orbitmotion", event => {
    requested = event.detail === true;
    updatePreference();
  });
  stage.addEventListener("orbitprogress", event => {
    if (!Number.isFinite(event.detail)) return;
    const next = Math.max(0, Math.min(1, event.detail));
    const delta = next - progress;
    progress = next;
    if (!delta || !enabled || pointer !== null || !visible()) return;
    deferIdle(160);
    setAngle(angle + delta * 220);
  });

  stage.addEventListener("pointerdown", event => {
    if (pointer !== null || event.button !== 0 || !event.isPrimary) return;
    pointer = event.pointerId;
    pointerX = event.clientX;
    pointerAngle = angle;
    stage.setPointerCapture(pointer);
    stage.classList.add("orbit-dragging");
    reconcile();
  });
  stage.addEventListener("pointermove", event => {
    if (event.pointerId === pointer) {
      setAngle(pointerAngle + (event.clientX - pointerX) * 280 / Math.max(stage.clientWidth, 160));
    }
    if (!enabled || event.pointerType === "touch") return;
    const bounds = stage.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    stage.style.setProperty("--orbit-x", `${x * 12}px`);
    stage.style.setProperty("--orbit-y", `${y * 9}px`);
    stage.style.setProperty("--orbit-rx", `${-y * 4}deg`);
    stage.style.setProperty("--orbit-ry", `${x * 6}deg`);
    film?.light((x + 1) / 2, (y + 1) / 2, 1);
  });
  stage.addEventListener("pointerleave", clearLight);
  function endGesture(event) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    stage.classList.remove("orbit-dragging");
    deferIdle(280);
  }
  for (const name of ["lostpointercapture", "pointerup", "pointercancel"]) {
    stage.addEventListener(name, endGesture);
  }
  stage.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    if (event.key === "ArrowLeft") next = angle - 5;
    else if (event.key === "ArrowRight") next = angle + 5;
    else if (event.key === "Home") next = 0;
    else return;
    event.preventDefault();
    deferIdle(850);
    setAngle(next);
  });

  new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    reconcile();
  }).observe(stage);
  document.addEventListener("visibilitychange", reconcile);
  reduce.addEventListener("change", updatePreference);
  reduceData.addEventListener("change", updatePreference);
  connection?.addEventListener("change", updatePreference);
  updatePreference();
}

const stage = document.querySelector("[data-orbit]");
if (stage) mountTurntable(stage);
