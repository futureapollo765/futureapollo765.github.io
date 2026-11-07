import { projects } from "./project-data.js";
import { mountProjectIndex } from "./project-index.js";
import { interruptScrollMotion } from "./scroll-motion.js";

const home = document.querySelector("#home-view");
const sequence = home.querySelector(".home-sequence");
const stage = home.querySelector(".home-stage");
const orbit = home.querySelector("[data-orbit]");
const header = document.querySelector(".site-header");
const index = mountProjectIndex(stage);
const cue = home.querySelector(".scroll-cue");
const toggle = document.querySelector(".motion-toggle");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = true;
let scheduled = false;
let lastProgress = -1;
let pausedByUser = false;

try {
  pausedByUser = localStorage.getItem("futureapollo.motion") === "paused";
} catch {
  // The control still works for this visit when storage is unavailable.
}

export function rememberHome(sourceId) {
  return { top:window.scrollY, ...index?.snapshot(sourceId) };
}

export function restoreHome(state, scrollToIntro = false) {
  interruptScrollMotion();
  if (scrollToIntro && enabled && window.scrollY > 0) {
    index?.restore({ index:-1 });
    window.scrollTo({ top:0, behavior:"smooth" });
    return;
  }
  window.scrollTo({top:state?.top || 0, behavior:"instant"});
  updateSequence();
  index?.restore(state);
}

function updateSequence() {
  scheduled = false;
  if (home.hidden) return;
  const rect = sequence.getBoundingClientRect();
  const distance = sequence.offsetHeight - stage.offsetHeight;
  const progress = enabled && distance > 1 ? Math.min(1, Math.max(0, (header.offsetHeight - rect.top) / distance)) : 0;
  if (Math.abs(progress - lastProgress) < .0001) return;
  lastProgress = progress;
  stage.style.setProperty("--travel", progress.toFixed(4));
  index?.travel(progress);
  orbit.dispatchEvent(new CustomEvent("orbitprogress", { detail: progress }));
}

export function refreshHomeMotion() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateSequence);
}

function updatePreference() {
  const next = !reduce.matches && !pausedByUser;
  const preserve = enabled !== next && !home.hidden && lastProgress !== -1;
  const anchors = preserve ? [...home.querySelectorAll("#selected-work, .tl-stage, .studies-stage")].reverse() : [];
  const anchor = anchors.find(node => node.offsetWidth && node.getBoundingClientRect().top < innerHeight * .7);
  const originalTop = anchor?.getBoundingClientRect().top;
  const pose = preserve ? index?.snapshot() : null;
  enabled = next;
  document.documentElement.classList.toggle("motion-paused", !enabled);
  toggle.disabled = reduce.matches;
  const label = reduce.matches ? "Reduced motion enabled" : enabled ? "Pause motion" : "Resume motion";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  orbit.dispatchEvent(new CustomEvent("orbitmotion", { detail: enabled }));
  window.dispatchEvent(new CustomEvent("studio-motion", { detail: enabled }));
  lastProgress = -1;
  if (preserve) {
    // Pausing changes the pinned stage's height. Keep the current work under
    // the visitor's eyes even if removing that scroll distance moves the page.
    if (anchor) {
      window.scrollBy({top:anchor.getBoundingClientRect().top - originalTop, behavior:"instant"});
    } else if (!enabled) window.scrollTo({top:0,behavior:"instant"});
    updateSequence();
    index?.restore(pose);
  } else refreshHomeMotion();
}

function revealHome() {
  if (home.hidden || document.querySelector(".studio-intro-dialog[open]")) return;
  stage.classList.add("arrived");
}

export function enterHome() {
  revealHome();
  refreshHomeMotion();
}

if (!projects.length) {
  cue.lastChild.textContent = "Open project map";
  sequence.classList.add("no-favorites");
}
updatePreference();
toggle.addEventListener("click", () => {
  pausedByUser = !pausedByUser;
  try {
    localStorage.setItem("futureapollo.motion", pausedByUser ? "paused" : "playing");
  } catch {}
  updatePreference();
});
reduce.addEventListener("change", updatePreference);
window.addEventListener("studio-intro-ended", revealHome);
window.addEventListener("scroll", refreshHomeMotion, { passive: true });
window.addEventListener("resize", refreshHomeMotion);
cue.addEventListener("click", () => {
  interruptScrollMotion();
  const studies = document.querySelector("#project-studies");
  const destination = studies.hidden ? document.querySelector("#selected-work") : studies;
  if (destination.hidden) {
    location.hash = "#projects";
    return;
  }
  destination.focus({ preventScroll: true });
  destination.scrollIntoView({ behavior: enabled ? "smooth" : "auto", block: "start" });
});
