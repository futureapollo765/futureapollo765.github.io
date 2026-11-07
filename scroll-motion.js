// One animation owns wheel smoothing and writes the real document position.
// Never mix a native smooth-scroll tail with competing instant frame updates.
let cancelMounted = null;

export function interruptScrollMotion() {
  cancelMounted?.();
}

export function mountScrollMotion() {
  const home = document.querySelector("#home-view");
  const root = document.scrollingElement;
  if (cancelMounted) return cancelMounted;
  if (!home || !root) return () => {};

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let direction = 0;
  let position = 0;
  let target = 0;
  let velocity = 0;
  let observed = 0;
  let previousTime = 0;
  let previousFrame = 0;
  let frame = 0;
  let rate = 10;

  function interrupt() {
    cancelAnimationFrame(frame);
    frame = 0;
    direction = velocity = 0;
    position = target = observed = window.scrollY;
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

  function animate(now) {
    // Readback identifies our own asynchronous scroll events; it never feeds
    // browser rounding back into the floating-point spring on the next frame.
    if (!available() || document.querySelector("dialog[open]") || Math.abs(window.scrollY-observed)>1) {
      interrupt();
      return;
    }
    const limit=Math.max(0,root.scrollHeight-root.clientHeight);
    target=Math.max(0,Math.min(limit,target));
    position=Math.max(0,Math.min(limit,position));
    const dt=Math.max(0,(now-previousFrame)/1000);
    previousFrame=now;
    const offset=position-target, slope=velocity+rate*offset, decay=Math.exp(-rate*dt);
    const next=target+(offset+slope*dt)*decay;
    velocity=(velocity-rate*slope*dt)*decay;
    // Rate changes and browser edge rounding must never move against input.
    const bounded=Math.max(Math.min(position,target),Math.min(Math.max(position,target),next));
    if (bounded!==next) velocity=0;
    position=bounded;
    // Keep fractional trackpad samples accumulating throughout a gesture,
    // including samples too small to change a rounded scrollY individually.
    const settled=Math.abs(target-position)<.1 && Math.abs(velocity)<1 && now-previousTime>=100;
    if (settled) position=target;
    window.scrollTo({top:position,behavior:"instant"});
    observed=window.scrollY;
    if (settled) { frame=0; direction=velocity=0; }
    else frame=requestAnimationFrame(animate);
  }

  function wheel(event) {
    if (!available() || document.querySelector("dialog[open]")) { interrupt(); return; }
    if (event.defaultPrevented || event.buttons ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      anotherScrollOwner(event)) {
      interrupt();
      return;
    }
    // Empty end-of-gesture notifications carry no new input. Let the spring
    // finish its damping tail instead of truncating the remaining travel.
    if (event.deltaX === 0 && event.deltaY === 0) return;
    if (!event.cancelable || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      interrupt();
      return;
    }
    const actual = window.scrollY;
    const limit = Math.max(0, root.scrollHeight - root.clientHeight);
    if (actual < 0 || actual > limit || !limit) { interrupt(); return; }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
    const now = performance.now();
    const raw = Math.abs(event.deltaY);
    const precise = event.deltaMode === 0 && (raw < 52 || event.deltaX !== 0 ||
      !Number.isInteger(raw) || (now - previousTime < 38 && raw % 100 !== 0 && raw % 120 !== 0));
    const delta = event.deltaY * unit * (precise ? .72 : .82);
    if (!Number.isFinite(delta)) return;

    const sign = Math.sign(delta);
    const fresh = !frame || sign !== direction || now-previousTime>550 || Math.abs(actual-observed)>1;
    if (fresh) {
      // Cancel any one-shot native glide (for example a section link) once,
      // then let this RAF be the sole owner. Reversal drops the old impulse.
      window.scrollTo({top:actual,behavior:"instant"});
      position = target = observed = window.scrollY;
      velocity = 0;
      previousFrame=now;
    }

    // Document position selects the index station. Presentation animations
    // must never clamp wheel travel or build a queue of skipped stages.
    const destination = Math.max(0, Math.min(limit, target + delta));
    if (Math.abs(destination - actual) < .01) {
      // Natural document edges retain their ordinary browser behavior.
      interrupt();
      return;
    }

    event.preventDefault();
    previousTime = now;
    direction = sign;
    rate=precise ? 10 : 13;
    target = destination;
    if (!frame) frame=requestAnimationFrame(animate);
  }

  // Keep the document-level nonpassive wheel listener off the map and off
  // motion-disabled pages. Other input only relinquishes a live wheel gesture.
  function configure() {
    window.removeEventListener("wheel", wheel);
    if (available()) {
      window.addEventListener("wheel", wheel, {passive:false});
    } else interrupt();
  }
  window.addEventListener("scroll", () => {
    if (frame && Math.abs(window.scrollY-observed)>1) interrupt();
  }, {passive:true});
  // Physical input takes ownership before controls and native navigation.
  // A reading scene may hand off focus with preventScroll as its old note
  // fades; that programmatic focus change must not cancel the wheel glide.
  for (const event of ["pointerdown", "touchstart", "keydown", "click"]) {
    window.addEventListener(event, interrupt, {capture:true, passive:true});
  }
  for (const event of ["hashchange", "popstate", "pagehide", "pageshow"]) {
    window.addEventListener(event, () => { interrupt(); configure(); });
  }
  window.addEventListener("resize", interrupt);
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
