import { projects } from "./project-data.js";
import { createIndexLettering } from "./index-lettering.js";

const clamp = (x, a=0, b=1) => Math.min(b, Math.max(a, x));
const ease = x => x*x*(3-2*x);
const fmt = n => String(n).padStart(2,"0");

// Station zero is the orbit; each subsequent station is an actual shared
// project. The orbit is a continuous scroll composition. Past the orbit, the
// scroll position chooses a station: each title then finishes its own handoff.
export function mountProjectIndex(stage) {
  const entries = projects.slice(0,6);
  const panel = stage.querySelector(".index-panel");
  if (!entries.length) { panel.hidden = stage.querySelector(".index-legend").hidden = true; return null; }
  const seq = stage.closest(".home-sequence");
  seq.style.setProperty("--index-count",entries.length);
  const choices = stage.querySelector(".deck-choices"), deck = stage.querySelector(".project-deck");
  const copy = stage.querySelector(".hero-copy"), instrument = stage.querySelector(".instrument");
  const count = panel.querySelector("[data-index-count]"), title = panel.querySelector("[data-index-title]");
  const link = panel.querySelector("[data-index-link]"), cover = panel.querySelector("[data-index-cover]");
  const windowEl = cover.querySelector(".index-image-window"), plateNumber = cover.querySelector("[data-plate-number]");
  const lettering = createIndexLettering(title);
  const fine = matchMedia("(hover:hover) and (pointer:fine)");
  const reduce = matchMedia("(prefers-reduced-motion:reduce)");
  const motion = () => !reduce.matches && !document.documentElement.classList.contains("motion-paused");
  const images = entries.map(item=>{ const img=new Image(); img.alt="";img.draggable=false;img.decoding="async";img.src=item.thumbnail;return img; });
  choices.style.setProperty("--stations", entries.length+1);
  const measure = document.createElement("canvas").getContext("2d");
  let active = -1, shown = false, raw = 0, pair = "", lastTitle = null, fromTextWidth = 0;
  let transitionFrame = 0, manual = null, expectedY = 0, hoverTimer = 0, swipe = null;
  let settled = 0, desired = 0, natural = 0, flight = null, jumpDirectly = false;
  let layoutKey = "";
  const peers = [panel.querySelector(".index-kicker"),link,cover];
  const adjustments = new WeakMap();

  function fitTitle() {
    if (!title.clientWidth || !measure || !title.textContent) return;
    title.style.removeProperty("font-size");
    const style = getComputedStyle(title), base = parseFloat(style.fontSize);
    measure.font = style.fontWeight+" "+style.fontSize+" "+style.fontFamily;
    const longest = Math.max(...title.textContent.split(/\s+/u).map(w=>measure.measureText(w).width+Math.max(0,w.length-1)*(parseFloat(style.letterSpacing)||0)));
    if (longest > title.clientWidth) title.style.fontSize = base*title.clientWidth/longest*.985+"px";
  }
  new ResizeObserver(([e])=>{if(e.contentRect.width!==fromTextWidth){fromTextWidth=e.contentRect.width;fitTitle();}}).observe(panel.querySelector(".index-copy"));
  document.fonts?.ready.then(fitTitle);

  function scene(from,to,phase) {
    const t = clamp(phase), moving = from!==to && t>0 && t<1;
    const blend = from===0 ? (to===0 ? 0 : t) : to===0 ? 1-t : 1;
    stage.style.setProperty("--index-blend",blend.toFixed(5));
    stage.classList.toggle("has-index-sheet",blend>0);
    shown = blend>=.5;
    stage.classList.toggle("is-inspecting",shown);
    panel.inert = !shown; copy.inert = shown; instrument.inert = blend >= .999;
    const a = Math.max(1,from), b = Math.max(1,to);
    const current = t<.5 ? from : to, project = entries[Math.max(1,current)-1];
    const layout = [from,to,moving,current].join(":");
    const oldPositions = layout!==layoutKey && lastTitle && motion() && from>0 && to>0 ? peers.map(n=>n.getBoundingClientRect().top) : null;
    layoutKey=layout;
    if (current!==active) {
      active = current; link.href = cover.href = "#projects/"+project.id;
      link.setAttribute("aria-label","Open "+project.title);
      count.textContent = fmt(Math.max(1,current))+" / "+fmt(entries.length);
      plateNumber.textContent = fmt(Math.max(1,current));
      for(const [i,button] of [...choices.children].entries()){
        button.setAttribute("aria-pressed",String(i===current));button.tabIndex=i===current?0:-1;
      }
    }
    const mark = from+(to-from)*t;
    choices.style.setProperty("--active-slot",mark.toFixed(5));
    // Only one title is ever readable. Its baseline rises through the shared
    // horizontal mask; on a reading hold both rectangle and lettering rest.
    const direction = to >= from ? 1 : -1;
    const wipe = moving && from>0 && to>0;
    const startTitle = entries[a-1].title, endTitle = entries[b-1].title;
    lettering.show(wipe ? endTitle : project.title, {fromText:startTitle,progress:t,direction,animate:wipe});
    const lift = wipe ? (t<.5 ? -t*2 : (1-t)*2)*14 : 0;
    title.style.setProperty("--label-rise",lift.toFixed(2)+"px");
    title.style.setProperty("--letter-alpha", wipe ? (Math.abs(t-.5)*2).toFixed(4) : "1");
    if (lastTitle!==title.textContent) {
      lastTitle=title.textContent;
      title.classList.toggle("index-title-long",lastTitle.length>18);
      fitTitle();
    }
    if (oldPositions) peers.forEach((n,i)=>{
      adjustments.get(n)?.cancel();
      const dy=oldPositions[i]-n.getBoundingClientRect().top;
      if (Math.abs(dy)>1) adjustments.set(n,n.animate([{translate:"0 "+dy+"px"},{translate:"0 0"}],{duration:580,easing:"cubic-bezier(.18,.75,.2,1)"}));
    });
    const startImage = images[a-1], endImage = images[b-1];
    const pairKey = a+":"+b;
    if (pair!==pairKey) {
      pair=pairKey;
      if(a===b) windowEl.replaceChildren(startImage);
      else windowEl.replaceChildren(startImage,endImage);
    }
    startImage.style.clipPath = "none";
    startImage.style.transform = "none";
    startImage.toggleAttribute("data-active-photo",current===a || a===b);
    if(a!==b) {
      endImage.toggleAttribute("data-active-photo",current===b);
      endImage.style.clipPath = direction>0 ? "inset(0 0 0 "+((1-t)*100).toFixed(3)+"%)" : "inset(0 "+((1-t)*100).toFixed(3)+"% 0 0)";
      endImage.style.transform = "scale("+(1+.045*(1-t)).toFixed(5)+")";
    }
  }
  function stopTween() {
    cancelAnimationFrame(transitionFrame); transitionFrame=0; flight=null;
  }
  function rest(station) {
    stopTween(); settled=desired=station; scene(station,station,1);
  }
  function turn(station, direct=false) {
    desired=station; jumpDirectly=direct;
    if (!motion() || document.hidden || stage.closest("[hidden]")) { rest(station); return; }
    if (flight) return; // Reversals change the existing spring's destination.
    if (settled===station) return;
    const to = direct ? station : settled+Math.sign(station-settled);
    const f = flight = {from:settled,to,p:0,v:0,last:performance.now()};
    function tick(now) {
      if (flight!==f) return;
      if (!motion() || document.hidden || stage.closest("[hidden]")) { rest(desired); return; }
      // Exact critically damped spring. Retarget without dropping velocity;
      // the outgoing and incoming frames retrace the very same line masks.
      const end = (desired-f.from)*(f.to-f.from)>0 ? 1 : 0;
      const dt=Math.max(0, (now-f.last)/1000); f.last=now;
      const rate=4.7, offset=f.p-end, slope=f.v+rate*offset, decay=Math.exp(-rate*dt);
      f.p=end+(offset+slope*dt)*decay; f.v=(f.v-rate*slope*dt)*decay;
      const p=ease(clamp(f.p));
      scene(f.from,f.to,p);
      if (Math.abs(f.p-end)>.014 || Math.abs(f.v)>.078) {
        transitionFrame=requestAnimationFrame(tick);
      } else {
        settled=end ? f.to : f.from; flight=null; transitionFrame=0;
        scene(settled,settled,1);
        if(desired!==settled) turn(desired,jumpDirectly);
      }
    }
    transitionFrame=requestAnimationFrame(tick);
  }
  function scrollScene(value, immediate=false) {
    if(value<1) {
      natural=1; stopTween();
      const p=ease(clamp(value/.83));
      settled=desired=p<.5 ? 0 : 1; scene(0,1,p);
      return;
    }
    // A small dead band around each boundary keeps a resting title stable
    // if the wheel or finger rocks back a few pixels in either direction.
    natural=clamp(natural,1,entries.length);
    while(natural<entries.length && value>=natural+.52) natural++;
    while(natural>1 && value<=natural-.58) natural--;
    if(immediate) rest(natural); else turn(natural);
  }
  function override(station, hover=false) {
    clearTimeout(hoverTimer);
    manual={station,hover};
    turn(station,true);
  }
  // Let a sustained gesture continue as the visible handoff advances. The
  // allowance follows the presentation, not an idle timer: there is no need
  // to release a trackpad or pause a wheel before reaching the next project.
  function constrainWheel(target, actual) {
    const distance=seq.offsetHeight-stage.offsetHeight;
    if(!motion() || !distance || stage.closest("[hidden]")) return target;
    const start=scrollY+seq.getBoundingClientRect().top-document.querySelector(".site-header").offsetHeight;
    const unit=distance/entries.length;
    const pos=(actual-start)/unit;
    const sign=Math.sign(target-actual);
    const exiting=sign>0 && flight?.to===entries.length;
    if(!sign || pos<-.002 || pos>entries.length+(exiting ? .75 : .002)) return target;
    const anchor=manual && !manual.hover ? manual.station : settled;
    // Admit the following interval throughout this handoff. Waiting until
    // its final frames would still flatten a continuous scroll at each edge.
    const forwardFlight=flight && Math.sign(flight.to-flight.from)===sign;
    const follow=forwardFlight ? ease(clamp(flight.p)) : 0;
    const lead=forwardFlight ? flight.from+(flight.to-flight.from)*follow : anchor;
    if(!flight && (sign>0 ? lead>=entries.length : lead<=0)) return target;
    // The last cover can begin yielding to Studies during its final reveal;
    // holding the document exactly at its edge would introduce another stop.
    const end=entries.length+(exiting ? follow*.72 : 0);
    const limit=start+clamp(lead+sign*.66,0,end)*unit;
    return sign>0 ? Math.min(target,Math.max(actual,limit)) : Math.max(target,Math.min(actual,limit));
  }
  function choose(index, moveFocus=false) {
    const station = index+1;
    const distance = seq.offsetHeight-stage.offsetHeight;
    const header = document.querySelector(".site-header").offsetHeight;
    expectedY = scrollY;
    if (motion() && distance>1) {
      const start=scrollY+seq.getBoundingClientRect().top-header;
      expectedY=Math.max(0,Math.round(start + (station===entries.length ? station-.09 : station)*distance/entries.length));
      // The scene is pinned at both positions. Move its document coordinate
      // directly; the selection animates only the two requested projects.
      window.scrollTo({top:expectedY,behavior:"instant"});
      expectedY=scrollY;
    } else {
      const clipped=stage.getBoundingClientRect().top-header;
      if(clipped < -1) window.scrollBy({top:clipped,behavior:"instant"});
      expectedY=scrollY;
    }
    natural=Math.max(1,station);
    override(station);
    const button=choices.children[station];
    if(moveFocus) button.focus({preventScroll:true});
    const left=button.offsetLeft,right=left+button.offsetWidth;
    if(left<choices.scrollLeft)choices.scrollLeft=left;
    else if(right>choices.scrollLeft+choices.clientWidth)choices.scrollLeft=right-choices.clientWidth;
  }
  for (const [i, item] of [null, ...entries].entries()) {
    const index = i - 1;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", item ? "Preview " + item.title : "Show orbital assembly");
    const number = document.createElement("span");
    number.className = "deck-number";
    number.textContent = item ? fmt(i) : "◎";
    const label = document.createElement("span");
    label.className = "deck-label";
    label.textContent = item?.title ?? "Orbit";
    button.append(number, label); choices.append(button);
    button.addEventListener("click", () => choose(index));
    button.addEventListener("pointerenter", event => {
      if (!fine.matches || event.pointerType === "touch" || choices.contains(document.activeElement) && document.activeElement.matches(":focus-visible") || panel.contains(document.activeElement)) return;
      clearTimeout(hoverTimer);
      // Cross the ruler freely. Only a deliberate hover changes the plate.
      hoverTimer = setTimeout(() => { expectedY=scrollY; override(i,true); }, 110);
    });
    button.addEventListener("pointerleave", () => clearTimeout(hoverTimer));
  }
  choices.addEventListener("keydown", event => {
    const i = [...choices.children].indexOf(event.target);
    if (i < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" && i && (manual?.station === i || shown && active === i)) {
      if (active!==i) rest(i);
      event.preventDefault();
      link.click();
      return;
    }
    const n = choices.children.length;
    const next = {ArrowRight:(i + 1) % n, ArrowLeft:(i+n-1) % n, Home:0, End:n-1}[event.key];
    if (next === undefined) return;
    event.preventDefault(); choose(next - 1, true);
  });
  stage.addEventListener("pointerleave", () => {
    clearTimeout(hoverTimer);
    if (!manual?.hover || panel.contains(document.activeElement)) return;
    manual=null;
    if(raw===0 || raw>=.83 && raw<1) turn(raw===0 ? 0 : 1,true);
    else scrollScene(raw);
  });
  // The displayed cover is also a directly scrubbable stack on a phone.
  cover.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    swipe = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
  });
  cover.addEventListener("dragstart", event => event.preventDefault());
  cover.addEventListener("pointermove", event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (!swipe.moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) < Math.abs(dy)) { swipe = null; return; }
      swipe.moved = true; cover.setPointerCapture(event.pointerId);
    }
    if (motion()) windowEl.style.setProperty("--scrub", Math.max(-22, Math.min(22, dx*.18))+"px");
  });
  let cancelClick = false;
  function endSwipe(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    cancelClick = swipe.moved && event.type === "pointerup";
    if (cancelClick && Math.abs(dx) > 30) choose((Math.max(0,active-1) + (dx < 0 ? 1 : -1) + entries.length) % entries.length);
    swipe = null; windowEl.style.removeProperty("--scrub");
  }
  cover.addEventListener("pointerup",endSwipe);
  cover.addEventListener("pointercancel",endSwipe);
  cover.addEventListener("pointerdown",() => { cancelClick = false; });
  cover.addEventListener("click",event => { if (cancelClick) {event.preventDefault(); cancelClick = false;} });
  deck.hidden = false;
  scrollScene(0);
  return {
    constrainWheel,
    travel(progress) {
      raw=clamp(progress)*entries.length;
      if(manual && Math.abs(scrollY-expectedY) < 2) return;
      if(manual && !motion()) return;
      manual=null;
      const offscreen=stage.getBoundingClientRect().bottom <= document.querySelector(".site-header").offsetHeight;
      scrollScene(raw,offscreen);
    },
    snapshot() {return {index:active-1, indexManual:!!manual};},
    restore(state) {
      stopTween(); clearTimeout(hoverTimer); manual=null;
      if (state && Number.isInteger(state.index) && (state.indexManual !== false || !motion())) {
        expectedY=scrollY; const station=clamp(state.index+1,0,entries.length);
        manual={station,hover:false};natural=Math.max(1,station);rest(station);
      } else scrollScene(raw,true);
    }
  };
}
