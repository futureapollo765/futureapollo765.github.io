// A fixed sight and a moving grid provide a reference as the camera travels.
export function mountMapSurface(viewport) {
  const ground = document.createElement("div");
  ground.className = "map-ground";
  ground.setAttribute("aria-hidden", "true");
  ground.innerHTML = '<i class="map-grid"></i><i class="map-light"></i>';
  viewport.prepend(ground);

  const instrument = document.createElement("div");
  instrument.className = "map-instrument";
  instrument.setAttribute("aria-hidden", "true");
  instrument.innerHTML = '<i class="map-edge-x"></i><i class="map-edge-y"></i><i class="map-pointer"></i>';
  viewport.append(instrument);

  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let point = null;
  let frame = 0;

  function placePointer() {
    frame = 0;
    if (!point) return;
    const bounds = viewport.getBoundingClientRect();
    viewport.style.setProperty("--map-pointer-x", (point.x - bounds.left) + "px");
    viewport.style.setProperty("--map-pointer-y", (point.y - bounds.top) + "px");
    viewport.dataset.pointerIntent = point.overTile ? "open" : "pan";
  }

  function clearPointer() {
    point = null;
    cancelAnimationFrame(frame);
    frame = 0;
    delete viewport.dataset.pointerIntent;
  }

  viewport.addEventListener("pointermove", event => {
    if (event.pointerType === "touch" || !fine.matches || reduce.matches ||
        document.documentElement.classList.contains("motion-paused")) {
      clearPointer();
      return;
    }
    point = { x: event.clientX, y: event.clientY, overTile: !!event.target.closest(".projects-tile") };
    if (!frame) frame = requestAnimationFrame(placePointer);
  }, { passive: true });
  viewport.addEventListener("pointerleave", clearPointer);
  viewport.addEventListener("pointercancel", clearPointer);
  window.addEventListener("hashchange", clearPointer);
  window.addEventListener("studio-motion", event => { if (!event.detail) clearPointer(); });
  reduce.addEventListener("change", clearPointer);

  return {
    update(x, y, stepX, stepY) {
      if (!stepX || !stepY) return;
      // Keep positions bounded even after travelling many thousands of cells.
      ground.style.setProperty("--grid-step-x", stepX + "px");
      ground.style.setProperty("--grid-step-y", stepY + "px");
      ground.style.setProperty("--grid-x", (-(x % 1) * stepX) + "px");
      ground.style.setProperty("--grid-y", (-(y % 1) * stepY) + "px");
      // The smaller dots belong to a slower, more distant plane.
      ground.style.setProperty("--dots-x", (-((x * .72) % .1) * stepX) + "px");
      ground.style.setProperty("--dots-y", (-((y * .72) % .1) * stepY) + "px");
    }
  };
}
