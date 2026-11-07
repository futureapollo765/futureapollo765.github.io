import { favorites, projects } from "./project-data.js";

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const arrow = direction => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${direction < 0 ? "M20 12H4m7-7-7 7 7 7" : "M4 12h16m-7-7 7 7-7 7"}"/></svg>`;
const clamp = (value, max) => Math.max(0, Math.min(value, max));

function archive() {
  const dated = [];
  const undated = [];
  for (const project of projects) {
    const timestamp = typeof project.sharedAt === "string" ? Date.parse(project.sharedAt) : NaN;
    if (Number.isFinite(timestamp)) dated.push({ project, timestamp, year: new Date(timestamp).getUTCFullYear() });
    else undated.push(project);
  }
  dated.sort((a, b) => a.timestamp - b.timestamp || a.project.id - b.project.id);
  const years = new Map();
  for (const entry of dated) {
    if (!years.has(entry.year)) years.set(entry.year, []);
    years.get(entry.year).push(entry);
  }
  return { dated, undated, years };
}

// Use public favorites as editorial selections while always including both
// chronological endpoints. Years without a favorite get an actual shared work.
function highlights(dated, years) {
  const favoriteIds = new Set(favorites.map(project => project.id));
  const chosen = new Set([dated[0], dated.at(-1)]);
  for (const entries of years.values()) {
    const picks = entries.filter(entry => favoriteIds.has(entry.project.id));
    if (picks.length) {
      chosen.add(picks[0]);
      chosen.add(picks.at(-1));
    } else chosen.add(entries[Math.floor((entries.length - 1) / 2)]);
  }
  return dated.filter(entry => chosen.has(entry));
}

function releaseCard(entry, startsYear) {
  const { project, year, timestamp } = entry;
  const item = document.createElement("li");
  item.className = "tl-milestone";
  const yearMark = document.createElement("span");
  yearMark.className = "tl-year-mark";
  yearMark.setAttribute("aria-hidden", "true");
  if (startsYear) yearMark.textContent = year;
  const link = document.createElement("a");
  link.href = `#projects/${project.id}`;
  link.className = "tl-project";
  const image = new Image(480, 360);
  image.src = new URL(project.thumbnail, import.meta.url);
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  image.alt = "";
  const art = document.createElement("span");
  art.className = "tl-art";
  art.append(image);
  const time = document.createElement("time");
  time.dateTime = project.sharedAt;
  time.textContent = dateLabel.format(timestamp);
  time.title = new Date(timestamp).toUTCString();
  const title = document.createElement("span");
  title.className = "tl-title";
  title.textContent = project.title;
  const icon = document.createElement("span");
  icon.className = "tl-open";
  icon.innerHTML = arrow(1);
  link.append(time, art, title, icon);
  item.append(yearMark, link);
  return item;
}

