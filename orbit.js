import { createOrbitRenderer } from "./assets/orbit/renderer.js";

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
    if (target === visible) { onFrame(target * 5); return; }
    if (target && !image) return;
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
  const instrument = stage.closest("figure");
  const readout = instrument?.querySelector("[data-angle]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const reduceData = matchMedia("(prefers-reduced-data: reduce)");
  const connection = navigator.connection;
  let requested = !document.documentElement.classList.contains("motion-paused");
  let enabled = false;
  let onscreen = false;
  let angle = 0;
  let progress = 0;
  let renderer = null;
  let preparation = null;
  let rendererFailed = false;
  let drawFrame = 0;
  let lastTime = null;
  let dirty = true;
  let needsResize = true;
  const light = new Float32Array([.5, .5, 0]);
  let gesture = null;
  let coastFrame = 0;
  let inspectingWithKeys = false;
  let displayedAngle = 0;
  let idleDelay = 0;
  let fallbackTick = 0;
  const visible = () => onscreen && !document.hidden && !instrument?.inert && !instrument?.hidden;
  const setReadout = degrees => {
    displayedAngle = wrap(degrees);
    const value = String(Math.round(displayedAngle) % 360).padStart(3, "0") + "°";
    if (readout && readout.textContent !== value) readout.textContent = value;
  };
  const showStill = createStillFrames(stage, degrees => {
    stage.classList.remove("orbit-rendered");
    setReadout(degrees);
  }, () => visible() && !renderer);

  function stopDrawing() {
    cancelAnimationFrame(drawFrame);
    drawFrame = 0;
    lastTime = null;
  }

  function failRenderer() {
    stopDrawing();
    rendererFailed = true;
    renderer?.dispose();
    renderer = null;
    stage.dataset.engine = "stills";
    stage.classList.remove("orbit-rendered");
    if (visible()) showStill(angle);
    reconcile();
  }

  async function prepareRenderer() {
    if (renderer || preparation || rendererFailed) return;
    const controller = new AbortController();
    preparation = controller;
    try {
      const prepared = await createOrbitRenderer(stage, failRenderer, controller.signal);
      if (controller.signal.aborted) { prepared.dispose(); return; }
      renderer = prepared;
      stage.dataset.engine = "geometry";
      dirty = true;
    } catch {
      if (!controller.signal.aborted) failRenderer();
    } finally {
      preparation = null;
      reconcile();
    }
  }

  function ambient() {
    return enabled && !gesture && !coastFrame && !inspectingWithKeys && !idleDelay;
  }

  function draw(now) {
    drawFrame = 0;
    if (!visible() || !renderer) { lastTime = null; return; }
    if (needsResize) { renderer.resize(); needsResize = false; }
    const moving = ambient();
    if (moving && lastTime !== null) angle = wrap(angle + Math.min(now - lastTime, 70) * .024);
    lastTime = moving ? now : null;
    if (moving || dirty) {
      renderer.draw(angle, light);
      stage.classList.add("orbit-rendered");
      setReadout(angle);
      dirty = false;
    }
    if (moving) drawFrame = requestAnimationFrame(draw);
  }

  function scheduleDraw() {
    if (visible() && renderer && !drawFrame) drawFrame = requestAnimationFrame(draw);
  }

  function reconcile() {
    clearInterval(fallbackTick);
    fallbackTick = 0;
    if (!visible()) {
      preparation?.abort();
      stopCoasting();
      clearGesture();
      clearIdle();
      inspectingWithKeys = false;
      stopDrawing();
      return;
    }
    if (enabled && !rendererFailed) void prepareRenderer();
    if (renderer) {
      if (!ambient()) lastTime = null;
      if (dirty || ambient()) scheduleDraw();
    } else if (rendererFailed && ambient()) {
      fallbackTick = setInterval(() => { angle = wrap(angle + 5); showStill(angle); }, 208);
    }
  }

  function setAngle(next) {
    angle = wrap(next);
    dirty = true;
    lastTime = null;
    if (renderer) scheduleDraw();
    else showStill(angle);
  }

  function clearIdle() {
    clearTimeout(idleDelay);
    idleDelay = 0;
  }

  function deferIdle(delay) {
    clearInterval(fallbackTick);
    clearIdle();
    if (enabled && visible()) {
      idleDelay = setTimeout(() => { idleDelay = 0; reconcile(); }, delay);
    }
  }

  function stopCoasting() {
    cancelAnimationFrame(coastFrame);
    coastFrame = 0;
  }

  function coast(velocity) {
    const speed = Math.abs(velocity);
    if (!enabled || !visible() || speed < .035) return false;
    // Friction bleeds off a fast flick over a longer arc than a slow release.
    // Integrate from the release position so dropped frames do not change the distance.
    const frictionTime = 160 + 120 * Math.min(speed / .42, 1);
    const duration = frictionTime * Math.log(speed / .014);
    const start = angle;
    const began = performance.now();
    function step(now) {
      if (!enabled || !visible()) { stopCoasting(); reconcile(); return; }
      const elapsed = Math.min(now - began, duration);
      setAngle(start + velocity * frictionTime * (1 - Math.exp(-elapsed / frictionTime)));
      if (elapsed < duration) {
        coastFrame = requestAnimationFrame(step);
      } else {
        coastFrame = 0;
        deferIdle(2800);
        reconcile();
      }
    }
    coastFrame = requestAnimationFrame(step);
    return true;
  }

  function clearLight() {
    stage.style.removeProperty("--orbit-x");
    stage.style.removeProperty("--orbit-y");
    stage.style.removeProperty("--orbit-rx");
    stage.style.removeProperty("--orbit-ry");
    light.set([.5, .5, 0]);
    dirty = true;
    scheduleDraw();
  }

  function updatePreference() {
    const savingData = reduceData.matches || Boolean(connection?.saveData);
    enabled = requested && !reduce.matches && !savingData;
    stage.dataset.motion = enabled ? "playing" : "paused";
    stage.dispatchEvent(new CustomEvent("orbitmotionstate", {
      detail: { enabled, reduced: reduce.matches, savingData },
    }));
    if (!enabled) {
      preparation?.abort();
      stopCoasting();
      clearIdle();
      clearLight();
    }
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
    if (!delta || !enabled || gesture || inspectingWithKeys || !visible()) return;
    stopCoasting();
    deferIdle(160);
    setAngle(angle + delta * 220);
  });

  function clearGesture() {
    if (!gesture) return;
    const id = gesture.id;
    gesture = null;
    stage.classList.remove("orbit-dragging");
    if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
  }

  stage.addEventListener("pointerdown", event => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    stopCoasting();
    clearIdle();
    inspectingWithKeys = false;
    // Start from the pose actually on screen, including when catching a flick.
    // Wait for horizontal intent before taking control of the pointer.
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY, start: displayedAngle,
      lastX: event.clientX, lastTime: event.timeStamp, speed: 0, dragging: false,
      degreesPerPixel: 280 / Math.max(stage.clientWidth, 160),
    };
    if (event.pointerType === "touch" && stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    setAngle(displayedAngle);
    reconcile();
  });

  window.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      const threshold = event.pointerType === "touch" ? 8 : 3;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        clearGesture();
        reconcile();
        return;
      }
      gesture.dragging = true;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("orbit-dragging");
    }
    const dt = Math.max(1, event.timeStamp - gesture.lastTime);
    const speed = (event.clientX - gesture.lastX) * gesture.degreesPerPixel / dt;
    const weight = 1 - Math.exp(-dt / 40);
    gesture.speed += (Math.max(-.48, Math.min(.48, speed)) - gesture.speed) * weight;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    setAngle(gesture.start + dx * gesture.degreesPerPixel);
  });

  stage.addEventListener("pointermove", event => {
    if (!enabled || event.pointerType === "touch") return;
    const bounds = stage.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    stage.style.setProperty("--orbit-x", `${x * 12}px`);
    stage.style.setProperty("--orbit-y", `${y * 9}px`);
    stage.style.setProperty("--orbit-rx", `${-y * 4}deg`);
    stage.style.setProperty("--orbit-ry", `${x * 6}deg`);
    light.set([(x + 1) / 2, (y + 1) / 2, 1]);
    dirty = true;
    scheduleDraw();
  });
  stage.addEventListener("pointerleave", clearLight);
  function endGesture(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const { dragging, speed, lastTime } = gesture;
    if (event.type === "lostpointercapture" && !dragging) return;
    clearGesture();
    if (event.type === "pointerup") {
      const stillFor = Math.max(0, event.timeStamp - lastTime);
      const releaseSpeed = speed * Math.exp(-stillFor / 55);
      if (dragging && coast(releaseSpeed)) return;
      deferIdle(2800);
    }
    reconcile();
  }
  window.addEventListener("pointerup", endGesture);
  window.addEventListener("pointercancel", endGesture);
  stage.addEventListener("lostpointercapture", endGesture);
  stage.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    if (event.key === "ArrowLeft") next = angle - 5;
    else if (event.key === "ArrowRight") next = angle + 5;
    else if (event.key === "Home") next = 0;
    else return;
    event.preventDefault();
    stopCoasting();
    clearGesture();
    clearIdle();
    inspectingWithKeys = true;
    setAngle(next);
    reconcile();
  });
  stage.addEventListener("blur", () => {
    if (!inspectingWithKeys) return;
    inspectingWithKeys = false;
    deferIdle(1800);
    reconcile();
  });

  new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    reconcile();
  }).observe(stage);
  if (instrument) {
    new MutationObserver(reconcile).observe(instrument, {
      attributes: true, attributeFilter: ["inert", "hidden"],
    });
  }
  new ResizeObserver(() => {
    needsResize = true;
    dirty = true;
    scheduleDraw();
  }).observe(stage);
  document.addEventListener("visibilitychange", reconcile);
  reduce.addEventListener("change", updatePreference);
  reduceData.addEventListener("change", updatePreference);
  connection?.addEventListener("change", updatePreference);
  stage.dataset.engine = "stills";
  updatePreference();
}

const stage = document.querySelector("[data-orbit]");
if (stage) mountTurntable(stage);
