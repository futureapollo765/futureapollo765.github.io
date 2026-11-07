import { projects } from "./project-data.js";

// The films show the corresponding public Scratch work running in TurboWarp.
const chapters = [
  { id:926613453, film:"hills", field:"Arcade", copy:"A tank and a moonlit ridgeline. Aim across the hills and press Space to fire." },
  { id:1334587822, film:"pathfinder", field:"Pathfinding", copy:"A line traces an A* search around rectangular obstacles. A smaller search angle buys precision at the cost of more computation." },
  { id:1406787990, film:"glass", field:"Interface design", copy:"Drag a glass shape to stretch it. Bring two shapes together and their edges join over the image beneath." },
];
const fmt = n => String(n).padStart(2, "0");
const asset = name => new URL("./assets/studies/" + name, import.meta.url).href;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
// A broad ease keeps the fade visible throughout its travel, with no velocity
// at either end. Scroll position remains the only clock for the pinned scene.
const smooth = t => t * t * (3 - 2 * t);

// Give each note a static reading interval, then divide the rest of the
// scroll distance between its exit and the next note's entrance.
function opacityAt(position, i, hold) {
  const local = position-i;
  if (local >= 0 && local <= hold) return 1;
  const halfFade = (1-hold)/2;
  if (local > hold) return 1 - smooth(clamp((local-hold)/halfFade, 0, 1));
  return smooth(clamp(1 + local/halfFade, 0, 1));
}

