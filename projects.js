import { projects } from "./project-data.js";
import { mountMapSurface } from "./map-surface.js";

const root = document.querySelector("#projects-view");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
const externalIcon = icon("M5 19 19 5M6 5h13v13");
const directions = [
  ["left", -1, 0, "M20 12H4m7-7-7 7 7 7"],
  ["up", 0, -1, "M12 20V4m-7 7 7-7 7 7"],
  ["down", 0, 1, "M12 4v16m-7-7 7 7 7-7"],
  ["right", 1, 0, "M4 12h16m-7-7 7 7-7 7"],
];
const modulo = (value, n) => ((value % n) + n) % n;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const minZoom = .65;
const maxZoom = 1.9;
const dragGain = 3;
const dragResponse = 42; // Damping rate per second.
const routeFor = (project) => `#projects/${project.id}`;
const tiles = new Map();
// Place a varied group of the studio's actual projects in the opening chunk.
// The remaining catalog is spread out so nearby tiles rarely repeat the
// consecutive covers of a single version series. The picker retains API order.
const openingIds = [
  1214545266, 953460273, 1393202928, 1388418319,
  1334587822, 1406787990, 1378633467, 1088597897,
  1317352635, 1083676575, 1294673188, 1230468572,
  1022807402, 1308628024, 926613453, 899507716,
];
const byId = new Map(projects.map((project) => [project.id, project]));
const studioPicks = openingIds.map((id) => byId.get(id)).filter(Boolean);
const otherProjects = projects.filter((project) => !openingIds.includes(project.id));
const spread = (id) => Math.imul(id ^ (id >>> 16), 2654435761) >>> 0;
const mapProjects = [...studioPicks, ...otherProjects.sort((a, b) => spread(a.id) - spread(b.id))];
const camera = { x: projects.length > 1 ? 1.55 : 0, y: projects.length > 1 ? 1.3 : 0, zoom: 1 };

let mapView, viewport, tileLayer, picker, mapStatus;
let detail, detailImage, detailTitle, playLink, sourceLink;
let dialog, playerFrame, pendingPlayer, pendingDetail;
let focusedProject, selectedId, centeredProject;
let layout, gesture, entryBounds, entryCell, selectedCell;
let surface, zoomLabel, zoomOut, zoomIn;
let aim, previousPose, pinch, returningPhoto, hoverTile, pressedTile, mapExit;
let dragSpring, detailPress;
const touches = new Map();
const drift = { x: 0, y: 0 };
let assembled = false;
let minimizing = false;
let renderFrame = 0, coastFrame = 0, statusTimer = 0;
let suppressClickUntil = 0;
let motionAllowed = !document.documentElement.classList.contains("motion-paused");

function canMove() {
  return motionAllowed && !reducedMotion.matches;
}

function visibleProjectTile(project) {
  if (!viewport || !project || mapView.hidden) return null;
  const field = viewport.getBoundingClientRect();
  const cx = field.left + field.width / 2, cy = field.top + field.height / 2;
  let best = null, bestDistance = Infinity;
  for (const tile of tiles.values()) {
    if (tile.hash !== routeFor(project)) continue;
    const box = tile.getBoundingClientRect();
    if (box.right <= field.left || box.left >= field.right || box.bottom <= field.top || box.top >= field.bottom) continue;
    const distance = Math.hypot(box.x + box.width / 2 - cx, box.y + box.height / 2 - cy);
    if (distance < bestDistance) { best = tile; bestDistance = distance; }
  }
  return best;
}

// Tell the page transition when this specific change already has a real
// thumbnail to carry between the two views.
export function hasMapPhotoFlight(nextViewKey) {
  if (root.hidden || !canMove() || !viewport) return false;
  if (nextViewKey === "projects") {
    if (!focusedProject || detail.hidden || dialog?.open) return false;
    return Boolean(selectedCell ? tiles.has(selectedCell) : mapProjects.includes(focusedProject));
  }
  if (!nextViewKey.startsWith("project/") || mapView.hidden || focusedProject) return false;
  const project = byId.get(Number(nextViewKey.slice("project/".length)));
  if (!project) return false;
  if (pendingDetail === project.id && entryBounds?.width) return true;
  return history.state?.studioMapFrom === project.id && Boolean(visibleProjectTile(project));
}

function syncMotion() {
  root.dataset.motion = canMove() ? "on" : "off";
  if (!canMove()) {
    if (dragSpring) Object.assign(camera, dragSpring.target);
    stopCoasting();
    clearLook();
    clearPress();
    clearReturnPhoto();
    if (mapExit) finishMapExit();
    root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    previousPose = null;
    drift.x = drift.y = 0;
    if (layout && !root.hidden && !mapView.hidden) queueRender();
  }
}

window.addEventListener("studio-motion", (event) => {
  motionAllowed = event.detail === true;
  syncMotion();
});
reducedMotion.addEventListener("change", syncMotion);

