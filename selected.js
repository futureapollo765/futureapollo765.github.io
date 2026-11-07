import { favorites } from "./project-data.js";

const icon = (path) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>`;
const previousIcon = icon("m14.5 5-7 7 7 7");
const nextIcon = icon("m9.5 5 7 7-7 7");
const launchIcon = icon("M6 18 18 6M7 6h11v11");

function artwork(project) {
  const image = new Image(480, 360);
  image.src = new URL(project.thumbnail, import.meta.url);
  image.alt = "";
  image.draggable = false;
  image.decoding = "async";
  return image;
}

function scratchLink(project) {
  const link = document.createElement("a");
  link.href = project.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
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
      <div class="sf-heading-type">
        <p class="sf-collection">Scratch favorites</p>
        <h2 id="featured-title">Selected work</h2>
      </div>
      <div class="sf-controls">
        <button type="button" data-previous aria-label="Previous favorite">${previousIcon}</button>
        <button type="button" data-next aria-label="Next favorite">${nextIcon}</button>
        <button type="button" data-pause aria-label="Pause favorites"></button>
      </div>
    </div>
    <div class="sf-stage" role="group" aria-label="Featured favorite"></div>
    <p class="sf-announcement" aria-live="polite" aria-atomic="true"></p>
    <div class="sf-ribbon" role="group" aria-label="Favorite projects on Scratch">
      <div class="sf-runner"></div>
    </div>`;

  const stage = mount.querySelector(".sf-stage");
  const ribbon = mount.querySelector(".sf-ribbon");
  const runner = mount.querySelector(".sf-runner");
  const announcement = mount.querySelector(".sf-announcement");
  const pauseButton = mount.querySelector("[data-pause]");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let inView = false;
  let hovering = false;
  let touching = false;
  let focused = false;
  let paused = false;
  let frame = 0;
  let previousTime = 0;
  let advanceAfter = 0;
  let position = 0;
  let groupWidth = 0;
  let gesture = null;

  const posters = favorites.map((project, index) => {
    const card = document.createElement("article");
    card.className = "sf-poster";
    const image = artwork(project);
    image.className = "sf-image";
    const background = image.cloneNode();
    background.className = "sf-backdrop";
    const caption = document.createElement("div");
    caption.className = "sf-caption";
    caption.innerHTML = '<div class="sf-label"><h3></h3></div>';
    caption.querySelector("h3").textContent = project.title;
    if (project.author) {
      const author = document.createElement("p");
      author.textContent = `By ${project.author}`;
      caption.firstElementChild.append(author);
    }
    const open = scratchLink(project);
    open.className = "sf-open";
    open.innerHTML = `Open on Scratch ${launchIcon}`;
    caption.append(open);
    card.append(background, image, caption);
    card.addEventListener("click", () => {
      if (index !== active) select(index, true);
    });
    stage.append(card);
    return card;
  });

  // Only the middle copy participates in keyboard and screen-reader navigation.
  const makeGroup = (duplicate) => {
    const group = document.createElement("div");
    group.className = "sf-group";
    if (duplicate) group.setAttribute("aria-hidden", "true");
    for (const project of favorites) {
      const tile = scratchLink(project);
      tile.className = "sf-tile";
      tile.setAttribute("aria-label", `Open ${project.title} on Scratch`);
      if (duplicate) tile.tabIndex = -1;
      const label = document.createElement("span");
      label.className = "sf-tile-label";
      label.textContent = project.title;
      const action = document.createElement("span");
      action.className = "sf-tile-action";
      action.innerHTML = launchIcon;
      tile.append(artwork(project), label, action);
      group.append(tile);
    }
    return group;
  };
  const original = makeGroup(false);
  runner.append(makeGroup(true), original, makeGroup(true));

  function select(index, announce = false) {
    active = (index + posters.length) % posters.length;
    const half = Math.floor(posters.length / 2);
    posters.forEach((poster, i) => {
      const slot = (i - active + posters.length + half) % posters.length - half;
      poster.style.setProperty("--sf-slot", slot);
      poster.dataset.slot = Math.abs(slot) <= 1 ? String(slot) : "far";
      poster.setAttribute("aria-hidden", String(i !== active));
      poster.querySelector("a").tabIndex = i === active ? 0 : -1;
    });
    if (announce) announcement.textContent = favorites[active].title;
    advanceAfter = 0;
  }

  function measure() {
    groupWidth = original.offsetWidth;
    const fits = groupWidth <= ribbon.clientWidth;
    ribbon.classList.toggle("sf-fits", fits);
    position = fits ? 0 : groupWidth;
    ribbon.scrollLeft = position;
  }

  function animate(time) {
    frame = 0;
    const delta = previousTime ? Math.min(time - previousTime, 64) : 0;
    previousTime = time;
    advanceAfter += delta;
    if (advanceAfter >= 5200) select(active + 1);

    if (groupWidth > ribbon.clientWidth) {
      position += delta * 0.034;
      if (position >= groupWidth * 2) position -= groupWidth;
      ribbon.scrollLeft = position;
    }
    frame = requestAnimationFrame(animate);
  }

  function syncMotion() {
    const globalPause = document.documentElement.classList.contains("motion-paused") || reducedMotion.matches;
    const userPaused = paused || globalPause;
    pauseButton.disabled = globalPause || posters.length < 2;
    const label = globalPause ? "Automatic movement is paused" : userPaused ? "Resume favorites" : "Pause favorites";
    if (!pauseButton.firstElementChild || label !== pauseButton.getAttribute("aria-label")) {
      pauseButton.setAttribute("aria-label", label);
      pauseButton.title = label;
      pauseButton.innerHTML = userPaused ? icon("m8 5 11 7-11 7z") : icon("M9 5v14m6-14v14");
    }
    const running = inView && !document.hidden && !userPaused && !hovering && !focused && !touching && posters.length > 1;
    if (!running) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
    } else if (!frame) {
      position = ribbon.scrollLeft;
      if (groupWidth > ribbon.clientWidth && position < groupWidth) position += groupWidth;
      frame = requestAnimationFrame(animate);
    }
  }

  const featured = favorites.findIndex(project => project.id === 1406787990);
  select(featured < 0 ? 0 : featured);
  for (const button of mount.querySelectorAll("[data-previous], [data-next]")) {
    button.disabled = posters.length < 2;
    button.addEventListener("click", () => select(active + (button.hasAttribute("data-next") ? 1 : -1), true));
  }
  pauseButton.addEventListener("click", () => { paused = !paused; syncMotion(); });
  mount.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const fromPoster = stage.contains(document.activeElement);
    select(active + (event.key === "ArrowRight" ? 1 : -1), true);
    if (fromPoster) posters[active].querySelector("a").focus({ preventScroll: true });
  });
  mount.addEventListener("pointerenter", event => {
    if (event.pointerType === "mouse") { hovering = true; syncMotion(); }
  });
  mount.addEventListener("pointerleave", () => { hovering = false; syncMotion(); });
  mount.addEventListener("focusin", () => { focused = true; syncMotion(); });
  mount.addEventListener("focusout", event => {
    focused = mount.contains(event.relatedTarget);
    syncMotion();
  });

  // The ribbon uses native scrolling, while the larger posters support swiping.
  stage.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  stage.addEventListener("pointerup", event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture = null;
    if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy)) select(active + (dx < 0 ? 1 : -1), true);
  });
  stage.addEventListener("pointercancel", () => { gesture = null; });
  mount.addEventListener("touchstart", () => { touching = true; syncMotion(); }, { passive: true });
  const endTouch = () => { touching = false; syncMotion(); };
  mount.addEventListener("touchend", endTouch, { passive: true });
  mount.addEventListener("touchcancel", endTouch, { passive: true });

  new ResizeObserver(measure).observe(ribbon);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncMotion();
  }, { threshold: 0.1 }).observe(mount);
  new MutationObserver(syncMotion).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  reducedMotion.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", syncMotion);
  syncMotion();
}
