import { projects } from "./project-data.js";

const root = document.querySelector("#projects-view");
const formatIndex = (number) => String(number).padStart(2, "0");
const routeFor = (index) => `#projects/${projects[index].id}`;

let activeIndex = 0;
let rail;
let cards;
let title;
let counter;
let playLink;
let scratchLink;
let dialog;
let playerFrame;
let pendingPlayer;
let gesture;
let suppressClickUntil = 0;
let wheelTotal = 0;
let lastWheel = 0;
let wheelLocked = false;

const arrowIcon = (direction) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" ${direction === -1 ? 'style="transform: rotate(180deg)"' : ""}><path d="M4 12h15M13 5l7 7-7 7"/></svg>`;
const externalIcon = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 12 12 4M4 4h8v8"/></svg>';

function mountGallery() {
  root.innerHTML = `
    <div class="projects-heading">
      <h1 id="projects-title">Projects</h1>
      <a class="projects-source" target="_blank" rel="noopener noreferrer">Open on Scratch ${externalIcon}</a>
    </div>
    <div class="projects-rail" role="group" aria-label="Scratch project gallery"></div>
    <div class="projects-caption">
      <h2 class="projects-current-title" aria-live="polite" aria-atomic="true"></h2>
      <a class="projects-play" href="#projects">
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor"><path d="M2.5 1.25 10 6l-7.5 4.75z"/></svg>
        Play project
      </a>
    </div>
    <div class="projects-navigation">
      <div class="projects-position" aria-label="Gallery position"><span class="projects-current-index"></span><span class="projects-index-slash">/</span><span>${formatIndex(projects.length)}</span></div>
      <div class="projects-controls">
        <button type="button" class="projects-prev" aria-label="Previous project">${arrowIcon(-1)}</button>
        <button type="button" class="projects-next" aria-label="Next project">${arrowIcon(1)}</button>
      </div>
    </div>`;
  rail = root.querySelector(".projects-rail");
  title = root.querySelector(".projects-current-title");
  counter = root.querySelector(".projects-current-index");
  playLink = root.querySelector(".projects-play");
  scratchLink = root.querySelector(".projects-source");
  cards = projects.map((project, index) => {
    // The caption's Play link and Previous/Next buttons provide the same
    // actions for keyboard and assistive technology users.
    const card = document.createElement("div");
    card.className = "projects-card";
    card.setAttribute("aria-hidden", "true");
    const image = new Image(480, 360);
    image.src = project.thumbnail;
    image.alt = "";
    image.draggable = false;
    card.append(image);
    card.addEventListener("click", () => {
      if (performance.now() < suppressClickUntil) return;
      if (activeIndex === index) openPlayer();
      else selectProject(index);
    });
    rail.append(card);
    return card;
  });
  root.querySelector(".projects-prev").addEventListener("click", () => step(-1));
  root.querySelector(".projects-next").addEventListener("click", () => step(1));
  playLink.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openPlayer();
  });
  rail.addEventListener("wheel", onWheel, { passive: false });
  rail.addEventListener("pointerdown", onPointerDown);
  rail.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishPointer);
  window.addEventListener("pointercancel", finishPointer);
  document.addEventListener("keydown", (event) => {
    if (root.hidden || dialog?.open || event.altKey || event.metaKey || event.ctrlKey ||
        event.target.closest("dialog, input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowRight" ? 1 : -1);
    }
  });
}

// Map each project to the nearest slot on a wrapping track. Far cards can
// jump to the opposite end while completely outside the visible rail.
function paintGallery() {
  const count = projects.length;
  cards.forEach((card, index) => {
    const offset = (index - activeIndex + count + Math.floor(count / 2)) % count - Math.floor(count / 2);
    card.style.setProperty("--slot", offset);
    card.style.setProperty("--tilt", `${-Math.sign(offset) * 8}deg`);
    card.dataset.distance = String(Math.min(2, Math.abs(offset)));
    card.dataset.visible = String(Math.abs(offset) <= 2);
  });
  title.textContent = projects[activeIndex].title;
  counter.textContent = formatIndex(activeIndex + 1);
  playLink.href = `${routeFor(activeIndex)}/play`;
  scratchLink.href = projects[activeIndex].url;
}

function selectProject(index) {
  activeIndex = index;
  history.replaceState(history.state, "", routeFor(index));
  paintGallery();
}

function step(direction) {
  selectProject((activeIndex + direction + projects.length) % projects.length);
}

function onWheel(event) {
  if (event.ctrlKey || event.metaKey) return;
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  // On short screens, keep vertical scrolling available for the controls.
  if (!horizontal && !event.shiftKey && document.documentElement.scrollHeight > innerHeight + 2) return;
  const now = performance.now();
  if (now - lastWheel > 160) {
    wheelTotal = 0;
    wheelLocked = false;
  }
  lastWheel = now;
  event.preventDefault();
  if (wheelLocked) return;
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerWidth : 1;
  wheelTotal += (horizontal ? event.deltaX : event.deltaY) * units;
  if (Math.abs(wheelTotal) >= 30) {
    step(Math.sign(wheelTotal));
    wheelLocked = true;
  }
}

function onPointerDown(event) {
  if (!event.isPrimary || event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
}

function onPointerMove(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  const dx = event.clientX - gesture.x;
  if (!gesture.dragging) {
    const dy = event.clientY - gesture.y;
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      gesture = null;
      return;
    }
    if (Math.abs(dx) < 7) return;
    gesture.dragging = true;
    rail.setPointerCapture(event.pointerId);
    rail.classList.add("is-dragging");
  }
  const maxOffset = Math.min(200, innerWidth * 0.3);
  rail.style.setProperty("--drag", `${Math.max(-maxOffset, Math.min(maxOffset, dx))}px`);
}

function finishPointer(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  if (gesture.dragging) {
    suppressClickUntil = performance.now() + 250;
    const dx = event.clientX - gesture.x;
    const threshold = Math.min(60, innerWidth * 0.1);
    if (event.type === "pointerup" && Math.abs(dx) > threshold) step(dx < 0 ? 1 : -1);
  }
  resetGesture();
}

function resetGesture() {
  if (gesture && rail.hasPointerCapture(gesture.id)) rail.releasePointerCapture(gesture.id);
  gesture = null;
  rail?.classList.remove("is-dragging");
  rail?.style.removeProperty("--drag");
}

function openPlayer() {
  // Keep Back meaningful even if the gallery was entered at the short URL.
  if (location.hash !== routeFor(activeIndex)) selectProject(activeIndex);
  pendingPlayer = projects[activeIndex].id;
  location.hash = `${routeFor(activeIndex)}/play`;
}

function closePlayerRoute() {
  if (history.state?.studioPlayerFrom === projects[activeIndex].id) history.back();
  else location.replace(routeFor(activeIndex));
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

export function showProjectView(id, play = false) {
  if (!rail) mountGallery();
  root.hidden = false;
  const index = projects.findIndex((project) => String(project.id) === String(id));
  if (index !== -1) activeIndex = index;
  if (id && index === -1) history.replaceState(history.state, "", routeFor(activeIndex));
  rail.classList.add("is-jumping");
  paintGallery();
  // Direct routes should appear on the selected project on their first frame.
  rail.getBoundingClientRect();
  rail.classList.remove("is-jumping");
  if (play && index !== -1) showPlayer(projects[activeIndex]);
  else removePlayer(true);
}

export function hideProjectView() {
  removePlayer();
  resetGesture();
  pendingPlayer = null;
  root.hidden = true;
}