function mount() {
  root.innerHTML = `
    <div class="projects-map-view">
      <div class="projects-map-heading">
        <h1 id="projects-title">Projects <span class="projects-total">${projects.length}</span></h1>
        <label class="projects-picker">
          <select aria-label="Find a project"><option value="">Find a project</option></select>
          ${icon("m6 9 6 6 6-6")}
        </label>
      </div>
      <div class="projects-map" tabindex="0" role="region" aria-label="Project map" aria-describedby="projects-map-help">
        <div class="projects-map-tiles"></div>
      </div>
      <div class="projects-map-footer">
        <p id="projects-map-help"><span class="projects-help-pointer">Drag or scroll to explore. Use arrows to move, + / − to zoom, and Enter to open.</span><span class="projects-help-touch">Drag to pan. Pinch to zoom. Tap to open.</span></p>
        <div class="projects-zoom-controls" role="group" aria-label="Map zoom">
          <button type="button" data-zoom="out" aria-label="Zoom out">${icon("M5 12h14")}</button>
          <button type="button" class="projects-zoom-label" aria-label="Reset zoom to 100 percent">100%</button>
          <button type="button" data-zoom="in" aria-label="Zoom in">${icon("M5 12h14M12 5v14")}</button>
        </div>
        <div class="projects-move-tools">
          <button type="button" class="projects-move-toggle" aria-label="Move map controls" aria-expanded="false" aria-controls="map-pan-buttons">${icon("M12 3v18m-4-14 4-4 4 4m-8 10 4 4 4-4M3 12h18m-14-4-4 4 4 4m10-8 4 4-4 4")}</button>
          <div id="map-pan-buttons" class="projects-pan-controls" role="group" aria-label="Move around the project map">
          ${directions.map(([name, , , path]) => `<button type="button" data-pan="${name}" aria-label="Pan ${name}">${icon(path)}</button>`).join("")}
          </div>
        </div>
        <span class="projects-map-status" role="status"></span>
      </div>
    </div>
    <div class="projects-detail" hidden>
      <div class="projects-detail-bar">
        <a class="projects-back" href="#projects">${icon("M20 12H4m7-7-7 7 7 7")}Back to map</a>
        <a class="projects-source" target="_blank" rel="noopener noreferrer">Open on Scratch ${externalIcon}</a>
      </div>
      <div class="projects-detail-body">
        <img class="projects-detail-image" width="480" height="360" alt="">
        <div class="projects-detail-caption">
          <h1 class="projects-detail-title" tabindex="-1"></h1>
          <a class="projects-play"><svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor"><path d="M2.5 1.25 10 6l-7.5 4.75z"/></svg>Play project</a>
        </div>
      </div>
    </div>`;
  mapView = root.querySelector(".projects-map-view");
  viewport = root.querySelector(".projects-map");
  tileLayer = root.querySelector(".projects-map-tiles");
  picker = root.querySelector(".projects-picker select");
  mapStatus = root.querySelector(".projects-map-status");
  zoomLabel = root.querySelector(".projects-zoom-label");
  zoomOut = root.querySelector('[data-zoom="out"]');
  zoomIn = root.querySelector('[data-zoom="in"]');
  detail = root.querySelector(".projects-detail");
  detailImage = root.querySelector(".projects-detail-image");
  detailTitle = root.querySelector(".projects-detail-title");
  playLink = root.querySelector(".projects-play");
  sourceLink = root.querySelector(".projects-source");
  document.addEventListener("pointerdown", beginDetailPress);
  document.addEventListener("pointermove", trackDetailPress, { passive: true });
  document.addEventListener("pointerup", endDetailPress);
  document.addEventListener("pointercancel", () => { detailPress = null; });
  document.addEventListener("click", clickOutsidePhoto);

  for (const project of projects) picker.add(new Option(project.title, String(project.id)));
  if (projects.length < 2) {
    viewport.dataset.static = "true";
    root.querySelector(".projects-move-tools").hidden = true;
    root.querySelector(".projects-zoom-controls").hidden = true;
    root.querySelector("#projects-map-help").textContent = projects.length ? "Select the project to open it." : "";
    if (!projects.length) {
      picker.disabled = true;
      tileLayer.innerHTML = '<div class="projects-empty"><p>No shared projects are available.</p><a href="https://scratch.mit.edu/users/FutureApollo765/">View Scratch profile</a></div>';
    }
  }
  if (projects.length > 1) surface = mountMapSurface(viewport);
  picker.addEventListener("change", () => {
    const index = projects.findIndex((p) => String(p.id) === picker.value);
    if (index < 0) return;
    const tile = visibleProjectTile(projects[index]);
    if (tile) rememberThumbnail(tile);
    else centerOn(mapProjects.indexOf(projects[index]));
    pendingDetail = projects[index].id;
    location.hash = routeFor(projects[index]);
    picker.selectedIndex = 0;
  });
  root.querySelector(".projects-back").addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    backToMap();
  });
  playLink.addEventListener("click", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) pendingPlayer = focusedProject.id;
  });
  root.querySelectorAll("[data-pan]").forEach((button) => {
    const [, dx, dy] = directions.find(([name]) => name === button.dataset.pan);
    button.addEventListener("click", (event) => {
      nudge(dx, dy);
      if (event.detail && event.pointerType !== "touch") viewport.focus({ preventScroll: true });
    });
  });
  const moveTools = root.querySelector(".projects-move-tools");
  const moveToggle = root.querySelector(".projects-move-toggle");
  function setMoveTools(open) {
    moveToggle.setAttribute("aria-expanded", String(open));
    moveTools.classList.toggle("is-open", open);
  }
  moveToggle.addEventListener("click", () => setMoveTools(!moveTools.classList.contains("is-open")));
  document.addEventListener("pointerdown", event => {
    if (moveTools.classList.contains("is-open") && !moveTools.contains(event.target)) setMoveTools(false);
  });
  moveTools.addEventListener("keydown", event => {
    if (event.key === "Escape" && moveTools.classList.contains("is-open")) {
      setMoveTools(false);
      moveToggle.focus();
      event.preventDefault();
    }
  });
  zoomOut.addEventListener("click", () => zoomBy(1 / 1.25));
  zoomIn.addEventListener("click", () => zoomBy(1.25));
  zoomLabel.addEventListener("click", () => zoomTo(1));
  viewport.addEventListener("pointerdown", startDrag);
  viewport.addEventListener("pointermove", moveDrag);
  viewport.addEventListener("pointerleave", clearLook);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);
  viewport.addEventListener("wheel", panWheel, { passive: false });
  viewport.addEventListener("dragstart", (event) => event.preventDefault());
  viewport.addEventListener("click", clickTile);
  viewport.addEventListener("keydown", mapKey);
  document.addEventListener("keydown", (event) => {
    if (!root.hidden && !mapView.hidden && (event.target === document.body || event.target.id === "main-content")) {
      mapKey(event);
    }
    if (event.key === "Escape" && focusedProject && !dialog?.open && !root.hidden) {
      event.preventDefault();
      minimizeDetail();
    }
  });
  new ResizeObserver(() => {
    if (!mapView.hidden && !root.hidden) {
      measureMap();
      queueRender();
    }
  }).observe(viewport);
  syncMotion();
}

function mapKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const direction = directions.find(([name]) => event.key.toLowerCase() === "arrow" + name);
  if (direction) {
    event.preventDefault();
    nudge(direction[1], direction[2]);
  } else if (["+", "=", "-", "_", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") zoomTo(1);
    else zoomBy(event.key === "-" || event.key === "_" ? .8 : 1.25);
  } else if (event.key === "Enter" && !event.target.closest(".projects-tile") && centeredProject) {
    event.preventDefault();
    const focusCell = aim?.focusCell || viewport.querySelector("[data-nearest]")?.dataset.cell;
    if (!focusCell) return;
    const [col, row] = focusCell.split(",").map(Number);
    const target = mapProjects[projectIndex(col, row)];
    const tile = tiles.get(focusCell);
    if (tile && visibleProjectTile(target) === tile) rememberThumbnail(tile);
    else {
      const destination = cellShape(col, row);
      stopCoasting();
      camera.x = destination.x;
      camera.y = destination.y;
    }
    pendingDetail = target.id;
    location.hash = routeFor(target);
  }
}

// Each four-by-four chunk contains consecutive entries in the catalog.
// Signed chunk coordinates wrap through all projects in either direction.
function projectIndex(col, row) {
  const chunkX = Math.floor(col / 4);
  const chunkY = Math.floor(row / 4);
  const slot = modulo(row, 4) * 4 + modulo(col, 4);
  return modulo(chunkX * 16 + chunkY * 37 + slot, projects.length);
}

function cellShape(col, row) {
  const seed = (Math.imul(col, 73856093) ^ Math.imul(row, 19349663)) >>> 0;
  return {
    x: col + (seed % 17 - 8) * .008,
    y: row + (modulo(col, 2) ? -.19 : .13) + (seed % 11 - 5) * .011,
    width: .65 + (seed % 19) * .009,
  };
}

function measureMap() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const unit = Math.max(138, Math.min(300, width < 640 ? width * .43 : width * .205));
  layout = { width, height, unit, stepX: unit * camera.zoom, stepY: unit * .91 * camera.zoom };
}

function queueRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(renderMap);
}

function createTile(project, key, depth) {
  const tile = document.createElement("a");
  tile.className = "projects-tile";
  tile.href = routeFor(project);
  tile.dataset.cell = key;
  tile.style.setProperty("--depth", depth);
  tile.tabIndex = -1;
  tile.draggable = false;
  const image = new Image(480, 360);
  image.src = project.thumbnail;
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  image.draggable = false;
  const body = document.createElement("span");
  body.className = "projects-tile-body";
  const frame = document.createElement("span");
  frame.className = "projects-tile-frame";
  const open = document.createElement("span");
  open.className = "projects-tile-open";
  open.setAttribute("aria-hidden", "true");
  open.innerHTML = `Open project ${icon("M4 12h15m-7-7 7 7-7 7")}`;
  const label = document.createElement("span");
  label.className = "projects-tile-name";
  label.textContent = project.title;
  frame.append(image, open);
  body.append(frame, label);
  tile.append(body);
  return tile;
}

function renderMap() {
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  if (root.hidden || mapView.hidden || !layout || !projects.length) return;
  layout.stepX = layout.unit * camera.zoom;
  layout.stepY = layout.stepX * .91;
  const { width, height, stepX, stepY } = layout;
  surface?.update(camera.x, camera.y, stepX, stepY);
  updateDrift();
  const percent = Math.round(camera.zoom * 100) + "%";
  if (zoomLabel.textContent !== percent) zoomLabel.textContent = percent;
  zoomOut.disabled = camera.zoom <= minZoom + .001;
  zoomIn.disabled = camera.zoom >= maxZoom - .001;
  const halfCols = width / (2 * stepX);
  const halfRows = height / (2 * stepY);
  const visible = new Set();
  let nearestDistance = Infinity;
  let nearestTile;
  const single = projects.length === 1;
  const firstRow = single ? 0 : Math.floor(camera.y - halfRows - .5);
  const lastRow = single ? 0 : Math.ceil(camera.y + halfRows + .5);
  const firstCol = single ? 0 : Math.floor(camera.x - halfCols - .5);
  const lastCol = single ? 0 : Math.ceil(camera.x + halfCols + .5);
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const key = col + "," + row;
      const project = mapProjects[projectIndex(col, row)];
      let tile = tiles.get(key);
      if (!tile) {
        tile = createTile(project, key, .3 + modulo(col * 11 + row * 7, 13) / 18);
        tiles.set(key, tile);
        tileLayer.append(tile);
      }
      visible.add(key);
      const cell = cellShape(col, row);
      const tileWidth = Math.round(cell.width * stepX);
      const x = (cell.x - camera.x) * stepX;
      const y = (cell.y - camera.y) * stepY;
      tile.style.width = tileWidth + "px";
      tile.style.transform = `translate3d(${Math.round(width / 2 + x - tileWidth / 2)}px,${Math.round(height / 2 + y - tileWidth * .375)}px,0)`;
      tile.classList.toggle("is-selected", project.id === selectedId);
      tile.removeAttribute("data-nearest");
      const distance = x * x + y * y;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestTile = tile;
        centeredProject = project;
      }
    }
  }
  // Move keyboard emphasis to the intended work immediately, even if the
  // camera is still easing towards it.
  if (aim?.focusCell && tiles.has(aim.focusCell)) {
    nearestTile = tiles.get(aim.focusCell);
    centeredProject = byId.get(Number(nearestTile.hash.slice("#projects/".length)));
  }
  nearestTile?.setAttribute("data-nearest", "");
  for (const [key, tile] of tiles) {
    if (!visible.has(key)) {
      tile.remove();
      tiles.delete(key);
    }
  }
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (centeredProject && document.activeElement === viewport) mapStatus.textContent = "Nearest project: " + centeredProject.title;
  }, 220);
}

