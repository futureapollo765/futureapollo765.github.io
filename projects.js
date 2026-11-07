import { projects } from "./project-data.js";

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
const camera = projects.length > 1 ? { x: 1.55, y: 1.3 } : { x: 0, y: 0 };

let mapView, viewport, tileLayer, picker, mapStatus;
let detail, detailImage, detailTitle, playLink, sourceLink;
let dialog, playerFrame, pendingPlayer, pendingDetail;
let focusedProject, selectedId, centeredProject;
let layout, gesture, entryBounds;
let renderFrame = 0, coastFrame = 0, statusTimer = 0;
let suppressClickUntil = 0;
let motionAllowed = !document.documentElement.classList.contains("motion-paused");

function canMove() {
  return motionAllowed && !reducedMotion.matches;
}

function syncMotion() {
  root.dataset.motion = canMove() ? "on" : "off";
  if (!canMove()) {
    stopCoasting();
    root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
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
        <p id="projects-map-help">Drag to explore. Use arrow keys to move and Enter to open the nearest project.</p>
        <div class="projects-pan-controls" role="group" aria-label="Move around the project map">
          ${directions.map(([name, , , path]) => `<button type="button" data-pan="${name}" aria-label="Pan ${name}">${icon(path)}</button>`).join("")}
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
  detail = root.querySelector(".projects-detail");
  detailImage = root.querySelector(".projects-detail-image");
  detailTitle = root.querySelector(".projects-detail-title");
  playLink = root.querySelector(".projects-play");
  sourceLink = root.querySelector(".projects-source");

  for (const project of projects) picker.add(new Option(project.title, String(project.id)));
  if (projects.length < 2) {
    viewport.dataset.static = "true";
    root.querySelector(".projects-pan-controls").hidden = true;
    root.querySelector("#projects-map-help").textContent = projects.length ? "Select the project to open it." : "";
    if (!projects.length) {
      picker.disabled = true;
      tileLayer.innerHTML = '<div class="projects-empty"><p>No shared projects are available.</p><a href="https://scratch.mit.edu/users/FutureApollo765/">View Scratch profile</a></div>';
    }
  }
  picker.addEventListener("change", () => {
    const index = projects.findIndex((p) => String(p.id) === picker.value);
    if (index < 0) return;
    centerOn(mapProjects.indexOf(projects[index]));
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
    button.addEventListener("click", () => nudge(dx, dy));
  });
  viewport.addEventListener("pointerdown", startDrag);
  viewport.addEventListener("pointermove", moveDrag);
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
      backToMap();
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
  } else if (event.key === "Enter" && !event.target.closest(".projects-tile") && centeredProject) {
    event.preventDefault();
    pendingDetail = centeredProject.id;
    location.hash = routeFor(centeredProject);
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
  const stepX = Math.max(138, Math.min(300, width < 640 ? width * .43 : width * .205));
  layout = { width, height, stepX, stepY: stepX * .91 };
}

function queueRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(renderMap);
}

function createTile(project) {
  const tile = document.createElement("a");
  tile.className = "projects-tile";
  tile.href = routeFor(project);
  tile.tabIndex = -1;
  tile.draggable = false;
  const image = new Image(480, 360);
  image.src = project.thumbnail;
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  image.draggable = false;
  const label = document.createElement("span");
  label.textContent = project.title;
  tile.append(image, label);
  return tile;
}

function renderMap() {
  renderFrame = 0;
  if (root.hidden || mapView.hidden || !layout || !projects.length) return;
  const { width, height, stepX, stepY } = layout;
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
        tile = createTile(project);
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
  const col = Math.floor(index / 16) * 4 + index % 4;
  const row = Math.floor((index % 16) / 4);
  const target = cellShape(col, row);
  camera.x = target.x;
  camera.y = target.y;
}

function panBy(dx, dy) {
  camera.x += dx / layout.stepX;
  camera.y += dy / layout.stepY;
  queueRender();
}

function stopCoasting() {
  cancelAnimationFrame(coastFrame);
  coastFrame = 0;
}

function nudge(dx, dy) {
  if (projects.length < 2) return;
  stopCoasting();
  const start = { ...camera };
  if (!canMove()) {
    camera.x += dx;
    camera.y += dy;
    queueRender();
    return;
  }
  const began = performance.now();
  function move(now) {
    const fraction = Math.min(1, (now - began) / 200);
    const eased = 1 - (1 - fraction) ** 3;
    camera.x = start.x + dx * eased;
    camera.y = start.y + dy * eased;
    queueRender();
    if (fraction < 1) coastFrame = requestAnimationFrame(move);
  }
  coastFrame = requestAnimationFrame(move);
}

