const host = document.querySelector("#studio-intro");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const visitKey = "futureapollo765.studio-intro.v1";

function shouldPlayIntro() {
  if (!host || location.hash || reducedMotion.matches || !window.HTMLDialogElement) {
    return false;
  }
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
  dialog.setAttribute("aria-label", "Studio opening animation");

  const film = document.createElement("video");
  film.className = "studio-intro-film";
  film.poster = new URL("./assets/studio.svg", import.meta.url).href;
  film.muted = true;
  film.playsInline = true;
  film.disablePictureInPicture = true;
  film.setAttribute("aria-hidden", "true");

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "studio-intro-skip";
  skip.textContent = "Skip intro";
  dialog.append(film, skip);
  host.append(dialog);
  host.hidden = false;
  dialog.showModal();

  function onMotion(event) {
    if (!event.detail) dismiss();
  }

  function dismiss() {
    if (!dialog.isConnected) return;
    clearTimeout(deadline);
    reducedMotion.removeEventListener("change", dismiss);
    window.removeEventListener("pagehide", dismiss);
    window.removeEventListener("hashchange", dismiss);
    window.removeEventListener("studio-motion", onMotion);
    film.pause();
    dialog.close();
    host.hidden = true;
    dialog.remove();
    window.dispatchEvent(new Event("studio-intro-ended"));
  }

  const deadline = setTimeout(dismiss, 3200);
  skip.addEventListener("click", dismiss, { once: true });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  film.addEventListener("ended", dismiss, { once: true });
  film.addEventListener("error", dismiss, { once: true });
  reducedMotion.addEventListener("change", dismiss);
  window.addEventListener("pagehide", dismiss, { once: true });
  window.addEventListener("hashchange", dismiss, { once: true });
  window.addEventListener("studio-motion", onMotion);
  film.src = new URL("./assets/studio-intro.mp4", import.meta.url);
  film.play().catch(dismiss);
}

export const recordedIntroStarted = shouldPlayIntro();
if (recordedIntroStarted) playIntro();
