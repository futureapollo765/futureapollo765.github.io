// Scroll the document itself; pinned scenes, the scrollbar, and browser history
// always see the real position. The browser owns the final glide, so another
// scroll request can take over without a JavaScript animation competing with it.
let cancelMounted = null;

export function mountScrollMotion(constrainTarget) {
  const home = document.querySelector("#home-view");
  const root = document.scrollingElement;
  if (cancelMounted) return cancelMounted;
  if (!home || !root || !CSS.supports("scroll-behavior", "smooth")) return () => {};

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let direction = 0;
  let position = 0;
  let target = 0;
  let velocity = 0;
  let observed = 0;
  let previousTime = 0;

  function release() {
    direction = 0;
    velocity = 0;
  }

  function interrupt() {
    if (direction) window.scrollTo({top:window.scrollY, behavior:"instant"});
    release();
  }

  function available() {
    return !home.hidden && !document.hidden && !reduce.matches &&
      !document.documentElement.classList.contains("motion-paused") &&
      location.hash.split("/")[0] !== "#projects";
  }

  function anotherScrollOwner(event) {
    for (const node of event.composedPath()) {
      if (node === root || node === document.body) break;
      if (!(node instanceof Element)) continue;
      if (node.matches("input, select, textarea, iframe, video, audio, dialog, .sf-lane, .projects-map") || node.isContentEditable) return true;
      const style = getComputedStyle(node);
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) {
        // This one strip explicitly maps page Y to image X when pinned.
        // Preserve native horizontal swipes and let page Y have vertical ones.
        const verticalTimeline = node.matches(".tl-pinned .tl-window") && Math.abs(event.deltaX) < .2 * Math.abs(event.deltaY);
        if (!verticalTimeline) return true;
      }
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) return true;
    }
    return false;
  }

  function wheel(event) {
    if (!available() || document.querySelector("dialog[open]")) { release(); return; }
    if (event.defaultPrevented || !event.cancelable || event.buttons ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || anotherScrollOwner(event)) {
      interrupt();
      return;
    }
    const actual = window.scrollY;
    const limit = Math.max(0, root.scrollHeight - root.clientHeight);
    if (actual < 0 || actual > limit || !limit) { release(); return; }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
    const now = performance.now();
    const raw = Math.abs(event.deltaY);
    const precise = event.deltaMode === 0 && (raw < 52 || event.deltaX !== 0 ||
      !Number.isInteger(raw) || (now - previousTime < 38 && raw % 100 !== 0 && raw % 120 !== 0));
    const delta = event.deltaY * unit * (precise ? .72 : .82);
    if (!Number.isFinite(delta)) return;

    const sign = Math.sign(delta);
    const fresh = sign !== direction || now - previousTime > 550 ||
      (actual - observed) * sign < -.5 || (actual - target) * sign > .5;
    let nextPosition = actual;
    if (fresh) {
      // Reverse at the visible position, dropping the undelivered old impulse.
      target = actual;
      velocity = 0;
      if (!direction) nextPosition += sign * Math.min(5, Math.abs(delta) * .025);
    } else {
      // Retargeting native smooth scrolling on every trackpad sample can keep
      // restarting its first frame. Integrate the critically damped spring
      // through the actual elapsed time, then let the compositor carry the tail.
      const dt = (now - previousTime) / 1000;
      const rate = precise ? 10 : 13;
      const offset = position - target;
      const slope = velocity + rate * offset;
      const decay = Math.exp(-rate * dt);
      const integrated = target + (offset + slope * dt) * decay;
      velocity = (velocity - rate * slope * dt) * decay;
      if ((integrated - actual) * sign > .5) nextPosition = integrated;
    }

    const proposed = Math.max(0, Math.min(limit, target + delta));
    const adjusted = constrainTarget?.(proposed, actual, now);
    const destination = Number.isFinite(adjusted) ? Math.max(0, Math.min(limit, adjusted)) : proposed;
    if (Math.abs(destination - actual) < .01) {
      // At a scene boundary, later events in this burst must not pass through
      // and move the page beyond the allowed station. Natural document edges
      // retain their ordinary browser behavior.
      if (destination !== proposed) event.preventDefault();
      interrupt();
      return;
    }

    event.preventDefault();
    previousTime = now;
    direction = sign;
    position = Math.min(Math.max(nextPosition, Math.min(actual, destination)), Math.max(actual, destination));
    if (position !== actual) window.scrollTo({top:position, behavior:"instant"});
    observed = window.scrollY;
    target = destination;
    window.scrollTo({top:target, behavior:"smooth"});
  }

  // Keep the document-level nonpassive wheel listener off the map and off
  // motion-disabled pages. Other input only relinquishes a live wheel gesture.
  function configure() {
    window.removeEventListener("wheel", wheel);
    if (available()) {
      window.addEventListener("wheel", wheel, {passive:false});
    }
  }
  window.addEventListener("scroll", () => {
    if (!direction) return;
    const actual = window.scrollY;
    if ((actual - observed) * direction < -.5 || (actual - target) * direction >= -.5) release();
    observed = actual;
  }, {passive:true});
  // Relinquish ownership before controls and native navigation take effect.
  for (const event of ["pointerdown", "touchstart", "keydown", "focusin", "click"]) {
    window.addEventListener(event, interrupt, {capture:true, passive:true});
  }
  for (const event of ["hashchange", "popstate", "pagehide", "pageshow"]) {
    window.addEventListener(event, () => { interrupt(); configure(); });
  }
  window.addEventListener("resize", release);
  function settingsChanged() {
    interrupt();
    configure();
  }
  window.addEventListener("studio-motion", settingsChanged);
  document.addEventListener("visibilitychange", settingsChanged);
  reduce.addEventListener("change", settingsChanged);
  new MutationObserver(configure).observe(home, {attributes:true, attributeFilter:["hidden"]});
  configure();
  cancelMounted = interrupt;
  return interrupt;
}