// Point a direct link or picker selection at its first occurrence.
// Never recenter when a visitor returns from a tile on their own map.
function centerOn(index) {
  stopCoasting();
  const col = Math.floor(index / 16) * 4 + index % 4;
  const row = Math.floor((index % 16) / 4);
  const target = cellShape(col, row);
  camera.x = target.x;
  camera.y = target.y;
}

function stopCoasting() {
  cancelAnimationFrame(coastFrame);
  coastFrame = 0;
  aim = null;
  dragSpring = null;
}

function glideTo(x, y, zoom, response = 76, anchor = null) {
  if (!canMove()) {
    stopCoasting();
    Object.assign(camera, { x, y, zoom });
    queueRender();
    return;
  }
  if (aim) {
    Object.assign(aim, { x, y, zoom, response, anchor, focusCell: null });
    return;
  }
  stopCoasting();
  aim = { x, y, zoom, response, anchor };
  let lastTime = performance.now();
  function move(now) {
    const ease = 1 - Math.exp(-Math.min(64, now - lastTime) / aim.response);
    lastTime = now;
    const dx = aim.x - camera.x, dy = aim.y - camera.y, dz = aim.zoom - camera.zoom;
    if (Math.hypot(dx, dy) * layout.stepX < .3 && Math.abs(dz) < .001) {
      Object.assign(camera, { x: aim.x, y: aim.y, zoom: aim.zoom });
      aim = null;
      coastFrame = 0;
    } else {
      camera.x += dx * ease;
      camera.y += dy * ease;
      camera.zoom += dz * ease;
      if (aim.anchor) {
        camera.x = aim.anchor.x - aim.anchor.px / (layout.unit * camera.zoom);
        camera.y = aim.anchor.y - aim.anchor.py / (layout.unit * .91 * camera.zoom);
      }
      coastFrame = requestAnimationFrame(move);
    }
    queueRender();
  }
  coastFrame = requestAnimationFrame(move);
}

function nudge(dx, dy) {
  if (projects.length < 2) return;
  clearLook();
  clearReturnPhoto();
  // A key step lands on an actual work, including in the staggered rows.
  // Repeated presses keep their intended destination while the camera follows.
  const focusCell = aim?.focusCell || viewport.querySelector("[data-nearest]")?.dataset.cell;
  if (!focusCell) return;
  const [col, row] = focusCell.split(",").map(Number);
  const destination = cellShape(col + dx, row + dy);
  glideTo(destination.x, destination.y, (aim || camera).zoom, 66);
  if (aim) aim.focusCell = (col + dx) + "," + (row + dy);
  else renderMap();
}

function zoomTo(zoom) {
  if (projects.length < 2) return;
  clearLook();
  clearReturnPhoto();
  const target = aim || camera;
  glideTo(target.x, target.y, clamp(zoom, minZoom, maxZoom), 82);
}

function zoomBy(factor) {
  zoomTo((aim || camera).zoom * factor);
}

function zoomAtPointer(event, unit) {
  const box = viewport.getBoundingClientRect();
  const px = event.clientX - box.left - layout.width / 2;
  const py = event.clientY - box.top - layout.height / 2;
  const x = camera.x + px / (layout.unit * camera.zoom);
  const y = camera.y + py / (layout.unit * .91 * camera.zoom);
  const zoom = clamp((aim || camera).zoom * Math.exp(-event.deltaY * unit * .009), minZoom, maxZoom);
  const targetX = x - px / (layout.unit * zoom);
  const targetY = y - py / (layout.unit * .91 * zoom);
  glideTo(targetX, targetY, zoom, 46, { x, y, px, py });
}

