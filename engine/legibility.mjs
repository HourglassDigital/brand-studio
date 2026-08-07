// Legibility gate: measure the LIVE page before the screenshot and refuse to ship a
// render whose text a reader cannot actually read.
//
// Why this exists: an infographic is authored as hand-placed HTML/SVG, so a label can
// be laid down at a point that happens to sit under a node box, outside the card, or on
// top of another label. Nothing in the render path noticed, and a self-review by eye
// missed it, so a chart shipped to a client with "Owns & controls" reading "owns & c".
// Geometry is measurable, so measure it.
//
// The four checks:
//   covered   text painted over by a later, opaque element (the org-chart bug)
//   clipped   text extending outside the frame / its card
//   overlap   two text runs sitting on top of each other
//   tiny      text below a minimum rendered size
//   contrast  text too close in luminance to whatever is behind it
//
// Everything is measured in CSS pixels on the real, font-loaded page. No heuristics
// about character widths: the browser has already done the layout.

export const DEFAULTS = {
  minFontSize: 11, // px, CSS. Below this nothing survives a social crop.
  coverTolerance: 0.06, // fraction of a label's sample points allowed to be covered
  overlapTolerance: 0.08, // fraction of the smaller text rect allowed to intersect
  minContrast: 3.0, // WCAG ratio. Deliberately below 4.5: flag the clear failures only.
  ignoreSelector: "[data-legibility-ignore]", // authored opt-out for deliberate cases
};

