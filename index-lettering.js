const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => n * n * (3 - 2 * n);
const px = n => n.toFixed(3) + "px";

// A Range follows the actual line breaks, including balanced headings and
// words wrapped mid-word. Mixed fonts or bidi runs can yield several fragments
// on the same line; their union defines one independent wipe.
function renderedLines(label, style) {
  const box = label.getBoundingClientRect();
  if (!box.width || !box.height || !label.firstChild) return [];
  const width = parseFloat(style.width) || box.width;
  const height = parseFloat(style.height) || box.height;
  const sx = width / box.width, sy = height / box.height;
  const tolerance = (parseFloat(style.lineHeight) || parseFloat(style.fontSize)) * .5;
  const range = label.ownerDocument.createRange();
  range.selectNodeContents(label);
  const fragments = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    .map(r => ({ x: (r.left - box.left) * sx, right: (r.right - box.left) * sx,
      center: (r.top + r.height / 2 - box.top) * sy }))
    .sort((a, b) => a.center - b.center || a.x - b.x);
  const rows = [];
  for (const fragment of fragments) {
    const row = rows.at(-1);
    if (row && Math.abs(row.center - fragment.center) < tolerance) {
      row.x = Math.min(row.x, fragment.x);
      row.right = Math.max(row.right, fragment.right);
    } else rows.push({ ...fragment });
  }
  return rows.map((row, i) => {
    const top = i ? (rows[i - 1].center + row.center) / 2 : 0;
    const bottom = i + 1 < rows.length ? (row.center + rows[i + 1].center) / 2 : height;
    return { x: row.x, y: top, width: row.right - row.x, height: Math.max(1, bottom - top) };
  });
}

export function createIndexLettering(titleNode) {
  const doc = titleNode.ownerDocument;
  const win = doc.defaultView;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const frame = doc.createElement("span");
  frame.className = "index-lettering-frame";
  const label = doc.createElement("span");
  label.className = "index-lettering-label";
  label.textContent = titleNode.textContent;
  const masks = doc.createElement("span");
  masks.className = "index-lettering-lines";
  masks.setAttribute("aria-hidden", "true");
  // Only the current, semantic label contributes to layout. Reserving both
  // titles would rewrap the outgoing one in the incoming font, keeping excess
  // height until the end of the wipe. The hidden midpoint is the reflow point.
  frame.append(label, masks);
  titleNode.replaceChildren(frame);

  let pair = null, timer = 0, lastProgress = null;
  let savedKey = "", rows = [];
  const motion = () => !reduced.matches && !doc.documentElement.classList.contains("motion-paused");

  function clearVisuals() {
    masks.hidden = true;
    label.removeAttribute("data-wiping");
    label.style.removeProperty("opacity");
  }

  function setLabel(text) {
    if (label.textContent !== text) label.textContent = text;
  }

  function settle(text) {
    lastProgress = null;
    setLabel(text);
    clearVisuals();
  }

  function measureRows() {
    const style = win.getComputedStyle(label);
    const key = [label.textContent, style.width, style.height, style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing,
      style.lineHeight, style.textAlign, style.textWrap].join("\n");
    if (key === savedKey && rows.length) return;
    rows = renderedLines(label, style);
    savedKey = key;
    while (masks.children.length > rows.length) masks.lastElementChild.remove();
    for (const [index, row] of rows.entries()) {
      let band = masks.children[index];
      if (!band) {
        band = doc.createElement("span");
        band.className = "index-lettering-mask";
        masks.append(band);
      }
      band.style.left = px(row.x);
      // Keep a sliver of the stage between bands even on tight display type.
      const inset = Math.min(6, row.height * .075);
      band.style.top = px(row.y + inset);
      band.style.width = px(row.width);
      band.style.height = px(Math.max(1, row.height - 2 * inset));
    }
  }

  function paint(progress) {
    const p = clamp(progress);
    const incoming = p >= .5;
    const text = incoming ? pair.to : pair.from;
    if (!motion()) { settle(text); return; }
    lastProgress = p;
    setLabel(text);
    if (p === 0 || p === 1) { clearVisuals(); return; }

    // Every outgoing band has cleared before the first incoming band starts.
    // Keeping one semantic text node also keeps copying and screen-reader
    // navigation identical to an ordinary heading.
    const phase = incoming ? clamp((p - .53) / .47) : clamp(p / .47);
    if (p >= .47 && p <= .53) {
      clearVisuals();
      label.style.opacity = "0";
      return;
    }
    measureRows();
    if (!rows.length) { clearVisuals(); return; }
    masks.hidden = false;
    const images = [], positions = [], sizes = [];
    const stagger = rows.length > 1 ? .29 : 0;
    for (const [i, row] of rows.entries()) {
      const delay = rows.length > 1 ? stagger * i / (rows.length - 1) : 0;
      const line = clamp((phase - delay) / (1 - stagger));
      const front = ease(clamp(line / .47));
      const rear = ease(clamp((line - .52) / .48));
      const forward = pair.direction === 1;
      const band = masks.children[i];
      const clipLeft = forward ? rear : 1 - front;
      const clipRight = forward ? 1 - front : rear;
      band.style.clipPath = "inset(0 " + (clipRight * 100).toFixed(3) + "% 0 " + (clipLeft * 100).toFixed(3) + "%)";
      // The outgoing text remains ahead of the band; the incoming text is
      // revealed behind it. The blank region never exposes the other title.
      const exposed = incoming ? rear : 1 - front;
      const showLeft = incoming === forward;
      images.push("linear-gradient(#000, #000)");
      positions.push(px(row.x + (showLeft ? 0 : row.width * (1 - exposed))) + " " + px(row.y));
      sizes.push(px(row.width * exposed) + " " + px(row.height));
    }
    label.setAttribute("data-wiping", "");
    label.style.removeProperty("opacity");
    label.style.setProperty("--letter-line-images", images.join(","));
    label.style.setProperty("--letter-line-positions", positions.join(","));
    label.style.setProperty("--letter-line-sizes", sizes.join(","));
  }

  function refreshLayout() {
    savedKey = "";
    if (pair && lastProgress !== null) paint(lastProgress);
  }
  const observer = new win.ResizeObserver(refreshLayout);
  observer.observe(frame);
  observer.observe(label);
  doc.fonts?.ready.then(refreshLayout);
  doc.fonts?.addEventListener("loadingdone", refreshLayout);

  function show(text, options = {}) {
    const to = String(text ?? "");
    const timed = options.progress === undefined;
    const sameScrub = (!timed || timer) && pair?.to === to;
    const from = String(options.fromText ?? (sameScrub ? pair.from : label.textContent));
    const direction = options.direction === -1 ? -1 : 1;
    if (timer && timed && options.animate && pair?.from === from && pair.to === to && pair.direction === direction) return;
    win.cancelAnimationFrame(timer);
    timer = 0;
    if (!options.animate || from === to) { pair = null; settle(to); return; }
    pair = { from, to, direction };
    if (!timed) { paint(Number.isFinite(options.progress) ? options.progress : 1); return; }
    if (!motion()) { settle(to); return; }
    const started = win.performance.now();
    paint(0);
    function advance(now) {
      const p = motion() ? Math.min(1, (now - started) / 560) : 1;
      if (p < 1) paint(p); else settle(pair.to);
      timer = p < 1 ? win.requestAnimationFrame(advance) : 0;
    }
    timer = win.requestAnimationFrame(advance);
  }
  return { show };
}