function startDrag(event) {
  if (projects.length < 2 || !event.isPrimary || event.button !== 0) return;
  stopCoasting();
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, vx: 0, vy: 0, dragging: false };
}

function moveDrag(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = gesture.x - event.clientX;
  const dy = gesture.y - event.clientY;
  if (!gesture.dragging) {
    if (Math.hypot(dx, dy) < 5) return;
    gesture.dragging = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
  }
  const elapsed = Math.max(8, event.timeStamp - gesture.time);
  gesture.vx = .45 * gesture.vx + .55 * dx / elapsed;
  gesture.vy = .45 * gesture.vy + .55 * dy / elapsed;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  gesture.time = event.timeStamp;
  panBy(dx, dy);
}

function finishDrag(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const drag = gesture;
  cancelDrag();
  if (!drag.dragging) return;
  suppressClickUntil = performance.now() + 200;
  if (!canMove() || event.type === "pointercancel" || event.timeStamp - drag.time > 100) return;
  let vx = Math.max(-2.2, Math.min(2.2, drag.vx));
  let vy = Math.max(-2.2, Math.min(2.2, drag.vy));
  let last = performance.now();
  function coast(now) {
    const dt = Math.min(32, now - last);
    const decay = Math.exp(-dt / 115);
    vx *= decay;
    vy *= decay;
    panBy(vx * dt, vy * dt);
    last = now;
    if (Math.hypot(vx, vy) > .025) coastFrame = requestAnimationFrame(coast);
  }
  coastFrame = requestAnimationFrame(coast);
}

function cancelDrag() {
  if (gesture && viewport.hasPointerCapture(gesture.id)) viewport.releasePointerCapture(gesture.id);
  gesture = null;
  viewport?.classList.remove("is-dragging");
}

function panWheel(event) {
  if (projects.length < 2 || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  stopCoasting();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layout.height : 1;
  if (event.shiftKey && !event.deltaX) panBy(event.deltaY * unit, 0);
  else panBy(event.deltaX * unit, event.deltaY * unit);
}

function clickTile(event) {
  const tile = event.target.closest(".projects-tile");
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  if (!tile || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  pendingDetail = Number(tile.hash.split("/")[1]);
  entryBounds = tile.getBoundingClientRect();
}

function backToMap() {
  if (history.state?.studioMapFrom === focusedProject?.id) history.back();
  else location.replace("#projects");
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

function openDetail(project) {
  focusedProject = project;
  selectedId = project.id;
  const fromMap = pendingDetail === project.id;
  if (fromMap) {
    history.replaceState({ ...history.state, studioMapFrom: project.id, studioMapCamera: { ...camera } }, "", location.href);
    pendingDetail = null;
  } else if (history.state?.studioMapFrom === project.id && Number.isFinite(history.state.studioMapCamera?.x) && Number.isFinite(history.state.studioMapCamera?.y)) {
    Object.assign(camera, history.state.studioMapCamera);
  } else {
    centerOn(mapProjects.indexOf(project));
  }
  stopCoasting();
  cancelDrag();
  clearTimeout(statusTimer);
  mapView.hidden = true;
  detail.hidden = false;
  root.setAttribute("aria-labelledby", "projects-detail-title");
  detailTitle.id = "projects-detail-title";
  detailImage.src = project.thumbnail;
  detailTitle.textContent = project.title;
  sourceLink.href = project.url;
  playLink.href = routeFor(project) + "/play";
  detailTitle.focus({ preventScroll: true });
  if (canMove() && entryBounds) {
    const target = detailImage.getBoundingClientRect();
    if (target.width > 0) {
      const dx = entryBounds.x + entryBounds.width / 2 - target.x - target.width / 2;
      const dy = entryBounds.y + entryBounds.height / 2 - target.y - target.height / 2;
      detailImage.animate([
        { transform: `translate(${dx}px,${dy}px) scale(${entryBounds.width / target.width})`, opacity: .55 },
        { transform: "none", opacity: 1 },
      ], { duration: 370, easing: "cubic-bezier(.16,.72,.2,1)" });
    }
  }
  entryBounds = null;
}

export function showProjectView(id, play = false) {
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
  const fromDetail = !!focusedProject;
  removePlayer();
  focusedProject = null;
  detail.hidden = true;
  mapView.hidden = false;
  root.setAttribute("aria-labelledby", "projects-title");
  measureMap();
  renderMap();
  if (fromDetail) viewport.focus({ preventScroll: true });
}

export function hideProjectView() {
  removePlayer();
  cancelDrag();
  stopCoasting();
  cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  clearTimeout(statusTimer);
  pendingPlayer = null;
  pendingDetail = null;
  entryBounds = null;
  focusedProject = null;
  root.hidden = true;
}
