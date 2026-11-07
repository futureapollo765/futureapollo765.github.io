const host = document.querySelector("#studio-intro");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const visitKey = "futureapollo765.studio-intro.v4";
const minimumDuration = 4500;
const maximumDuration = 8500;
const exitDuration = 550;

function assembleLogo(logo) {
  // The reference Scratch loop runs at 30 updates per second. Its remaining
  // distance is multiplied by .9 (center size), .875 (outer size), and .75
  // (outer rotation) each update; ghost decreases linearly by 5 points.
  // Sample the continuous equivalents at 120Hz for compositor interpolation,
  // so these same curves keep their timing on every display refresh rate.
  const duration = 3000;
  const samples = duration / 1000 * 120;
  const frames = center => Array.from({ length: samples + 1 }, (_, i) => {
    const ticks = i / samples * duration / 1000 * 30;
    const settled = i === samples;
    const size = settled ? 1 : 1 - Math.pow(center ? .9 : .875, ticks);
    const angle = settled ? 0 : -90 * Math.pow(.75, ticks);
    return {
      offset: i / samples,
      transform: center ? `scale(${size})` : `rotate(${angle}deg) scale(${size})`,
      opacity: Math.min(1, ticks / 20),
    };
  });
  const centerFrames = frames(true), outerFrames = frames(false);
  const delays = { left: 100, top: 200, right: 300, bottom: 400 };
  return [...logo.querySelectorAll(".studio-intro-piece")].flatMap(piece => {
    if (typeof piece.animate !== "function") {
      piece.style.transform = "scale(1)";
      piece.style.opacity = "1";
      return [];
    }
    const center = piece.classList.contains("studio-intro-center");
    return [piece.animate(center ? centerFrames : outerFrames, {
      duration, delay: center ? 0 : delays[piece.dataset.side],
      easing: "linear", fill: "both",
    })];
  });
}

function shouldPlayIntro() {
  const homeEntry = !location.hash || location.hash === "#home";
  if (!host || !homeEntry || reducedMotion.matches ||
      document.documentElement.classList.contains("motion-paused") ||
      !window.HTMLDialogElement) return false;
  try {
    if (localStorage.getItem("futureapollo.motion") === "paused" || sessionStorage.getItem(visitKey)) return false;
    sessionStorage.setItem(visitKey, "seen");
    return true;
  } catch {
    return false;
  }
}

function playIntro() {
  const dialog = document.createElement("dialog");
  dialog.className = "studio-intro-dialog";
  dialog.setAttribute("aria-label", "FutureApollo765 — Initializing");
  dialog.innerHTML = `
    <div class="studio-intro-field" aria-hidden="true"></div>
    <div class="studio-intro-registration" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="studio-intro-core">
      <div class="studio-intro-orbit" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="studio-intro-logo" aria-hidden="true">
        <svg class="studio-intro-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" fill="#fff" focusable="false">
          <defs><path id="studio-intro-arm-shape" d="M2 0h2v2H3V1H2z"/></defs>
          <g class="studio-intro-piece studio-intro-center"><path d="M2 2h1v1H2z"/></g>
          <g class="studio-intro-piece studio-intro-arm" data-side="top"><use href="#studio-intro-arm-shape"/></g>
          <g class="studio-intro-piece studio-intro-arm" data-side="right"><use href="#studio-intro-arm-shape" transform="rotate(90 2.5 2.5)"/></g>
          <g class="studio-intro-piece studio-intro-arm" data-side="bottom"><use href="#studio-intro-arm-shape" transform="rotate(180 2.5 2.5)"/></g>
          <g class="studio-intro-piece studio-intro-arm" data-side="left"><use href="#studio-intro-arm-shape" transform="rotate(270 2.5 2.5)"/></g>
        </svg>
      </div>
      <div class="studio-intro-caption">
        <p class="studio-intro-name">FutureApollo765</p>
        <p class="studio-intro-status">Initializing</p>
        <span class="studio-intro-rail" role="progressbar" aria-label="Initializing"><i></i></span>
      </div>
    </div>`;

  const logo = dialog.querySelector(".studio-intro-logo");

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "studio-intro-skip";
  skip.textContent = "Skip intro";
  dialog.append(skip);
  host.append(dialog);
  host.hidden = false;
  try { dialog.showModal(); }
  catch { dialog.remove(); host.hidden = true; return false; }

  const events = new AbortController();
  const options = { signal: events.signal };
  let phase = "waiting", announced = false;
  let minimumElapsed = false, pageReady = document.readyState === "complete";
  let fontsReady = !document.fonts, animationReady = false;
  let minimumTimer = 0, deadline = 0, exitTimer = 0;
  const assembly = assembleLogo(logo);

  function releasePage() {
    if (announced) return;
    announced = true;
    if (dialog.open) dialog.close();
    window.dispatchEvent(new Event("studio-intro-ended"));
  }

  function removeIntro() {
    if (phase === "removed") return;
    phase = "removed";
    clearTimeout(minimumTimer);
    clearTimeout(deadline);
    clearTimeout(exitTimer);
    events.abort();
    assembly.forEach(animation => animation.cancel());
    releasePage();
    host.hidden = true;
    dialog.remove();
  }

  function beginExit() {
    if (phase !== "waiting") return;
    phase = "exiting";
    clearTimeout(minimumTimer);
    clearTimeout(deadline);
    dialog.classList.add("is-exiting");
    dialog.inert = true;
    // Release modality before fading, so the home entrance can begin beneath
    // this last visual layer instead of appearing only after a black frame.
    releasePage();
    if (phase === "exiting") exitTimer = setTimeout(removeIntro, exitDuration);
  }

  function readyToExit() {
    if (phase === "waiting" && minimumElapsed && pageReady && fontsReady && animationReady) beginExit();
  }

  minimumTimer = setTimeout(() => { minimumElapsed = true; readyToExit(); }, minimumDuration);
  deadline = setTimeout(beginExit, maximumDuration);
  skip.addEventListener("click", removeIntro, options);
  dialog.addEventListener("cancel", event => { event.preventDefault(); removeIntro(); }, options);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); removeIntro(); }
  }, options);
  reducedMotion.addEventListener("change", event => { if (event.matches) removeIntro(); }, options);
  window.addEventListener("studio-motion", event => { if (event.detail === false) removeIntro(); }, options);
  window.addEventListener("pagehide", removeIntro, options);
  window.addEventListener("hashchange", removeIntro, options);
  window.addEventListener("load", () => { pageReady = true; readyToExit(); }, options);
  document.fonts?.ready.then(() => { fontsReady = true; readyToExit(); }, () => { fontsReady = true; readyToExit(); });
  // These are only the five finite logo motions. The atmospheric ring and
  // indeterminate rail are outside logo, so their loops never gate readiness.
  Promise.all(assembly.map(animation => animation.finished.catch(() => {}))).then(() => {
    animationReady = true;
    readyToExit();
  });
  return true;
}

export const recordedIntroStarted = shouldPlayIntro() && playIntro();