// Images drift a short distance within their cells as the camera moves.
function updateDrift() {
  const now = performance.now();
  const elapsed = previousPose ? now - previousPose.time : Infinity;
  const moving = canMove() && elapsed < 100 && !pinch && !aim?.anchor;
  const strength = moving ? 1 - Math.exp(-Math.max(8, elapsed) / 45) : 1;
  const vx = moving ? clamp((camera.x - previousPose.x) * layout.stepX / Math.max(8, elapsed), -2, 2) : 0;
  const vy = moving ? clamp((camera.y - previousPose.y) * layout.stepY / Math.max(8, elapsed), -2, 2) : 0;
  drift.x += (vx - drift.x) * strength;
  drift.y += (vy - drift.y) * strength;
  if (Math.abs(drift.x) < .008) drift.x = 0;
  if (Math.abs(drift.y) < .008) drift.y = 0;
  previousPose = { x: camera.x, y: camera.y, time: now };
  tileLayer.style.setProperty("--drift-x", (drift.x * 10).toFixed(2) + "px");
  tileLayer.style.setProperty("--drift-y", (drift.y * 8).toFixed(2) + "px");
  tileLayer.style.setProperty("--turn-y", (drift.x * 6).toFixed(2) + "deg");
  tileLayer.style.setProperty("--turn-x", (-drift.y * 5).toFixed(2) + "deg");
  if (drift.x || drift.y) queueRender();
}

function pinchMetrics() {
  const [first, second] = touches.values();
  const rect = viewport.getBoundingClientRect();
  return {
    x: (first.x + second.x) / 2 - rect.left - layout.width / 2,
    y: (first.y + second.y) / 2 - rect.top - layout.height / 2,
    distance: Math.max(2, Math.hypot(first.x - second.x, first.y - second.y)),
  };
}

function startPointerTrack(id, x, y, dragging = false) {
  gesture = { id, x, y, fromX: camera.x, fromY: camera.y, dragging, samples: [{ x, y, time: performance.now() }] };
}

// The exact critically damped solution gives the same response across frame
// rates. Its velocity also gives a continuous handoff into release inertia.
function sampleDragSpring(now) {
  const dt = Math.max(0, now - dragSpring.time) / 1000;
  if (!dt) return;
  const decay = Math.exp(-dragResponse * dt);
  for (const axis of ["x", "y"]) {
    const offset = camera[axis] - dragSpring.target[axis];
    const slope = dragSpring.velocity[axis] + dragResponse * offset;
    camera[axis] = dragSpring.target[axis] + (offset + slope * dt) * decay;
    dragSpring.velocity[axis] = (dragSpring.velocity[axis] - dragResponse * slope * dt) * decay;
  }
  dragSpring.time = now;
}

function animateDrag(now) {
  coastFrame = 0;
  if (!dragSpring) return;
  sampleDragSpring(now);
  const distance = Math.hypot((dragSpring.target.x - camera.x) * layout.stepX, (dragSpring.target.y - camera.y) * layout.stepY);
  const speed = Math.hypot(dragSpring.velocity.x * layout.stepX, dragSpring.velocity.y * layout.stepY);
  if (distance < .1 && speed < 4) {
    Object.assign(camera, dragSpring.target);
    dragSpring = null;
  } else coastFrame = requestAnimationFrame(animateDrag);
  queueRender();
}

function steerDrag(clientX, clientY) {
  const now = performance.now();
  const samples = gesture.samples, last = samples.at(-1);
  const dx = clientX - last.x, dy = clientY - last.y;
  if (Math.hypot(dx, dy) >= .25) {
    // A deliberate reversal throws in the new direction, without retaining
    // the previous stroke's momentum in the velocity estimate.
    const before = samples.at(-2);
    if (now - last.time > 100) samples.length = 0;
    else if (before && dx * (last.x - before.x) + dy * (last.y - before.y) < 0) samples.splice(0, samples.length - 1);
    samples.push({ x: clientX, y: clientY, time: now });
    while (samples.length > 2 && samples[1].time < now - 100) samples.shift();
  }
  const x = gesture.fromX + dragGain * (gesture.x - clientX) / layout.stepX;
  const y = gesture.fromY + dragGain * (gesture.y - clientY) / layout.stepY;
  if (!canMove()) {
    camera.x = x;
    camera.y = y;
    queueRender();
    return;
  }
  if (dragSpring) {
    sampleDragSpring(now);
    Object.assign(dragSpring.target, { x, y });
  } else {
    stopCoasting();
    dragSpring = { target: { x, y }, velocity: { x: 0, y: 0 }, time: now };
  }
  if (!coastFrame) coastFrame = requestAnimationFrame(animateDrag);
}

function releaseDrag() {
  if (!canMove() || !dragSpring) return;
  const now = performance.now(), samples = gesture.samples;
  const last = samples.at(-1), first = samples[0];
  const age = now - last.time, elapsed = last.time - first.time;
  // A stationary hand releases the map where it was put. Pointerup at the
  // same coordinates does not refresh the last actual movement timestamp.
  if (age > 85 || elapsed < 8) return;
  const recency = Math.exp(-Math.max(0, age - 20) / 45);
  const vx = (first.x - last.x) * dragGain * 1000 / elapsed * recency;
  const vy = (first.y - last.y) * dragGain * 1000 / elapsed * recency;
  const speed = Math.hypot(vx, vy);
  if (speed < 100) return;
  const scale = Math.min(1, 2400 / speed);
  const velocity = { x: vx * scale / layout.stepX, y: vy * scale / layout.stepY };
  const friction = .16 + .055 * Math.min(speed / 1800, 1);
  sampleDragSpring(now);
  const target = { ...dragSpring.target };
  const offset = { x: camera.x - target.x, y: camera.y - target.y };
  const slope = {
    x: dragSpring.velocity.x - velocity.x + dragResponse * offset.x,
    y: dragSpring.velocity.y - velocity.y + dragResponse * offset.y,
  };
  stopCoasting();
  function coast(time) {
    coastFrame = 0;
    if (!canMove() || document.hidden || root.hidden || mapView.hidden) return;
    const elapsed = Math.max(0, time - now) / 1000;
    const decay = Math.exp(-elapsed / friction), correction = Math.exp(-dragResponse * elapsed);
    for (const axis of ["x", "y"]) {
      // The first term is a frictional coast beyond the literal drag target.
      // The short spring correction preserves position and velocity exactly
      // at release, even when the pointer was ahead of the rendered map.
      camera[axis] = target[axis] + velocity[axis] * friction * (1 - decay) +
        (offset[axis] + slope[axis] * elapsed) * correction;
    }
    if (speed * scale * decay < 4) {
      camera.x = target.x + velocity.x * friction;
      camera.y = target.y + velocity.y * friction;
    } else coastFrame = requestAnimationFrame(coast);
    queueRender();
  }
  coastFrame = requestAnimationFrame(coast);
}

