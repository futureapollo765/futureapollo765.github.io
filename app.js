import { enterHome } from "./home-motion.js";
import { mountSelectedWork } from "./selected.js";
import { showProjectView, hideProjectView } from "./projects.js";

const home = document.querySelector("#home-view");
const gallery = document.querySelector("#projects-view");
const content = document.querySelector("#main-content");
const nav = document.querySelectorAll("[data-nav]");
let currentView;

mountSelectedWork();

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
  else {
    hideProjectView();
    enterHome();
  }
}

document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  content.focus();
});
for (const link of document.querySelectorAll(".site-header [href='#home']")) {
  link.addEventListener("click", () => {
    if (currentView === "home") {
      window.scrollTo({ top: 0, behavior: document.documentElement.classList.contains("motion-paused") ? "auto" : "smooth" });
    }
  });
}
window.addEventListener("hashchange", renderRoute);
renderRoute();
