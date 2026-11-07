import { projects } from "./project-data.js";

// The index previews the current catalog in Scratch's own order. Choosing a
// station never navigates; only the cover, its link, or Map leaves the scene.
export function mountProjectIndex(stage) {
  const entries = projects.slice(0, 6);
  const panel = stage.querySelector(".index-panel");
  if (!entries.length) {
    panel.hidden = true;
    stage.querySelector(".index-legend").hidden = true;
    return null;
  }
  const choices = stage.querySelector(".deck-choices");
  const deck = stage.querySelector(".project-deck");
  const copy = stage.querySelector(".hero-copy");
  const instrument = stage.querySelector(".instrument");
  const count = panel.querySelector("[data-index-count]");
  const title = panel.querySelector("[data-index-title]");
  const link = panel.querySelector("[data-index-link]");
  const cover = panel.querySelector("[data-index-cover]");
  const windowEl = cover.querySelector(".index-image-window");
  const plateNumber = cover.querySelector("[data-plate-number]");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const fmt = n => String(n).padStart(2, "0");
  choices.style.setProperty("--stations", String(entries.length + 1));
  const measure = document.createElement("canvas").getContext("2d");
  let displayed = -1, shown = false, pinned = null, preview = null, scrollIndex = false;
  let active = null;
  const images = [];
  let hoverTimer, swipe = null;

  function canAnimate() {
    return !document.documentElement.classList.contains("motion-paused") &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function fitTitle() {
    const available = title.clientWidth;
    if (!title.textContent || !available || !measure) return;
    title.style.removeProperty("font-size");
    const style = getComputedStyle(title);
    const base = parseFloat(style.fontSize);
    measure.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
    const longest = Math.max(...title.textContent.split(/\s+/u).map(word =>
      measure.measureText(word).width + Math.max(0, word.length-1) * (parseFloat(style.letterSpacing) || 0)));
    if (longest > available) title.style.fontSize = (base * available / longest * .985) + "px";
  }
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    if (lastWidth !== entry.contentRect.width) { lastWidth = entry.contentRect.width; fitTitle(); }
  }).observe(panel.querySelector(".index-copy"));
  document.fonts?.ready.then(fitTitle);

  function draw(index) {
    const project = entries[index];
    const previous = displayed;
    displayed = index;
    count.textContent = fmt(index + 1) + " / " + fmt(entries.length);
    plateNumber.textContent = fmt(index + 1);
    title.textContent = project.title;
    title.classList.toggle("index-title-long", project.title.length > 18);
    fitTitle();
    link.href = cover.href = "#projects/" + project.id;
    link.setAttribute("aria-label", "Open " + project.title);
    const image = images[index];
    const old = windowEl.lastElementChild;
    windowEl.replaceChildren(image);
    if (previous < 0 || previous === index || !shown || !canAnimate()) return;
    const direction = index > previous ? 1 : -1;
    // Keep the old cover under the incoming sheet, so rapid reversals never
    // expose a blank stage or finish an obsolete animation over a newer pick.
    if (old && old !== image) {
      old.getAnimations().forEach(fx => fx.cancel());
      windowEl.prepend(old);
    }
    const fx = image.animate([
      {clipPath: direction > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", transform: "scale(1.045)"},
      {clipPath:"inset(0)", transform:"none"}
    ], {duration:330, easing:"cubic-bezier(.2,.75,.2,1)"});
    const removeOld = () => { if (old && old !== windowEl.lastElementChild) old.remove(); };
    fx.onfinish = fx.oncancel = removeOld;
    title.animate([{opacity:.38, transform:`translateX(${direction * 10}px)`},{opacity:1,transform:"none"}],
      {duration:240, easing:"ease-out"});
  }

  function update() {
    const index = preview ?? pinned ?? (scrollIndex ? Math.max(displayed, 0) : -1);
    if (index === active) return;
    active = index;
    const visible = index >= 0;
    if (visible && index !== displayed) draw(index);
    shown = visible;
    stage.classList.toggle("is-inspecting", visible);
    panel.inert = !visible;
    copy.inert = instrument.inert = visible;
    choices.style.setProperty("--active-slot", index + 1);
    choices.querySelectorAll("button").forEach((button, i) => {
      const selected = index === i - 1;
      button.setAttribute("aria-pressed", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function choose(i, moveFocus = false) {
    clearTimeout(hoverTimer);
    pinned = i; preview = null;
    update();
    const button = choices.children[i + 1];
    if (moveFocus) button.focus({preventScroll:true});
    if (choices.scrollWidth > choices.clientWidth) {
      const start = button.offsetLeft, end = start + button.offsetWidth;
      if (start < choices.scrollLeft) choices.scrollLeft = start;
      else if (end > choices.scrollLeft + choices.clientWidth) choices.scrollLeft = end - choices.clientWidth;
    }
    // At the very end of the pinned scene, the ruler can still be visible
    // after the title has rolled beneath the header. Bring the chosen sheet
    // back into view; a hover alone must never move the page.
    const clipped = stage.getBoundingClientRect().top - document.querySelector(".site-header").offsetHeight;
    if (clipped < -1) window.scrollBy({top:clipped, behavior:"instant"});
  }

  for (const [i, item] of [null, ...entries].entries()) {
    const index = i - 1;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", item ? "Preview " + item.title : "Show orbital assembly");
    const number = document.createElement("span");
    number.className = "deck-number";
    number.textContent = item ? fmt(i) : "◎";
    const label = document.createElement("span");
    label.className = "deck-label";
    label.textContent = item?.title ?? "Orbit";
    button.append(number, label); choices.append(button);
    button.addEventListener("click", () => choose(index));
    button.addEventListener("pointerenter", event => {
      if (!fine.matches || event.pointerType === "touch" || choices.contains(document.activeElement) && document.activeElement.matches(":focus-visible") || panel.contains(document.activeElement)) return;
      clearTimeout(hoverTimer);
      // Cross the ruler freely. Only a deliberate hover changes the plate.
      hoverTimer = setTimeout(() => { preview = index; update(); }, 110);
    });
    button.addEventListener("pointerleave", () => clearTimeout(hoverTimer));
    if (item) {
      const image = new Image(); image.alt = ""; image.draggable = false;
      image.decoding = "async"; image.src = item.thumbnail; images.push(image);
    }
  }
  choices.addEventListener("keydown", event => {
    const i = [...choices.children].indexOf(event.target);
    if (i < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" && i && shown && displayed === i - 1) {
      event.preventDefault();
      link.click();
      return;
    }
    const n = choices.children.length;
    const next = {ArrowRight:(i + 1) % n, ArrowLeft:(i+n-1) % n, Home:0, End:n-1}[event.key];
    if (next === undefined) return;
    event.preventDefault(); choose(next - 1, true);
  });
  // A hover selection remains available when moving from the ruler to its
  // cover or Open link. Return to the scroll-selected scene on leaving it.
  stage.addEventListener("pointerleave", () => {
    clearTimeout(hoverTimer);
    if (panel.contains(document.activeElement)) return;
    preview = null; update();
  });
  // The displayed cover is also a directly scrubbable stack on a phone.
  cover.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    swipe = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
  });
  cover.addEventListener("dragstart", event => event.preventDefault());
  cover.addEventListener("pointermove", event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (!swipe.moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) < Math.abs(dy)) { swipe = null; return; }
      swipe.moved = true; cover.setPointerCapture(event.pointerId);
    }
    if (canAnimate()) windowEl.style.setProperty("--scrub", Math.max(-22, Math.min(22, dx*.18))+"px");
  });
  let cancelClick = false;
  function endSwipe(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    cancelClick = swipe.moved && event.type === "pointerup";
    if (cancelClick && Math.abs(dx) > 30) choose((displayed + (dx < 0 ? 1 : -1) + entries.length) % entries.length);
    swipe = null; windowEl.style.removeProperty("--scrub");
  }
  cover.addEventListener("pointerup",endSwipe);
  cover.addEventListener("pointercancel",endSwipe);
  cover.addEventListener("pointerdown",() => { cancelClick = false; });
  cover.addEventListener("click",event => { if (cancelClick) {event.preventDefault(); cancelClick = false;} });
  deck.hidden = false;
  update();

  return {
    travel(next) {
      const was = scrollIndex;
      if (next > .43) scrollIndex = true;
      if (next < .30) scrollIndex = false;
      if (was !== scrollIndex) {
        pinned = null;
        // Do not hide a keyboard-focused control when the visitor scrolls.
        if (panel.contains(document.activeElement) && !scrollIndex) pinned = displayed;
        if ((copy.contains(document.activeElement) || instrument.contains(document.activeElement)) && scrollIndex) pinned = -1;
        preview = null;
      }
      update();
    },
    snapshot() { return {index:shown ? displayed : -1}; },
    restore(state) {
      preview = null; pinned = state && Number.isInteger(state.index) ? Math.max(-1,Math.min(entries.length-1,state.index)) : null;
      if (!state) { scrollIndex = false; displayed = -1; }
      update();
    }
  };
}