function startDrag(event) {
  if (projects.length < 2 || event.button !== 0) return;
  clearLook();
  clearReturnPhoto();
  clearPress();
  if (event.pointerType === "touch") {
    if (touches.size >= 2) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      stopCoasting();
      gesture = null;
      const mid = pinchMetrics();
      pinch = { x: camera.x + mid.x / layout.stepX, y: camera.y + mid.y / layout.stepY, distance: mid.distance, zoom: camera.zoom };
      for (const id of touches.keys()) viewport.setPointerCapture(id);
      viewport.classList.add("is-dragging");
      return;
    }
  } else if (!event.isPrimary) return;
  suppressClickUntil = 0;
  pressedTile = event.target.closest(".projects-tile");
  pressedTile?.classList.add("is-pressed");
  stopCoasting();
  startPointerTrack(event.pointerId, event.clientX, event.clientY);
}

function moveDrag(event) {
  if (!gesture && !pinch && event.pointerType === "mouse" && canMove()) {
    const tile = event.target.closest(".projects-tile");
    if (tile !== hoverTile) clearLook();
    if (tile && !aim) {
      hoverTile = tile;
      const box = tile.getBoundingClientRect();
      const x = clamp((event.clientX - box.left) / box.width - .5, -.5, .5);
      const y = clamp((event.clientY - box.top) / box.height - .5, -.5, .5);
      tile.style.setProperty("--look-x", -y * 9 + "deg");
      tile.style.setProperty("--look-y", x * 11 + "deg");
    }
  }
  if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && touches.has(event.pointerId)) {
    const mid = pinchMetrics();
    camera.zoom = clamp(pinch.zoom * mid.distance / pinch.distance, minZoom, maxZoom);
    camera.x = pinch.x - mid.x / (layout.unit * camera.zoom);
    camera.y = pinch.y - mid.y / (layout.unit * .91 * camera.zoom);
    queueRender();
    return;
  }
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = gesture.x - event.clientX;
  const dy = gesture.y - event.clientY;
  if (!gesture.dragging) {
    if (Math.hypot(dx, dy) < (event.pointerType === "touch" ? 8 : 5)) return;
    clearPress();
    gesture.dragging = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
  }
  steerDrag(event.clientX, event.clientY);
}

function clearLook() {
  if (!hoverTile) return;
  hoverTile.style.removeProperty("--look-x");
  hoverTile.style.removeProperty("--look-y");
  hoverTile = null;
}

function clearPress() {
  pressedTile?.classList.remove("is-pressed");
  pressedTile = null;
}

function finishDrag(event) {
  const trackedTouch = touches.delete(event.pointerId);
  if (pinch && trackedTouch) {
    pinch = null;
    suppressClickUntil = performance.now() + 300;
    viewport.classList.remove("is-dragging");
    if (touches.size) {
      const [id, point] = touches.entries().next().value;
      startPointerTrack(id, point.x, point.y, true);
    }
    return;
  }
  if (!gesture || gesture.id !== event.pointerId) return;
  const dragged = gesture.dragging;
  if (dragged && event.type === "pointerup") {
    steerDrag(event.clientX, event.clientY);
    releaseDrag();
  }
  cancelDrag();
  if (dragged) suppressClickUntil = performance.now() + 200;
}

function cancelDrag() {
  clearPress();
  if (gesture && viewport.hasPointerCapture(gesture.id)) viewport.releasePointerCapture(gesture.id);
  gesture = null;
  for (const id of touches.keys()) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  touches.clear();
  pinch = null;
  viewport?.classList.remove("is-dragging");
}

function panWheel(event) {
  if (projects.length < 2 || event.metaKey) return;
  event.preventDefault();
  clearLook();
  clearReturnPhoto();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layout.height : 1;
  // Trackpads report pinch as a Ctrl-wheel. Keep the exact world point under
  // the fingers fixed while the zoom settles, just as on a touch screen.
  if (event.ctrlKey) {
    zoomAtPointer(event, unit);
    return;
  }
  const horizontal = event.shiftKey && !event.deltaX;
  const target = aim || camera;
  glideTo(target.x + (horizontal ? event.deltaY : event.deltaX) * unit / layout.stepX,
    target.y + (horizontal ? 0 : event.deltaY) * unit / layout.stepY, target.zoom);
}

