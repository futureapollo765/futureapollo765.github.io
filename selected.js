import { favorites, projects } from "./project-data.js";
import { redirectIcon } from "./icons.js";

const svg = path => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>`;
const modulo = (value, limit) => ((value % limit) + limit) % limit;

function projectCard(project, large) {
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
  // Set loading before src so offscreen catalog cards and their loop copies
  // do not eagerly download the entire archive when this section mounts.
  image.loading = "lazy";
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
  action.innerHTML = `<span>Open on Scratch</span>${redirectIcon}`;
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
  original.append(...projects.map(project => projectCard(project, large)));
  track.append(original);
  viewport.append(track);
  viewport.classList.toggle("sf-static", projects.length < 2);

  let width = 0;
  let position = 0;
  let keyboardFocused = false;
  let hovered = false;
  let running = false;
  let carry = 0;
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

  function advance(distance) {
    // The browser can scroll the row when a link receives focus or a
    // trackpad moves. Start from the visible position after either action.
    const actual = viewport.scrollLeft;
    if (Math.abs(actual - position) > 1) position = actual;
    position = width + modulo(position + distance - width, width);
    viewport.scrollLeft = position;
  }

  function move(deltaSeconds) {
    if (!width || down || keyboardFocused || hovered) return;
    // A released drag gradually settles back into this row's own direction.
    const decay = Math.exp(-deltaSeconds / .19);
    advance(speed * deltaSeconds + carry * .19 * (1 - decay));
    carry *= decay;
    if (Math.abs(carry) < 1) carry = 0;
  }

  function setRunning(enabled) {
    running = enabled;
    if (!enabled) carry = 0;
  }

  function updateHover(event, target) {
    // Touch-generated pointer events must not leave a row stuck on hover.
    if (event.pointerType === "touch") return;
    const project = target instanceof Element ? target.closest("a") : null;
    hovered = !!project && viewport.contains(project);
    if (hovered) carry = 0;
  }
  // Delegation also covers the repeated cards used by the seamless loop.
  viewport.addEventListener("pointerover", event => updateHover(event, event.target));
  viewport.addEventListener("pointerout", event => updateHover(event, event.relatedTarget));

  viewport.addEventListener("focusin", event => {
    keyboardFocused = event.target.matches(":focus-visible");
    if (keyboardFocused) carry = 0;
  });
  viewport.addEventListener("focusout", event => {
    if (!viewport.contains(event.relatedTarget)) keyboardFocused = false;
  });
  viewport.addEventListener("keydown", event => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const link = event.target.closest("a");
    if (!link || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    keyboardFocused = true;
    carry = 0;
    const index = Array.from(link.parentElement.children).indexOf(link);
    let next = modulo(index + (event.key === "ArrowLeft" ? -1 : 1), projects.length);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = projects.length - 1;
    const target = original.children[next];
    target.focus({ preventScroll: true });
    const card = target.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    viewport.scrollLeft += card.left + card.width / 2 - frame.left - frame.width / 2;
    position = viewport.scrollLeft;
  });

  viewport.addEventListener("pointerdown", event => {
    if (!width || down || !event.isPrimary || event.button !== 0) return;
    keyboardFocused = false;
    if (event.pointerType === "touch") hovered = false;
    carry = 0;
    suppressClickUntil = 0;
    down = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, time: event.timeStamp, velocity: 0, dragging: false, vertical: false,
    };
  });
  window.addEventListener("pointermove", event => {
    if (down?.id !== event.pointerId || down.vertical) return;
    if (!down.dragging) {
      const dx = Math.abs(event.clientX - down.x);
      const dy = Math.abs(event.clientY - down.y);
      if (Math.max(dx, dy) < 7) return;
      if (dy > dx) {
        down.vertical = true;
        return;
      }
      down.dragging = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-scrubbing");
    }
    const distance = down.lastX - event.clientX;
    const seconds = Math.max(.008, (event.timeStamp - down.time) / 1000);
    const blend = 1 - Math.exp(-seconds / .04);
    down.velocity += (distance / seconds - down.velocity) * blend;
    down.time = event.timeStamp;
    down.lastX = event.clientX;
    advance(distance);
  });

  function release(event) {
    if (down?.id !== event.pointerId) return;
    const gesture = down;
    down = null;
    // Pointer capture retargets hover events while dragging. Use the real
    // release position so a card under the pointer stays still afterward.
    updateHover(event, event.type === "pointerup"
      ? document.elementFromPoint(event.clientX, event.clientY) : null);
    if (gesture.vertical || gesture.dragging) suppressClickUntil = performance.now() + 600;
    if (gesture.dragging) {
      viewport.classList.remove("is-scrubbing");
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (running && !hovered && event.type === "pointerup") {
        const limit = Math.min(1400, viewport.clientWidth * 2.2);
        const velocity = event.timeStamp - gesture.time < 95 ? gesture.velocity : 0;
        carry = Math.max(-limit, Math.min(limit, velocity)) - speed;
      }
    }
  }
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  viewport.addEventListener("lostpointercapture", event => {
    if (event.target === viewport) release(event);
  });
  viewport.addEventListener("click", event => {
    if (event.detail && performance.now() < suppressClickUntil) event.preventDefault();
  });
  viewport.addEventListener("dragstart", event => event.preventDefault());
  new ResizeObserver(measure).observe(viewport);
  measure();
  return { move, setRunning };
}

export function mountSelectedWork() {
  const mount = document.querySelector("[data-selected-work]");
  if (!mount || mount.childElementCount) return;
  if (!favorites.length && !projects.length) {
    mount.closest("section").hidden = true;
    return;
  }

  mount.innerHTML = `
    <div class="sf-heading">
      <div><p class="sf-collection">${favorites.length ? "Scratch favorites" : "Scratch projects"}</p><h2 id="featured-title">Selected work</h2></div>
      <div class="sf-controls">
        <span class="sf-scrub-hint" aria-hidden="true">Drag to browse</span>
        <button type="button" class="sf-pause" aria-label="Pause project rows"></button>
      </div>
    </div>
    <span class="sf-key-help" id="sf-key-help">Use the left and right arrow keys to browse. Enter opens the focused project on Scratch.</span>
    <div class="sf-stage sf-lane" role="group" aria-label="Public Scratch favorites" aria-describedby="sf-key-help" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></div>
    <div class="sf-ribbon sf-lane" role="group" aria-label="Shared Scratch projects, first row" aria-describedby="sf-key-help" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></div>
    <div class="sf-ribbon sf-lane" role="group" aria-label="Shared Scratch projects, second row" aria-describedby="sf-key-help" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></div>`;

  const start = Math.max(0, favorites.findIndex(project => project.id === 1406787990));
  const featured = [...favorites.slice(start), ...favorites.slice(0, start)];
  // Interleave the source catalog between the compact rows. Every public
  // project appears once across these two original groups, in source order.
  const catalogRows = [projects.filter((_, i) => i % 2 === 0), projects.filter((_, i) => i % 2 === 1)];
  const pause = mount.querySelector(".sf-pause");
  const upper = mount.querySelector(".sf-stage");
  const lower = [...mount.querySelectorAll(".sf-ribbon")];
  const lanes = [];
  if (featured.length) lanes.push(makeLane(upper, featured, true, 24));
  else upper.hidden = true;
  // Decreasing scrollLeft moves the cards right; the final row drifts slower.
  catalogRows.forEach((row, i) => {
    if (row.length) lanes.push(makeLane(lower[i], row, false, i ? -24 : -29));
    else lower[i].hidden = true;
  });
  if (![featured, ...catalogRows].some(row => row.length > 1)) {
    mount.classList.add("sf-static-collection");
    return;
  }

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
    const label = globalPause ? "Automatic movement is paused" : paused ? "Resume project rows" : "Pause project rows";
    if (pause.title !== label) {
      pause.title = label;
      pause.setAttribute("aria-label", label);
      pause.innerHTML = svg(paused || globalPause ? "m8 5 11 7-11 7z" : "M9 5v14m6-14v14");
    }
    pause.disabled = globalPause;
    const running = inView && !document.hidden && !paused && !globalPause;
    lanes.forEach(lane => lane.setRunning(running));
    if (!running) {
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
