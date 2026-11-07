import { projects } from "./project-data.js";
import { showProjectView, hideProjectView } from "./projects.js";

const home = document.querySelector("#home-view");
const gallery = document.querySelector("#projects-view");
const content = document.querySelector("#main-content");
const nav = document.querySelectorAll("[data-nav]");
const selectedWorks = document.querySelector("#selected-works");
let currentView;

// Keep the preview row and gallery linked to the same catalog.
for (const project of projects.slice(0, 3)) {
  const link = document.createElement("a");
  link.className = "work-link";
  link.href = "#projects/" + project.id;

  const image = document.createElement("img");
  image.src = project.thumbnail;
  image.alt = "";
  image.width = 124;
  image.height = 88;

  const name = document.createElement("span");
  name.className = "work-title";
  name.textContent = project.title;

  const arrow = document.createElement("span");
  arrow.className = "work-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  link.append(image, name, arrow);
  selectedWorks.append(link);
}

function renderRoute() {
  const [page, id, action] = location.hash.slice(1).split("/");
  const view = page === "projects" ? "projects" : "home";
  const changed = currentView !== view;
  const fromOtherView = changed && currentView !== undefined;
  currentView = view;

  home.hidden = view !== "home";
  gallery.hidden = view !== "projects";
  nav.forEach(link => {
    if (link.dataset.nav === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.title = "FutureApollo765 — " + (view === "projects" ? "Projects" : "Home");
  if (changed) window.scrollTo(0, 0);
  if (fromOtherView) content.focus({ preventScroll: true });
  if (view === "projects") showProjectView(id, action === "play");
  else hideProjectView();
}

document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  content.focus();
});
window.addEventListener("hashchange", renderRoute);
renderRoute();
