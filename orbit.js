// This turntable uses views of the same modeled object under fixed studio lights.
// Only angles near the current gesture are downloaded and held in memory.
const frameCount = 72;
const degreesPerFrame = 360 / frameCount;
const assets = new URL("./assets/orbit/", import.meta.url);

function mountTurntable(stage) {
  const readout = stage.closest("figure")?.querySelector("[data-angle]");
  const cache = new Map();
  const loading = new Set();
  const failed = new Set();
  const wrap = value => ((value % frameCount) + frameCount) % frameCount;

  let angle = 0;
  let target = 0;
  let visible = 0;
  let activeImage = null;
  let direction = 1;
  let pointer = null;
  let startX = 0;
  let startAngle = 0;

  function show(index) {
    if (index === visible) return;
    const image = cache.get(index);
    if (index && !image) return;
    if (image) stage.append(image);
    activeImage?.remove();
    activeImage = image ?? null;
    visible = index;
    stage.classList.toggle("orbit-turned", index !== 0);
    if (readout) readout.textContent = String(index * degreesPerFrame).padStart(3, "0") + "°";
  }

  function trimCache() {
    // Keep the displayed frame and its immediate neighborhood, even across 0°.
    if (cache.size <= 13) return;
    const distance = index => Math.min(wrap(index - target), wrap(target - index));
    const keys = [...cache.keys()].filter(index => index !== visible);
    keys.sort((a, b) => distance(b) - distance(a));
    for (const index of keys) {
      if (cache.size <= 13) break;
      cache.delete(index);
    }
  }

  function pump() {
    const nearby = [0, direction, -direction, 2 * direction, -2 * direction];
    for (const offset of nearby) {
      if (loading.size >= 3) break;
      const index = wrap(target + offset);
      if (!index || loading.has(index) || cache.has(index) || failed.has(index)) continue;
      loading.add(index);
      const image = new Image();
      image.className = "orbit-turn-frame";
      image.draggable = false;
      image.alt = "";
      image.onload = () => {
        loading.delete(index);
        cache.set(index, image);
        if (index === target) show(index);
        trimCache();
        pump();
      };
      image.onerror = () => {
        loading.delete(index);
        failed.add(index);
        pump();
      };
      image.src = new URL(`angle-${String(index).padStart(2, "0")}.webp`, assets).href;
    }
  }

  function turn(next) {
    if (next !== angle) direction = Math.sign(next - angle);
    angle = next;
    target = wrap(Math.round(angle / degreesPerFrame));
    show(target);
    pump();
  }

  stage.addEventListener("pointerenter", pump);
  stage.addEventListener("focus", pump);
  stage.addEventListener("pointerdown", event => {
    if (pointer !== null || event.button !== 0 || !event.isPrimary) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startAngle = angle;
    stage.setPointerCapture(pointer);
    stage.classList.add("orbit-dragging");
    pump();
  });
  stage.addEventListener("pointermove", event => {
    if (event.pointerId !== pointer) return;
    const travel = event.clientX - startX;
    const width = Math.max(stage.clientWidth, 160);
    turn(startAngle + 280 * travel / width);
  });

  function endGesture(event) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    stage.classList.remove("orbit-dragging");
  }
  stage.addEventListener("lostpointercapture", endGesture);
  stage.addEventListener("pointerup", endGesture);
  stage.addEventListener("pointercancel", endGesture);
  stage.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") turn(angle - degreesPerFrame);
    else if (event.key === "ArrowRight") turn(angle + degreesPerFrame);
    else if (event.key === "Home") turn(0);
    else return;
    event.preventDefault();
  });
}

const stage = document.querySelector("[data-orbit]");
if (stage) mountTurntable(stage);
