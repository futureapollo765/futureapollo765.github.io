// Preserve the selected sheet across Home ↔ project. Capture the source before
// the router changes layout; measure the destination after it restores scroll.
let flight = null;
let movingImage = null;
function stopIndexFlight() { flight?.(); }
const home = document.querySelector("#home-view");
const indexLink = home.querySelector("[data-index-link]");
const plate = home.querySelector(".index-image-window");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
function visibleBox(element) {
  const box = element?.getBoundingClientRect();
  if (box?.width && box.height && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight) return box;
}

export function captureIndexFlight(key) {
  // If Back/Forward interrupts the flight, turn around from this frame.
  const interrupted = movingImage && { src:movingImage.currentSrc, box:movingImage.getBoundingClientRect() };
  stopIndexFlight();
  if (document.hidden || reduce.matches || document.documentElement.classList.contains("motion-paused") || !Element.prototype.animate) return null;
  const detail = document.querySelector(".projects-detail-image");
  const fromIndex = key.startsWith("project/") && !home.hidden &&
    home.querySelector(".is-inspecting") && indexLink.hash === "#projects/" + key.slice(8);
  const returning = key === "home" && home.hidden && history.state?.studioHome?.index >= 0 &&
    detail && !detail.closest("[hidden]") && !document.querySelector("dialog[open]");
  if (!fromIndex && !returning) return null;
  const source = fromIndex ? plate.lastElementChild : detail;
  const from = interrupted && interrupted.src === source?.currentSrc ? interrupted.box : visibleBox(source);
  if (!from || !source.complete || !source.naturalWidth) return null;
  const image = source.cloneNode(false);
  const sourceURL = source.currentSrc;
  image.alt = ""; image.removeAttribute("id"); image.removeAttribute("style");
  image.className = "index-flight";
  return () => {
    const target = fromIndex ? document.querySelector(".projects-detail-image") : plate.lastElementChild;
    const to = visibleBox(target);
    // History may lead to a different Home entry or a different catalog item.
    if (!to || target.src !== sourceURL) return;
    movingImage = image;
    document.body.append(image);
    image.style.cssText = 'left:'+to.x+'px;top:'+to.y+'px;width:'+to.width+'px;height:'+to.height+'px';
    target.style.visibility = "hidden";
    const transform = 'translate('+ (from.x-to.x)+'px,'+ (from.y-to.y)+'px) scale('+ (from.width/to.width)+','+(from.height/to.height)+')';
    const fx = image.animate([{transform},{transform:"none"}],
      {duration:430,easing:"cubic-bezier(.19,.72,.18,1)"});
    const clear = () => {
      fx.onfinish = fx.oncancel = null; fx.cancel();
      target.style.removeProperty("visibility"); image.remove();
      flight = movingImage = null;
    };
    fx.onfinish = fx.oncancel = flight = clear;
  };
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopIndexFlight(); });
window.addEventListener("studio-motion", event => { if (!event.detail) stopIndexFlight(); });
reduce.addEventListener("change", () => { if (reduce.matches) stopIndexFlight(); });
window.addEventListener("resize", stopIndexFlight);
