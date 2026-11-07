const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => n * n * (3 - 2 * n);
const px = n => n.toFixed(3) + "px";

// A Range follows the actual line breaks, including balanced headings and
// words wrapped mid-word. Mixed fonts or bidi runs can yield several fragments
// on the same line; their union defines one independent wipe.
function renderedLines(label, style, measure) {
  const box = label.getBoundingClientRect();
  if (!box.width || !box.height || !label.firstChild) return [];
  const contentBox = style.boxSizing !== "border-box";
  const width = (parseFloat(style.width) || box.width) + (contentBox ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0);
  const height = (parseFloat(style.height) || box.height) + (contentBox ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0);
  const sx = width / box.width, sy = height / box.height;
  const tolerance = (parseFloat(style.lineHeight) || parseFloat(style.fontSize)) * .5;
  const range = label.ownerDocument.createRange();
  range.selectNodeContents(label);
  const fragments = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    .map(r => ({ x: (r.left - box.left) * sx, right: (r.right - box.left) * sx,
      top: (r.top - box.top) * sy, bottom: (r.bottom - box.top) * sy,
      center: (r.top + r.height / 2 - box.top) * sy }))
    .sort((a, b) => a.center - b.center || a.x - b.x);
  const rows = [];
  for (const fragment of fragments) {
    const row = rows.at(-1);
    if (row && Math.abs(row.center - fragment.center) < tolerance) {
      row.x = Math.min(row.x, fragment.x);
      row.right = Math.max(row.right, fragment.right);
      row.top = Math.min(row.top, fragment.top);
      row.bottom = Math.max(row.bottom, fragment.bottom);
    } else rows.push({ ...fragment, text: "" });
  }

  // A line box can be shorter than its glyph ink (.98 leading is intentional).
  // Range rectangles locate the actual wrapped lines; their text metrics place
  // the baseline and ink, including fallback fonts and g/p descenders. Reading
  // each character only happens when the cached typography changes.
  const node = label.firstChild;
  let offset = 0;
  for (const character of node.textContent) {
    range.setStart(node, offset);
    offset += character.length;
    range.setEnd(node, offset);
    const rect = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0);
    if (!rect) continue;
    const center = (rect.top + rect.height / 2 - box.top) * sy;
    const row = rows.reduce((closest, candidate) => !closest ||
      Math.abs(candidate.center - center) < Math.abs(closest.center - center) ? candidate : closest, null);
    if (row) row.text += character;
  }
  const fontSize = parseFloat(style.fontSize) || 16;
  const breathing = Math.max(1.5, fontSize * .035);
  const horizontalBleed = breathing + Math.max(0, -(parseFloat(style.letterSpacing) || 0));
  if (measure) measure.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
  for (const row of rows) {
    const metrics = measure?.measureText(row.text.trim());
    if (metrics && Number.isFinite(metrics.fontBoundingBoxAscent)) {
      const baseline = row.top + metrics.fontBoundingBoxAscent;
      row.inkTop = baseline - metrics.actualBoundingBoxAscent;
      row.inkBottom = baseline + metrics.actualBoundingBoxDescent;
    } else {
      row.inkTop = row.top;
      row.inkBottom = row.bottom;
    }
  }
  return rows.map((row, i) => {
    // Share only the empty space between adjacent glyph runs. The old
    // center-to-center partition sliced a descender on a tight first line.
    const top = i ? Math.max(row.inkTop - breathing, (rows[i - 1].inkBottom + row.inkTop) / 2 + .5) : row.inkTop - breathing;
    const bottom = i + 1 < rows.length ? Math.min(row.inkBottom + breathing, (row.inkBottom + rows[i + 1].inkTop) / 2 - .5) : row.inkBottom + breathing;
    return { x: row.x - horizontalBleed, y: top,
      width: row.right - row.x + 2 * horizontalBleed, height: Math.max(1, bottom - top) };
  });
}

export function createIndexLettering(titleNode) {
  const doc = titleNode.ownerDocument;
  const win = doc.defaultView;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const measure = doc.createElement("canvas").getContext("2d");
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
    const key = [label.textContent, style.width, style.height, style.paddingLeft, style.paddingTop,
      style.fontFamily, style.fontSize, style.fontStyle, style.fontWeight, style.letterSpacing,
      style.lineHeight, style.textAlign, style.textWrap].join("\n");
    if (key === savedKey && rows.length) return;
    rows = renderedLines(label, style, measure);
    savedKey = key;
    while (masks.children.length > rows.length) masks.lastElementChild.remove();
    for (const [index, row] of rows.entries()) {
      let band = masks.children[index];
      if (!band) {
        band = doc.createElement("span");
        band.className = "index-lettering-mask";
        masks.append(band);
      }
      // The label has paint-only padding canceled by negative margins. Its
      // masks use that larger border box; the stationary bands use the frame.
      band.style.left = px(row.x - parseFloat(style.paddingLeft));
      band.style.top = px(row.y - parseFloat(style.paddingTop));
      band.style.width = px(row.width);
      band.style.height = px(row.height);
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