export function mountStudies() {
  const root = document.querySelector("#project-studies");
  if (!root || root.childElementCount) return;
  const records = chapters.flatMap(entry => {
    const project = projects.find(item => item.id === entry.id);
    return project ? [{...entry, project}] : [];
  });
  if (!records.length) { root.hidden = true; return; }
  root.innerHTML = `
    <div class="studies-stage">
      <header class="studies-head"><h2 id="studies-title">Project studies</h2><span aria-hidden="true"><b>01</b> / ${fmt(records.length)}</span></header>
      <div class="studies-body"><div class="study-notes"></div><div class="study-aperture"></div></div>
      <div class="study-selector" role="group" aria-label="Choose a project study"></div>
    </div>`;
  const stage = root.querySelector(".studies-stage");
  const count = stage.querySelector(".studies-head b");
  const aperture = stage.querySelector(".study-aperture");
  const notes = stage.querySelector(".study-notes");
  const selector = stage.querySelector(".study-selector");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const save = matchMedia("(prefers-reduced-data: reduce)");
  let pinned = false, header = 0, unit = 0, current = -1, frame = 0, near = false;
  let manual = 0, position = 0, manualFX = null;

  const views = records.map(({project, field, copy, film}, i) => {
    const item = document.createElement("article");
    item.className = "study-note";
    item.id = "study-note-" + project.id;
    item.innerHTML = `<p class="study-field"><span>${fmt(i+1)}</span> ${field}</p><h3></h3><p class="study-intro"></p><a class="study-open"><span>Open project</span><b aria-hidden="true">↗</b></a>`;
    item.querySelector("h3").textContent = project.title;
    item.querySelector(".study-intro").textContent = copy;
    const link = item.querySelector("a");
    link.href = "#projects/" + project.id;
    link.id = "study-open-" + project.id;
    link.setAttribute("aria-label","Open " + project.title);
    notes.append(item);
    const art = document.createElement("a");
    art.className = "study-frame";
    art.href = link.href;
    art.tabIndex = -1;
    art.setAttribute("aria-hidden","true");
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.loop = true;
    video.preload = "none"; video.disablePictureInPicture = true;
    video.poster = asset(film + ".webp");
    art.append(video); aperture.append(art);
    const button = document.createElement("button");
    button.type = "button"; button.textContent = fmt(i+1);
    button.setAttribute("aria-label", "Show " + project.title + " study");
    button.setAttribute("aria-controls", item.id);
    button.addEventListener("click", () => choose(i));
    selector.append(button);
    return {item, art, video, button, film, link, alpha:-1};
  });
  let hold = .3, end = views.length-1 + hold;
  const motion = () => !reduce.matches && !document.documentElement.classList.contains("motion-paused");

  function choose(i) {
    if (pinned) {
      const local = (i + hold/2) * unit;
      scrollTo({top:scrollY + root.getBoundingClientRect().top - header + local, behavior:motion() ? "smooth":"instant"});
    } else {
      manual = i;
      const target = i + hold/2;
      manualFX = motion() && position !== target
        ? { from:position, to:target, start:performance.now(), duration:Math.min(720, 460 + Math.abs(target-position)*90) }
        : null;
      queue();
    }
  }
  selector.addEventListener("keydown", event => {
    const i = views.findIndex(view=>view.button === event.target);
    const next = {ArrowLeft:i-1,ArrowRight:i+1,Home:0,End:views.length-1}[event.key];
    if (i<0 || next === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const n = clamp(next,0,views.length-1); views[n].button.focus({preventScroll:true}); choose(n);
  });

  function paint(now = performance.now()) {
    frame = 0;
    const box = root.getBoundingClientRect();
    near = box.width > 0 && box.top < innerHeight && box.bottom > header;
    if (pinned) {
      manualFX = null;
      position = clamp((header-box.top)/unit,0,end);
    } else if (manualFX && motion()) {
      // Only a deliberate selector choice animates in the short-screen
      // fallback. The pinned scene always follows the actual scroll offset.
      const t = clamp((now-manualFX.start)/manualFX.duration,0,1);
      position = manualFX.from + (manualFX.to-manualFX.from) * smooth(t);
      if (t === 1) manualFX = null;
      else queue();
    } else position = manual+hold/2;

    const active = clamp(Math.floor(position+(1-hold)/2),0,views.length-1);
    const moveFocus = active !== current && current >= 0 && views[current].item.contains(document.activeElement);
    if (active !== current) {
      current = active;
      if (pinned) manual = active;
      count.textContent = fmt(active+1);
      views.forEach(({item,art,button}, i) => {
        item.inert = i !== active;
        art.classList.toggle("is-current",i===active);
        if (i === active) button.setAttribute("aria-current","step"); else button.removeAttribute("aria-current");
      });
    }
    for (const [i,view] of views.entries()) {
      const {item,art,video,film} = view;
      const alpha = opacityAt(position,i,hold);
      if (view.alpha !== alpha) {
        item.style.opacity = alpha;
        item.style.visibility = alpha === 0 ? "hidden" : "visible";
        const shift = (position < i ? 14 : -20) * (1-alpha);
        item.style.transform = motion() && alpha !== 1 ? "translateY("+shift.toFixed(2)+"px)" : "none";
        view.alpha = alpha;
      }
      // The next frame cuts across the previous one, which remains opaque
      // underneath it. The artwork never rides up with the chapter text.
      const fill = i === 0 ? 1 : smooth(clamp((position-i)/(1-hold)+1,0,1));
      const visible = fill > 0 && position < i+1;
      art.style.visibility = visible ? "visible" : "hidden";
      art.style.clipPath = fill === 1 ? "none" : "inset(0 "+((1-fill)*100).toFixed(3)+"% 0 0)";
      const play = near && i===active && !document.hidden && motion() && !save.matches && !navigator.connection?.saveData;
      if (!play) { if (!video.paused) video.pause(); continue; }
      if (!video.hasAttribute("src")) video.src = asset(film+".mp4");
      if (video.paused) video.play().catch(()=>{});
    }
    if (moveFocus) {
      const target = views[active].alpha > 0 ? views[active].link : views[active].button;
      target.focus({preventScroll:true});
    }
  }
  function queue() { if (!frame) frame = requestAnimationFrame(paint); }
  function layout() {
    if (!root.offsetWidth) return;
    header = document.querySelector(".site-header").offsetHeight;
    // Reading and handoff have separate distances. Extending the handoff must
    // not turn the fully opaque reading interval into a long empty scroll.
    const mobile = innerWidth <= 760;
    const reading = mobile
      ? clamp(innerHeight * .30, 200, 230)
      : clamp(innerHeight * .33, 270, 300);
    const handoff = mobile
      ? clamp(innerHeight * .95, 650, 820)
      : clamp(innerHeight * .86, 730, 960);
    unit = reading + handoff;
    hold = reading / unit;
    end = views.length-1 + hold;
    pinned = motion() && views.length>1 && innerHeight-header>=510;
    root.classList.toggle("studies-pinned",pinned);
    if (pinned && stage.scrollHeight > stage.clientHeight + 2) { pinned = false; root.classList.remove("studies-pinned"); }
    root.style.setProperty("--study-distance",pinned ? Math.round(unit*end)+"px" : "0px");
    queue();
  }
  new ResizeObserver(layout).observe(stage);
  new IntersectionObserver(()=>queue()).observe(root);
  window.addEventListener("scroll",()=>{if (near) queue();},{passive:true});
  window.addEventListener("resize",layout);
  window.addEventListener("studio-motion",layout);
  reduce.addEventListener("change",layout);
  save.addEventListener("change",queue);
  document.addEventListener("visibilitychange",queue);
  layout(); paint();
  return () => { layout(); if (frame) cancelAnimationFrame(frame); paint(); };
}