export function mountTimeline() {
  const section = document.querySelector("#project-timeline");
  if (!section || section.childElementCount) return;
  const { dated, undated, years } = archive();
  if (!projects.length) { section.hidden = true; return; }
  section.innerHTML = `
    <div class="tl-stage">
      <div class="tl-header">
        <div><p class="tl-kicker">Shared on Scratch</p><h2>Project timeline</h2></div>
        <nav class="tl-years" aria-label="Jump to a year"></nav>
      </div>
      <div class="tl-window" tabindex="0" role="region" aria-label="Timeline milestones" aria-description="Use the left and right arrows to explore projects by share date.">
        <ol class="tl-track"></ol>
      </div>
      <div class="tl-footer">
        <div class="tl-controls">
          <button type="button" data-tl-prev aria-label="Previous milestone">${arrow(-1)}</button>
          <button type="button" data-tl-next aria-label="Next milestone">${arrow(1)}</button>
        </div>
        <label class="tl-archive"><select aria-label="Browse all shared projects by date"><option value="">Browse all shared projects</option></select>${arrow(1)}</label>
      </div>
    </div>`;
  const stage = section.querySelector(".tl-stage");
  const viewport = section.querySelector(".tl-window");
  const list = section.querySelector(".tl-track");
  const yearNav = section.querySelector(".tl-years");
  const previous = section.querySelector("[data-tl-prev]");
  const next = section.querySelector("[data-tl-next]");
  const picker = section.querySelector(".tl-archive select");

  for (const [year, entries] of years) {
    const group = document.createElement("optgroup");
    group.label = String(year);
    for (const {project, timestamp} of entries) {
      group.append(new Option(`${dateLabel.format(timestamp)} · ${project.title}`, String(project.id)));
    }
    picker.append(group);
  }
  if (undated.length) {
    const group = document.createElement("optgroup");
    group.label = "Share date unavailable";
    for (const project of undated) group.append(new Option(project.title, String(project.id)));
    picker.append(group);
  }
  picker.addEventListener("change", () => {
    if (!picker.value) return;
    // Use a real hash link to preserve Home's existing navigation/history flow.
    const link = document.createElement("a");
    link.href = `#projects/${picker.value}`;
    link.hidden = true;
    section.append(link);
    link.dataset.returnFocus = picker.id = "timeline-archive-picker";
    picker.selectedIndex = 0;
    link.click();
    link.remove();
  });
  if (!dated.length) {
    viewport.remove();
    yearNav.remove();
    section.querySelector(".tl-controls").remove();
    const message = document.createElement("p");
    message.className = "tl-empty";
    message.textContent = "Share dates are unavailable.";
    stage.querySelector(".tl-header").after(message);
    return;
  }

  const nodes = highlights(dated, years);
  const cards = nodes.map((entry, i) => {
    const card = releaseCard(entry, i === 0 || nodes[i - 1].year !== entry.year);
    list.append(card);
    return card;
  });
  const yearButtons = [...years.keys()].map(year => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = year;
    button.addEventListener("click", () => goTo(nodes.findIndex(node => node.year === year)));
    yearNav.append(button);
    return button;
  });
  const yearIndicator = document.createElement("span");
  yearIndicator.className = "tl-year-indicator";
  yearIndicator.setAttribute("aria-hidden", "true");
  yearNav.append(yearIndicator);

  const tall = matchMedia("(min-height: 680px) and (prefers-reduced-motion: no-preference)");
  let pinned = false, controlledX = 0;
  let maxScroll = 0;
  let travel = 0;
  let header = 0;
  let active = -1;
  let frame = 0;
  let indicatorReady = false;

  function indicateYear() {
    const button = yearButtons.find(button => Number(button.textContent) === nodes[active]?.year);
    if (!button) return;
    yearIndicator.style.transition = indicatorReady ? "" : "none";
    yearIndicator.style.transform = `translate(${button.offsetLeft}px, ${button.offsetTop + button.offsetHeight - 1}px)`;
    yearIndicator.style.width = button.offsetWidth + "px";
    yearIndicator.style.opacity = "1";
    indicatorReady = true;
  }

  function position(i) {
    const span = cards.at(-1).offsetLeft - cards[0].offsetLeft;
    return span ? maxScroll * (cards[i].offsetLeft - cards[0].offsetLeft) / span : 0;
  }
  function display() {
    if (!section.offsetWidth) return;
    const distance = viewport.scrollLeft;
    let i = 0;
    for (let j = 1; j < cards.length; j++) {
      if (Math.abs(position(j) - distance) < Math.abs(position(i) - distance)) i = j;
    }
    if (i !== active) {
      active = i;
      cards.forEach((card,n) => card.classList.toggle("tl-current", n === i));
      yearButtons.forEach(button => {
        if (Number(button.textContent) === nodes[i].year) button.setAttribute("aria-current", "date");
        else button.removeAttribute("aria-current");
      });
    }
    previous.disabled = distance <= 1;
    next.disabled = distance >= maxScroll - 1;
    indicateYear();
  }
  function paint() {
    frame = 0;
    if (!section.offsetWidth) return;
    if (pinned && travel) {
      const progress = clamp((header - section.getBoundingClientRect().top) / travel, 1);
      viewport.scrollLeft = progress * maxScroll;
      controlledX = viewport.scrollLeft;
    }
    display();
  }
  function queue() {
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function measure() {
    if (!section.offsetWidth) return;
    header = parseFloat(getComputedStyle(section).getPropertyValue("--header")) || 0;
    maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    pinned = tall.matches && !document.documentElement.classList.contains("motion-paused") && maxScroll > 1;
    section.classList.toggle("tl-pinned", pinned);
    // Never pin content taller than the screen (including browser zoom).
    if (pinned && stage.scrollHeight > innerHeight - header + 2) {
      pinned = false;
      section.classList.remove("tl-pinned");
    }
    travel = pinned ? maxScroll * .62 : 0;
    section.style.setProperty("--tl-travel", `${Math.ceil(travel)}px`);
    queue();
  }
  function goTo(i, moveFocus = false) {
    i = clamp(i, cards.length - 1);
    if (moveFocus) cards[i].querySelector("a").focus({preventScroll:true});
    const x = position(i);
    if (pinned) {
      const top = window.scrollY + section.getBoundingClientRect().top - header;
      window.scrollTo({ top: top + travel * x / maxScroll, behavior: "instant" });
    }
    viewport.scrollLeft = x;
    controlledX = viewport.scrollLeft;
    display();
  }

  previous.addEventListener("click", () => goTo(active - 1));
  next.addEventListener("click", () => goTo(active + 1));
  viewport.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const focused = cards.indexOf(event.target.closest(".tl-milestone"));
    const from = focused >= 0 ? focused : Math.max(0, active);
    const to = {ArrowLeft:from - 1, ArrowRight:from + 1, Home:0, End:cards.length - 1}[event.key];
    if (to === undefined) return;
    event.preventDefault();
    goTo(to, true);
  });
  viewport.addEventListener("focusin", event => {
    const i = cards.indexOf(event.target.closest(".tl-milestone"));
    if (i >= 0 && event.target.matches(":focus-visible")) goTo(i);
  });
  viewport.addEventListener("scroll", () => {
    // A native horizontal swipe and a vertical scroll both traverse the same
    // track. Keep their positions in sync without cancelling page gestures.
    const top = section.getBoundingClientRect().top;
    if (pinned && Math.abs(viewport.scrollLeft - controlledX) > 1 && top <= header + 2 && top >= header - travel - 2) {
      controlledX = viewport.scrollLeft;
      window.scrollTo({top:window.scrollY + top - header + travel * controlledX / maxScroll, behavior:"instant"});
    }
    display();
  }, {passive:true});
  window.addEventListener("scroll", queue, {passive:true});
  window.addEventListener("resize", measure);
  window.addEventListener("studio-motion", measure);
  tall.addEventListener("change", measure);
  const resize = new ResizeObserver(measure);
  resize.observe(viewport);
  resize.observe(yearNav);
  measure();
}
