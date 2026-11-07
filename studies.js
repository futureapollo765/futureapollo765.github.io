import { projects } from "./project-data.js";

// Authored intros are tied to these works, never to their position in the
// feed. The films are silent captures of the public projects themselves.
const chapters = [
  { id:926613453, film:"hills", field:"Arcade", copy:"A tank and a moonlit ridgeline. Aim across the hills and press Space to fire." },
  { id:1334587822, film:"pathfinder", field:"Pathfinding", copy:"A line traces an A* search around rectangular obstacles. A smaller search angle buys precision at the cost of more computation." },
  { id:1406787990, film:"glass", field:"Interface design", copy:"Drag a glass shape to stretch it. Bring two shapes together and their edges join over the image beneath." },
];
const fmt = n => String(n).padStart(2, "0");
const thumbPath = name => new URL("./assets/studies/" + name, import.meta.url).href;

export function mountStudies() {
  const root = document.querySelector("#project-studies");
  const records = chapters.flatMap(entry => {
    const project = projects.find(item => item.id === entry.id);
    return project ? [{...entry, project}] : [];
  });
  if (!records.length) { root.hidden = true; return; }
  const wide = matchMedia("(min-width: 800px) and (min-height: 590px)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const save = matchMedia("(prefers-reduced-data: reduce)");
  root.innerHTML = `
    <header class="studies-head"><h2 id="studies-title">Project studies</h2><span aria-hidden="true">01 — ${fmt(records.length)}</span></header>
    <div class="studies-body"><div class="study-notes"></div><div class="study-desk">
      <div class="study-aperture"></div><div class="study-selector" role="group" aria-label="Jump to a project study"></div>
    </div></div>`;
  const notes = root.querySelector(".study-notes");
  const desk = root.querySelector(".study-desk");
  const aperture = desk.querySelector(".study-aperture");
  const selector = desk.querySelector(".study-selector");
  let current = -1, near = false, frame = 0;
  const views = records.map(({project, field, copy, film}, index) => {
    const item = document.createElement("article");
    item.className = "study-note";
    item.innerHTML = `<div class="study-copy">
      <p class="study-field"><span>${fmt(index+1)}</span> ${field}</p><h3></h3><p class="study-intro"></p>
      <a class="study-open"><span>Open project</span><b aria-hidden="true">↗</b></a>
    </div>`;
    item.querySelector("h3").textContent = project.title;
    item.querySelector(".study-intro").textContent = copy;
    const link = item.querySelector(".study-open");
    link.href = "#projects/" + project.id;
    link.id = "study-open-" + project.id;
    link.setAttribute("aria-label","Open " + project.title);
    notes.append(item);
    const art = document.createElement("a");
    art.className = "study-frame";
    art.href = link.href;
    // A second hit target for pointer users; the adjacent text link names
    // the exact same destination for keyboard and assistive technology.
    art.tabIndex = -1;
    art.setAttribute("aria-hidden","true");
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.loop = true;
    video.preload = "none"; video.disablePictureInPicture = true;
    video.poster = thumbPath(film + ".webp");
    art.append(video);
    const button = document.createElement("button");
    button.type = "button"; button.textContent = fmt(index+1);
    button.setAttribute("aria-label", "Jump to " + project.title + " study");
    button.addEventListener("click", () => {
      const top = scrollY + item.getBoundingClientRect().top + item.offsetHeight / 2 - innerHeight * .51;
      scrollTo({top, behavior:motion() ? "smooth":"instant"});
    });
    selector.append(button);
    return {item, art, video, button, film};
  });

  function motion() {
    return !reduce.matches && !document.documentElement.classList.contains("motion-paused");
  }
  function draw() {
    frame = 0;
    const readingLine = innerHeight * .51;
    let next = 0;
    if (near && !root.closest("[hidden]")) {
      views.forEach(({item}, i) => { if (item.getBoundingClientRect().top <= readingLine) next = i; });
    }
    if (next !== current) {
      current = next;
      views.forEach(({item, art, button}, i) => {
        item.classList.toggle("is-current", i===current);
        art.classList.toggle("is-current", i===current);
        if (i===current) button.setAttribute("aria-current","step"); else button.removeAttribute("aria-current");
      });
    }
    for (const [i, view] of views.entries()) {
      const {video, art, film} = view;
      const visible = art.getBoundingClientRect();
      const play = near && !document.hidden && motion() && !save.matches && !navigator.connection?.saveData &&
        (wide.matches ? i === current : true) && visible.top < innerHeight && visible.bottom > 0 && visible.width > 0;
      if (!play) { if (!video.paused) video.pause(); continue; }
      if (!video.hasAttribute("src")) video.src = thumbPath(film + ".mp4");
      if (video.paused) video.play().catch(()=>{});
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  function arrange() {
    for (const {item,art} of views) {
      if (wide.matches) aperture.append(art);
      else item.append(art);
    }
    desk.hidden = !wide.matches;
    schedule();
  }
  function scroll() { if (near) schedule(); }
  arrange();
  new IntersectionObserver(([entry]) => { near = entry.isIntersecting; schedule(); }).observe(root);
  wide.addEventListener("change", arrange);
  for (const query of [reduce,save]) query.addEventListener("change",schedule);
  window.addEventListener("scroll",scroll,{passive:true});
  window.addEventListener("resize",schedule);
  window.addEventListener("studio-motion",schedule);
  document.addEventListener("visibilitychange",schedule);
  // On Back, select the same visible chapter before the returning photo's
  // destination is measured; IntersectionObserver notifies a frame later.
  return () => {
    const box = root.getBoundingClientRect();
    near = box.width > 0 && box.top < innerHeight && box.bottom > 0;
    if (frame) cancelAnimationFrame(frame);
    draw();
  };
}