function clickTile(event) {
  const tile = event.target.closest(".projects-tile");
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  if (!tile || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  rememberThumbnail(tile);
  pendingDetail = Number(tile.hash.split("/")[1]);
}

function rememberThumbnail(tile) {
  stopCoasting();
  entryBounds = tile.querySelector("img").getBoundingClientRect();
  entryCell = tile.dataset.cell;
}

function backToMap() {
  if (history.state?.studioMapFrom === focusedProject?.id) history.back();
  else location.replace("#projects");
}

function minimizeDetail() {
  if (!focusedProject || dialog?.open || minimizing) return;
  minimizing = true;
  if (history.state?.studioHomeFrom === focusedProject.id) history.back();
  else backToMap();
}

function onDetailBackground(event) {
  if (!focusedProject || root.hidden || detail.hidden || dialog?.open) return false;
  if (event.target.closest("a, button, input, select, textarea, label, summary, dialog, [contenteditable], [role='button'], [role='link'], .projects-detail-image")) return false;
  // A shared photo can temporarily sit in a pointer-transparent animation
  // layer. Its on-screen bounds still belong to the thumbnail.
  const photo = (document.querySelector(".index-flight") || detailImage).getBoundingClientRect();
  return event.clientX < photo.left || event.clientX > photo.right ||
    event.clientY < photo.top || event.clientY > photo.bottom;
}

function beginDetailPress(event) {
  detailPress = null;
  if (!event.isPrimary || event.button !== 0 || !onDetailBackground(event)) return;
  detailPress = { id: event.pointerId, project: focusedProject, x: event.clientX, y: event.clientY, released: false };
}

function trackDetailPress(event) {
  if (detailPress?.id === event.pointerId && Math.hypot(event.clientX - detailPress.x, event.clientY - detailPress.y) > 6) detailPress = null;
}

function endDetailPress(event) {
  trackDetailPress(event);
  if (detailPress?.id !== event.pointerId) return;
  if (onDetailBackground(event)) detailPress.released = true;
  else detailPress = null;
}

function clickOutsidePhoto(event) {
  const press = detailPress;
  detailPress = null;
  if (!press?.released || press.project !== focusedProject || event.defaultPrevented || !event.detail) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !onDetailBackground(event)) return;
  minimizeDetail();
}

function closePlayerRoute() {
  if (history.state?.studioPlayerFrom === focusedProject.id) history.back();
  else location.replace(routeFor(focusedProject));
}
function showPlayer(project) {
  if (dialog?.open && playerFrame?.dataset.project === String(project.id)) return;
  removePlayer();
  if (pendingPlayer === project.id) {
    history.replaceState({ ...history.state, studioPlayerFrom: project.id }, "", location.href);
    pendingPlayer = null;
  }
  dialog = document.createElement("dialog");
  dialog.className = "projects-player";
  dialog.setAttribute("aria-labelledby", "projects-player-title");
  dialog.innerHTML = `
    <div class="projects-player-bar">
      <strong id="projects-player-title"></strong>
      <button type="button" class="projects-player-close" aria-label="Close player" autofocus>
        <svg viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 10 10M14 4 4 14"/></svg>
      </button>
    </div>
    <div class="projects-player-stage"><span class="projects-player-loading" role="status">Loading player…</span></div>
    <div class="projects-player-footer"><a target="_blank" rel="noopener noreferrer">Open on Scratch ${externalIcon}</a></div>`;
  dialog.querySelector("strong").textContent = project.title;
  dialog.querySelector(".projects-player-footer a").href = project.url;
  dialog.querySelector("button").addEventListener("click", closePlayerRoute);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePlayerRoute();
  });
  const loading = dialog.querySelector(".projects-player-loading");
  playerFrame = document.createElement("iframe");
  playerFrame.className = "projects-player-frame";
  playerFrame.title = `${project.title} — Scratch project player`;
  playerFrame.dataset.project = project.id;
  playerFrame.allow = "fullscreen; gamepad";
  playerFrame.allowFullscreen = true;
  playerFrame.addEventListener("load", () => loading.remove(), { once: true });
  playerFrame.src = project.embed;
  dialog.querySelector(".projects-player-stage").append(playerFrame);
  root.append(dialog);
  dialog.showModal();
}

function removePlayer(restoreFocus = false) {
  if (!dialog) return;
  playerFrame?.remove();
  playerFrame = null;
  dialog.close();
  dialog.remove();
  dialog = null;
  if (restoreFocus && !root.hidden) playLink.focus({ preventScroll: true });
}

function flyPhoto(image, from, to) {
  const dx = from.x + from.width / 2 - to.x - to.width / 2;
  const dy = from.y + from.height / 2 - to.y - to.height / 2;
  return image.animate([
    { transform: `translate(${dx}px,${dy}px) scale(${from.width / to.width},${from.height / to.height})` },
    { transform: "none" },
  ], { duration: 520, easing: "cubic-bezier(.22,.72,.16,1)" });
}

function clearReturnPhoto() {
  if (!returningPhoto) return;
  returningPhoto.tile.classList.remove("is-returning");
  returningPhoto.ghost.remove();
  returningPhoto = null;
}

function finishMapExit() {
  const flight = mapExit;
  mapExit = null;
  flight?.cancel();
  mapView.classList.remove("is-departing");
  mapView.querySelector(".is-opening")?.classList.remove("is-opening");
  mapView.inert = false;
  if (focusedProject) mapView.hidden = true;
}

function fadeBehindPhoto(source) {
  const opacity = getComputedStyle(mapView).opacity;
  mapView.getAnimations().forEach(animation => animation.cancel());
  source?.classList.add("is-opening");
  mapView.classList.add("is-departing");
  mapView.inert = true;
  mapExit = mapView.animate([{ opacity }, { opacity: 0 }], {
    duration: 290, easing: "cubic-bezier(.4,0,.25,1)", fill: "forwards",
  });
  const flight = mapExit;
  flight.onfinish = () => { if (mapExit === flight) finishMapExit(); };
}

