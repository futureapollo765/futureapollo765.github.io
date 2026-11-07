// Carry the actual sheet between Home and detail. Capture its initial position
// before routing and measure the destination after restoring layout and scroll.
let cancel, moving;
const home = document.querySelector("#home-view");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
function stop() { cancel?.(); }

function homeMedia(kind, id) {
  if (kind === "index" && home.querySelector("[data-index-link]").hash === "#projects/" + id)
    return home.querySelector(".is-inspecting .index-image-window img:last-child");
  if (kind === "timeline") return home.querySelector('.tl-project[href="#projects/'+id+'"] img');
  if (kind === "study") {
    const frame = home.querySelector('.study-frame[href="#projects/'+id+'"]');
    if (frame && (!frame.closest(".study-aperture") || frame.classList.contains("is-current"))) return frame.querySelector("video");
  }
}
function visibleBox(element) {
  const box = element?.getBoundingClientRect();
  if (box?.width && box.height && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight) return box;
}
function freeze(media) {
  if (media instanceof HTMLVideoElement && media.readyState >= 2) {
    const still = document.createElement("canvas");
    still.width = media.videoWidth; still.height = media.videoHeight;
    const context = still.getContext("2d");
    if (context) {
      context.drawImage(media,0,0);
      return still;
    }
  }
  const src = media instanceof HTMLVideoElement ? media.poster : media.currentSrc;
  if (!src) return null;
  const image = new Image();
  image.alt = ""; image.src = src;
  return image;
}

export function captureIndexFlight(key) {
  const interrupted = moving && {id:moving.dataset.id, box:moving.getBoundingClientRect()};
  stop();
  if (document.hidden || reduce.matches || document.documentElement.classList.contains("motion-paused") || !Element.prototype.animate) return null;
  const state = history.state;
  const forward = key.startsWith("project/") && !home.hidden && state?.studioHomeFrom === Number(key.slice(8));
  const returning = key === "home" && home.hidden && state?.studioHome?.media && !document.querySelector("dialog[open]");
  if (!forward && !returning) return null;
  const id = forward ? state.studioHomeFrom : state.studioHome.projectId;
  const kind = forward ? state.studioHomeMedia : state.studioHome.media;
  const detail = () => document.querySelector(".projects-detail-image");
  const source = forward ? homeMedia(kind,id) : detail();
  const from = interrupted?.id === String(id) ? interrupted.box : visibleBox(source);
  if (!source || !from) return null;
  const sheet = freeze(source);
  if (!sheet) return null;
  sheet.setAttribute("aria-hidden","true");
  sheet.className = "index-flight";
  sheet.dataset.id = id;
  return () => {
    const target = forward ? detail() : homeMedia(kind,id);
    const to = visibleBox(target);
    if (!to) return;
    const crossfade = kind === "study";
    moving = sheet;
    document.body.append(sheet);
    Object.assign(sheet.style,{left:to.left+"px", top:to.top+"px", width:to.width+"px", height:to.height+"px"});
    const transform = 'translate('+ (from.x-to.x)+'px,'+ (from.y-to.y)+'px) scale('+ (from.width/to.width)+','+(from.height/to.height)+')';
    const options = {duration:430,easing:"cubic-bezier(.19,.72,.18,1)"};
    const fadeOptions = {duration:430, easing:"linear"};
    const startFade = crossfade ? .5 : .97;
    const fade = target.animate([{opacity:0},{opacity:0,offset:startFade},{opacity:1}],fadeOptions);
    const outgoing = crossfade && sheet.animate([{opacity:1},{opacity:1,offset:startFade},{opacity:0}],fadeOptions);
    const fx = sheet.animate([{transform},{transform:"none"}],options);
    cancel = () => {
      fx.onfinish = fx.oncancel = null; fx.cancel(); fade.cancel(); if (outgoing) outgoing.cancel(); sheet.remove();
      moving = cancel = null;
    };
    fx.onfinish = fx.oncancel = cancel;
  };
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
window.addEventListener("studio-motion", event => { if (!event.detail) stop(); });
reduce.addEventListener("change", () => { if (reduce.matches) stop(); });
window.addEventListener("resize", stop);
