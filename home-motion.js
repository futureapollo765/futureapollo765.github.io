import { favorites, projects } from "./project-data.js";

const home = document.querySelector("#home-view");
const sequence = home.querySelector(".home-sequence");
const stage = home.querySelector(".home-stage");
const orbit = home.querySelector("[data-orbit]");
const header = document.querySelector(".site-header");
const belt = home.querySelector(".belt-track");
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

function fillBelt() {
  if (!projects.length) {
    belt.parentElement.hidden = true;
    return;
  }
  const group = document.createElement("span");
  group.className = "belt-group";
  for (const project of projects.slice(0, 8)) {
    const name = document.createElement("span");
    name.textContent = project.title;
    group.append(name);
  }
  belt.append(group, group.cloneNode(true));
}

function updateSequence() {
  scheduled = false;
  if (home.hidden) return;
  const rect = sequence.getBoundingClientRect();
  const distance = Math.max(sequence.offsetHeight - stage.offsetHeight, stage.offsetHeight * .55);
  const progress = enabled ? Math.min(1, Math.max(0, (header.offsetHeight - rect.top) / distance)) : 0;
  if (Math.abs(progress - lastProgress) < .0001) return;
  lastProgress = progress;
  stage.style.setProperty("--travel", progress.toFixed(4));
  orbit.dispatchEvent(new CustomEvent("orbitprogress", { detail: progress }));
}

export function refreshHomeMotion() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateSequence);
}

function updatePreference() {
  enabled = !reduce.matches && !pausedByUser;
  document.documentElement.classList.toggle("motion-paused", !enabled);
  toggle.disabled = reduce.matches;
  const label = reduce.matches ? "Reduced motion enabled" : enabled ? "Pause motion" : "Resume motion";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  orbit.dispatchEvent(new CustomEvent("orbitmotion", { detail: enabled }));
  window.dispatchEvent(new CustomEvent("studio-motion", { detail: enabled }));
  lastProgress = -1;
  refreshHomeMotion();
}

function revealHome() {
  if (home.hidden || document.querySelector(".studio-intro-dialog[open]")) return;
  stage.classList.add("arrived");
}

export function enterHome() {
  revealHome();
  refreshHomeMotion();
}

fillBelt();
if (!favorites.length) {
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
  const destination = document.querySelector("#selected-work");
  if (destination.hidden) {
    location.hash = "#projects";
    return;
  }
  destination.focus({ preventScroll: true });
  destination.scrollIntoView({ behavior: enabled ? "smooth" : "auto", block: "start" });
});