function returnPhoto(project, from) {
  if (!canMove() || !from.width) return;
  const tile = tiles.get(selectedCell) || visibleProjectTile(project);
  if (!tile) return;
  const dest = tile.querySelector("img").getBoundingClientRect();
  const field = viewport.getBoundingClientRect();
  if (!dest.width || dest.right < field.left || dest.left > field.right || dest.bottom < field.top || dest.top > field.bottom) return;
  mapView.animate([{ opacity: .22 }, { opacity: 1 }], { duration: 310, easing: "ease-out" });
  const ghost = document.createElement("img");
  ghost.className = "projects-photo-return";
  ghost.alt = "";
  ghost.src = project.thumbnail;
  ghost.style.left = dest.left + "px";
  ghost.style.top = dest.top + "px";
  ghost.style.width = dest.width + "px";
  ghost.style.height = dest.height + "px";
  root.append(ghost);
  tile.classList.add("is-returning");
  returningPhoto = { ghost, tile };
  const flight = flyPhoto(ghost, from, dest);
  const finish = () => { if (returningPhoto?.ghost === ghost) clearReturnPhoto(); };
  flight.onfinish = flight.oncancel = finish;
}

function assembleMap() {
  if (assembled || !tiles.size) return;
  assembled = true;
  if (!canMove()) return;
  const field = viewport.getBoundingClientRect();
  for (const tile of tiles.values()) {
    if (tile.classList.contains("is-returning")) continue;
    const box = tile.getBoundingClientRect();
    if (box.right < field.left || box.left > field.right || box.bottom < field.top || box.top > field.bottom) continue;
    const x = (box.left + box.width / 2 - field.left) / field.width - .5;
    const y = (box.top + box.height / 2 - field.top) / field.height - .5;
    tile.animate([
      { opacity: .03, scale: ".82", translate: `${x * 56}px ${y * 48 + 18}px` },
      { opacity: 1, scale: "1", translate: "0" },
    ], { duration: 480, delay: 55 + Math.hypot(x, y) * 170, fill: "backwards", easing: "cubic-bezier(.18,.68,.21,1)" });
  }
}

function openDetail(project) {
  if (mapExit) finishMapExit();
  clearReturnPhoto();
  detailImage.getAnimations().forEach(animation => animation.cancel());
  focusedProject = project;
  selectedId = project.id;
  const fromMap = pendingDetail === project.id;
  if (fromMap) {
    selectedCell = entryCell;
    history.replaceState({ ...history.state, studioMapFrom: project.id, studioMapCell: selectedCell, studioMapCamera: { ...camera } }, "", location.href);
    pendingDetail = null;
  } else if (history.state?.studioMapFrom === project.id && Number.isFinite(history.state.studioMapCamera?.x) && Number.isFinite(history.state.studioMapCamera?.y)) {
    const source = visibleProjectTile(project);
    if (source) rememberThumbnail(source);
    Object.assign(camera, history.state.studioMapCamera);
    camera.zoom = clamp(camera.zoom || 1, minZoom, maxZoom);
    selectedCell = history.state.studioMapCell;
  } else {
    selectedCell = null;
    centerOn(mapProjects.indexOf(project));
  }
  stopCoasting();
  cancelDrag();
  clearTimeout(statusTimer);
  const flightReady = canMove() && entryBounds?.width > 0 && !mapView.hidden;
  if (flightReady) fadeBehindPhoto(tiles.get(entryCell));
  else mapView.hidden = true;
  detail.hidden = false;
  root.setAttribute("aria-labelledby", "projects-detail-title");
  detailTitle.id = "projects-detail-title";
  detailImage.src = project.thumbnail;
  detailTitle.textContent = project.title;
  sourceLink.href = project.url;
  playLink.href = routeFor(project) + "/play";
  detailTitle.focus({ preventScroll: true });
  if (flightReady) {
    const target = detailImage.getBoundingClientRect();
    if (target.width > 0) flyPhoto(detailImage, entryBounds, target);
    detail.querySelector(".projects-detail-caption").animate([
      { opacity: 0, transform: "translateY(9px)" },
      { opacity: 1, transform: "none" },
    ], { duration: 240, delay: 100, fill: "backwards", easing: "ease-out" });
  }
  entryBounds = null;
  entryCell = null;
}

export function showProjectView(id, play = false) {
  detailPress = null;
  minimizing = false;
  if (!viewport) mount();
  root.hidden = false;
  const project = projects.find((entry) => String(entry.id) === String(id));
  if (project) {
    if (focusedProject !== project || detail.hidden) openDetail(project);
    if (play) showPlayer(project);
    else removePlayer(true);
    return;
  }
  if (id) history.replaceState(history.state, "", "#projects");
  const fromDetail = focusedProject;
  const photoBounds = fromDetail && detailImage.getBoundingClientRect();
  if (fromDetail) detailImage.getAnimations().forEach(animation => animation.cancel());
  removePlayer();
  focusedProject = null;
  if (mapExit) finishMapExit();
  detail.hidden = true;
  mapView.hidden = false;
  root.setAttribute("aria-labelledby", "projects-title");
  measureMap();
  renderMap();
  if (fromDetail) {
    viewport.focus({ preventScroll: true });
    returnPhoto(fromDetail, photoBounds);
  }
  assembleMap();
}

export function hideProjectView() {
  detailPress = null;
  minimizing = false;
  clearLook();
  if (mapExit) finishMapExit();
  clearReturnPhoto();
  removePlayer();
  cancelDrag();
  stopCoasting();
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  clearTimeout(statusTimer);
  pendingPlayer = null;
  pendingDetail = null;
  entryBounds = null;
  entryCell = null;
  previousPose = null;
  focusedProject = null;
  root.hidden = true;
}
