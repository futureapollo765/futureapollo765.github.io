import { enterHome, rememberHome, restoreHome } from "./home-motion.js";
import { mountSelectedWork } from "./selected.js";
import { showProjectView, hideProjectView, hasMapPhotoFlight } from "./projects.js";
import { presentRoute } from "./transition.js";
import { captureIndexFlight } from "./index-flight.js";
import { projects } from "./project-data.js";
import { mountStudies } from "./studies.js";
import { mountTimeline } from "./timeline.js";

const home = document.querySelector("#home-view");
const gallery = document.querySelector("#projects-view");
const content = document.querySelector("#main-content");
const nav = document.querySelectorAll("[data-nav]");
let currentView;
let pendingHomeProject = null;
let pendingMedia = null;

mountSelectedWork();
const restoreStudy = mountStudies();
mountTimeline();

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
  if (changed && view === "projects") window.scrollTo(0, 0);
  if (fromOtherView) content.focus({ preventScroll: true });
  if (view === "projects") showProjectView(id, action === "play");
  else {
    hideProjectView();
    if (changed) {
      const state = history.state?.studioHome;
      restoreHome(state);
      restoreStudy?.();
      if (state?.restoreFocus) {
        const link = document.getElementById(state.sourceId);
        link?.focus({ preventScroll:true });
      }
    }
    enterHome();
    if (["project-studies","project-timeline","selected-work"].includes(page) && !(changed && history.state?.studioHome)) {
      const section = document.getElementById(page);
      if (section.hidden) location.replace("#projects");
      else requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
    }
  }
}

// Save the scene on the entry we are *leaving*, before the native hash link
// creates the next entry. Browser Back can then restore its exact project.
home.addEventListener("click", event => {
  const target = event.target.closest("a[href^='#projects']");
  if (target && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const projectId = /^#projects\/(\d+)$/.exec(target.hash);
    pendingHomeProject = projectId ? Number(projectId[1]) : null;
    pendingMedia = target.closest(".index-panel") ? "index" :
      target.closest("#project-studies") ? "study" : target.closest(".tl-project") ? "timeline" : null;
    if (!target.id) target.id = "home-origin-" + [...home.querySelectorAll("a")].indexOf(target);
    history.replaceState({ ...history.state, studioHome:{...rememberHome(), media:pendingMedia, projectId:pendingHomeProject, sourceId:target.dataset.returnFocus || target.id, restoreFocus:event.detail === 0} }, "", location.href);
  }
});
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  content.focus();
});
for (const link of document.querySelectorAll(".site-header [href='#home']")) {
  link.addEventListener("click", () => {
    if (currentView === "home") {
      restoreHome(null, true);
    }
  });
}
function navigate() {
  const [page, id] = location.hash.slice(1).split("/");
  if (currentView === "home" && page === "projects" && Number(id) === pendingHomeProject) {
    history.replaceState({ ...history.state, studioHomeFrom:pendingHomeProject, studioHomeMedia:pendingMedia }, "", location.href);
  }
  pendingHomeProject = pendingMedia = null;
  let viewKey = "home";
  if (page === "projects") {
    const project = projects.find(item => String(item.id) === id);
    viewKey = project ? "project/" + project.id : "projects";
  }
  const unfold = captureIndexFlight(viewKey);
  presentRoute(viewKey, () => { renderRoute(); unfold?.(); }, Boolean(unfold) || hasMapPhotoFlight(viewKey));
}

window.addEventListener("hashchange", navigate);
navigate();