// Runs INSIDE the page. Self-contained on purpose: Playwright serialises the source,
// so it may not close over anything from this module.
export function auditInPage(opts) {
  const {
    minFontSize,
    coverTolerance,
    overlapTolerance,
    minContrast,
    ignoreSelector,
    frameSelector,
  } = opts;

  const findings = [];
  const frame = document.querySelector(frameSelector) || document.body;
  const frameRect = frame.getBoundingClientRect();

  // ---- colour helpers -------------------------------------------------------
  const parseColor = (c) => {
    if (!c || c === "none" || c === "transparent") return null;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/]/).map((v) => parseFloat(v.trim()));
    if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => {
    // Composite fg over bg (both {r,g,b,a}), returning an opaque colour.
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 255, g: 255, b: 255, a: 1 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  // What an element paints BEHIND text, whether it is HTML (background-color) or SVG (fill).
  // Only shapes count. An <svg> or <g> reports a computed fill of black while painting
  // nothing, and an SVG <text>'s fill is glyph ink rather than a backdrop: treating either
  // as a background makes every label look like dark-on-dark.
  const SVG_SHAPES = ["rect", "circle", "ellipse", "path", "polygon", "polyline", "image", "use"];
  const paintOf = (node) => {
    if (!node || !node.tagName) return null;
    const tag = node.tagName.toLowerCase();
    const cs = getComputedStyle(node);
    const go = parseFloat(cs.opacity || "1");
    if (node.ownerSVGElement || tag === "svg") {
      if (!SVG_SHAPES.includes(tag)) return null;
      const fill = parseColor(cs.fill); // `none` and url(...) parse to null: they paint no flat colour
      if (!fill) return null;
      const o = parseFloat(cs.fillOpacity || "1");
      return { ...fill, a: fill.a * (Number.isNaN(o) ? 1 : o) * (Number.isNaN(go) ? 1 : go) };
    }
    const bg = parseColor(cs.backgroundColor);
    if (!bg) return null;
    return { ...bg, a: bg.a * (Number.isNaN(go) ? 1 : go) };
  };

  // ---- collect the text runs ------------------------------------------------
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList && el.classList.length ? `.${[...el.classList].join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const runs = [];
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue || "").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest(ignoreSelector)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    runs.push({ node: n, el, text, rects, fontSize: parseFloat(cs.fontSize), color: parseColor(cs.fill && el.ownerSVGElement ? cs.fill : cs.color) });
  }

  // ---- per-run checks -------------------------------------------------------
  for (const run of runs) {
    const { el, text, rects, fontSize } = run;

    if (fontSize && fontSize < minFontSize) {
      findings.push({ kind: "tiny", text, where: describe(el), detail: `${fontSize.toFixed(1)}px, floor is ${minFontSize}px` });
    }

    for (const r of rects) {
      // --- clipped by the frame ---
      const out = {
        left: frameRect.left - r.left,
        right: r.right - frameRect.right,
        top: frameRect.top - r.top,
        bottom: r.bottom - frameRect.bottom,
      };
      const worst = Object.entries(out).sort((a, b) => b[1] - a[1])[0];
      if (worst[1] > 1) {
        findings.push({ kind: "clipped", text, where: describe(el), detail: `${worst[1].toFixed(0)}px past the ${worst[0]} edge of ${frameSelector}` });
      }

      // --- covered by something painted later ---
      const cols = 7, rows = 3;
      let sampled = 0, covered = 0, coverer = null;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = r.left + ((i + 0.5) / cols) * r.width;
          const y = r.top + ((j + 0.5) / rows) * r.height;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          sampled++;
          const hit = document.elementFromPoint(x, y);
          if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
          // Only elements painted AFTER this text can be on top of it. An earlier
          // element (a knockout chip, the card, the background) is behind it.
          const pos = el.compareDocumentPosition(hit);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          const fill = paintOf(hit);
          if (!fill || fill.a < 0.5) continue;
          covered++;
          coverer = coverer || describe(hit);
        }
      }
      if (sampled && covered / sampled > coverTolerance) {
        findings.push({
          kind: "covered",
          text,
          where: describe(el),
          detail: `${Math.round((covered / sampled) * 100)}% of the label is painted over by ${coverer}`,
        });
      }

      // --- contrast against whatever is actually behind it ---
      if (run.color && run.color.a > 0.1) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
          // Everything from the text's own element downwards in the hit stack is behind it.
          // Start AT `el`, not after it: for HTML the text sits on its own element's
          // background, which is exactly the backdrop being asked about.
          // The stack is frontmost-first, so ACCUMULATE front-to-back: each deeper layer
          // slides UNDER what is already gathered (acc over p), and an opaque layer ends
          // the walk without discarding the translucent layers above it. Getting this
          // backwards measured white-on-white for white text on a translucent dark chip.
          const stack = document.elementsFromPoint(cx, cy);
          const self = stack.indexOf(el);
          let acc = { r: 0, g: 0, b: 0, a: 0 };
          for (const e of self >= 0 ? stack.slice(self) : stack) {
            const p = paintOf(e);
            if (!p || p.a === 0) continue;
            acc = over(acc, p);
            if (p.a >= 1) break;
          }
          const backdrop = over(acc, { r: 255, g: 255, b: 255, a: 1 });
          const ratio = contrast(over(run.color, backdrop), backdrop);
          if (ratio < minContrast) {
            findings.push({ kind: "contrast", text, where: describe(el), detail: `${ratio.toFixed(2)}:1 against its backdrop, floor is ${minContrast}:1` });
          }
        }
      }
    }
  }

  // ---- text-on-text overlap -------------------------------------------------
  const flat = [];
  for (const run of runs) for (const r of run.rects) flat.push({ run, r });
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i], b = flat[j];
      if (a.run.el === b.run.el) continue;
      if (a.run.el.contains(b.run.el) || b.run.el.contains(a.run.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || h <= 0) continue;
      const inter = w * h;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (smaller > 0 && inter / smaller > overlapTolerance) {
        findings.push({
          kind: "overlap",
          text: a.run.text,
          where: describe(a.run.el),
          detail: `${Math.round((inter / smaller) * 100)}% overlapped by "${b.run.text}" (${describe(b.run.el)})`,
        });
      }
    }
  }

  // De-duplicate: one finding per (kind, text, where).
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.kind}|${f.text}|${f.where}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const LABEL = {
  covered: "painted over",
  clipped: "outside the frame",
  overlap: "overlapping text",
  tiny: "below the size floor",
  contrast: "too low contrast",
};

export function formatFindings(findings, { limit = 25 } = {}) {
  const shown = findings.slice(0, limit);
  const lines = shown.map((f) => `  [${LABEL[f.kind] || f.kind}] "${f.text}" (${f.where}): ${f.detail}`);
  if (findings.length > shown.length) lines.push(`  ... and ${findings.length - shown.length} more`);
  return lines.join("\n");
}
