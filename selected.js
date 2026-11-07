import { favorites } from "./project-data.js";

const svg = path => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>`;
const launchIcon = svg("M6 18 18 6M7 6h11v11");
const modulo = (value, limit) => ((value % limit) + limit) % limit;

function favoriteCard(project, large) {
  const link = document.createElement("a");
  link.className = large ? "sf-poster" : "sf-tile";
  link.href = project.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.draggable = false;
  link.setAttribute("aria-label", `Open ${project.title}${project.author ? ` by ${project.author}` : ""} on Scratch`);

  const art = document.createElement("span");
  art.className = "sf-art";
  const image = new Image(480, 360);
  image.src = new URL(project.thumbnail, import.meta.url);
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  art.append(image);
  link.append(art);

  const caption = document.createElement("span");
  caption.className = "sf-caption";
  const title = document.createElement("span");
  title.className = "sf-title";
  title.textContent = project.title;
  caption.append(title);
  if (large && project.author) {
    const author = document.createElement("span");
    author.className = "sf-author";
    author.textContent = `By ${project.author}`;
    caption.append(author);
  }
  const action = document.createElement("span");
  action.className = "sf-open";
  action.innerHTML = `<span>Open on Scratch</span>${launchIcon}`;
  link.append(caption, action);
  return link;
}

function repeatedGroup(original) {
  const copy = original.cloneNode(true);
  copy.setAttribute("aria-hidden", "true");
  for (const link of copy.querySelectorAll("a")) link.tabIndex = -1;
  return copy;
}

function makeLane(viewport, projects, large, speed) {
  const track = document.createElement("div");
  track.className = "sf-runner";
  const original = document.createElement("div");
  original.className = "sf-group";
  original.append(...projects.map(project => favoriteCard(project, large)));
  track.append(original);
  viewport.append(track);

  let width = 0;
  let position = 0;
  let keyboardFocused = false;
  let down = null;
  let suppressClickUntil = 0;

  function measure() {
    const nextWidth = original.getBoundingClientRect().width;
    if (!viewport.clientWidth || !nextWidth || projects.length < 2) return;
    const phase = width ? modulo(position, width) / width : 0;
    width = nextWidth;
    // One period on the left and enough copies on the right cover the viewport
    // at both ends of the wrap, including when only two projects are available.
    const copies = 2 + Math.ceil(viewport.clientWidth / width);
    if (track.children.length !== copies) {
      if (track.firstElementChild === original) track.prepend(repeatedGroup(original));
      while (track.children.length < copies) track.append(repeatedGroup(original));
      while (track.children.length > copies) track.lastElementChild.remove();
    }
    position = width * (1 + phase);
    viewport.scrollLeft = position;
  }

  function move(deltaSeconds) {
    if (!width || keyboardFocused) return;
    // Native focus scrolling and touch browsing can change the starting point.
    const actual = viewport.scrollLeft;
    if (Math.abs(actual - position) > 1) position = actual;
    position = width + modulo(position + speed * deltaSeconds - width, width);
    viewport.scrollLeft = position;
  }

  viewport.addEventListener("focusin", event => {
    keyboardFocused = event.target.matches(":focus-visible");
  });
  viewport.addEventListener("focusout", event => {
    if (!viewport.contains(event.relatedTarget)) keyboardFocused = false;
  });
  viewport.addEventListener("keydown", () => { keyboardFocused = true; });
  viewport.addEventListener("pointerdown", event => {
    keyboardFocused = false;
    suppressClickUntil = 0;
    down = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  });
  viewport.addEventListener("pointermove", event => {
    if (down?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) {
      down.dragged = true;
    }
  });
  viewport.addEventListener("pointerup", event => {
    if (down?.id !== event.pointerId) return;
    if (down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) {
      suppressClickUntil = performance.now() + 600;
    }
    down = null;
  });
  viewport.addEventListener("pointercancel", () => { down = null; });
  viewport.addEventListener("click", event => {
    if (event.detail && performance.now() < suppressClickUntil) event.preventDefault();
  });
  viewport.addEventListener("dragstart", event => event.preventDefault());
  new ResizeObserver(measure).observe(viewport);
  measure();
  return { move };
}

export function mountSelectedWork() {
  const mount = document.querySelector("[data-selected-work]");
  if (!mount || mount.childElementCount) return;
  if (!favorites.length) {
    mount.closest("section").hidden = true;
    return;
  }

  mount.innerHTML = `
    <div class="sf-heading">
      <div><p class="sf-collection">Scratch favorites</p><h2 id="featured-title">Selected work</h2></div>
      <button type="button" class="sf-pause" aria-label="Pause favorites"></button>
    </div>
    <div class="sf-stage sf-lane" role="group" aria-label="Featured favorites"></div>
    <div class="sf-ribbon sf-lane" role="group" aria-label="More favorite projects on Scratch"></div>`;

  const start = Math.max(0, favorites.findIndex(project => project.id === 1406787990));
  const featured = [...favorites.slice(start), ...favorites.slice(0, start)];
  const split = Math.ceil(favorites.length / 2);
  const ribbon = [...favorites.slice(split), ...favorites.slice(0, split)];
  const pause = mount.querySelector(".sf-pause");
  const lower = mount.querySelector(".sf-ribbon");
  const lanes = [makeLane(mount.querySelector(".sf-stage"), featured, true, 24)];
  if (favorites.length === 1) {
    mount.classList.add("sf-single");
    lower.hidden = true;
    pause.hidden = true;
    return;
  }
  lanes.push(makeLane(lower, ribbon, false, -33));

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let inView = false;
  let paused = false;
  let frame = 0;
  let lastTime = 0;

  function animate(time) {
    const delta = Math.min(100, Math.max(0, time - lastTime)) / 1000;
    lastTime = time;
    for (const lane of lanes) lane.move(delta);
    frame = requestAnimationFrame(animate);
  }

  function sync() {
    const globalPause = document.documentElement.classList.contains("motion-paused") || reduced.matches;
    const label = globalPause ? "Automatic movement is paused" : paused ? "Resume favorites" : "Pause favorites";
    if (pause.title !== label) {
      pause.title = label;
      pause.setAttribute("aria-label", label);
      pause.innerHTML = svg(paused || globalPause ? "m8 5 11 7-11 7z" : "M9 5v14m6-14v14");
    }
    pause.disabled = globalPause;
    if (!inView || document.hidden || paused || globalPause) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  pause.addEventListener("click", () => { paused = !paused; sync(); });
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(mount);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
}
