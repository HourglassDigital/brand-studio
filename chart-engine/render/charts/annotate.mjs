// Chart-type-agnostic annotations. Annotations are anchored through each chart
// type's own geometry and always use the built-in orthogonal elbow. Brand kits
// are data only in brand-studio, so no per-brand connector code is loaded.

import { escapeHtml } from "./util.mjs";

/**
 * Draw every annotation. resolve() is the chart type's anchor: it takes one
 * annotation entry and returns { x, y } in canvas pixels (the validator has
 * already guaranteed the target exists).
 */
export function renderAnnotations({ annotations, resolve, muted, t }) {
  return (annotations || [])
    .map((a) => {
      const { x, y } = resolve(a);
      return elbowAnnotation({ ...a, cx: x, cy: y }, { muted, t });
    })
    .join("");
}

// Anchor resolvers. Each maps an annotation's declared target onto the pixel
// the leader should point at, using the geometry the renderer already built.

/** bar: { category, series? } -> bar top centre (or stack/group top). */
export function barAnchor(a, { categories, names, series, x0, x1, y, stacked }) {
  const cat = String(a.category);
  if (a.series != null) {
    const si = names.indexOf(String(a.series));
    const ci = categories.indexOf(cat);
    const v = +series[si].values[ci].y;
    if (stacked) {
      let cum = 0;
      for (let k = 0; k <= si; k++) cum += +series[k].values[ci].y;
      return { x: x0(cat) + x0.bandwidth() / 2, y: y(cum) };
    }
    return { x: x0(cat) + x1(names[si]) + x1.bandwidth() / 2, y: y(v) };
  }
  const ci = categories.indexOf(cat);
  const top = stacked
    ? series.reduce((sum, s) => sum + +s.values[ci].y, 0)
    : Math.max(...series.map((s) => +s.values[ci].y));
  return { x: x0(cat) + x0.bandwidth() / 2, y: y(top) };
}

/** pie: { slice } -> arc centroid at the outer radius. */
export function pieAnchor(a, { arcs, values, cx, cy, R }) {
  const i = values.findIndex((v) => v.label === String(a.slice));
  const mid = (arcs[i].startAngle + arcs[i].endAngle) / 2;
  // d3 measures angles clockwise from 12 o'clock, so x grows with sin.
  return { x: cx + Math.sin(mid) * R, y: cy - Math.cos(mid) * R };
}

// The built-in leader: a rounded right-angle elbow from the label to the data
// point ending in a chevron oriented along the direction of approach. Moved
// verbatim from the area renderer when annotations went chart-type-agnostic;
// the only change is that label text draws in the annotation role instead of
// hardcoded monospace.

function elbowAnnotation(a, { muted, t }) {
  const dx = a.dx != null ? a.dx : 90;
  const dy = a.dy != null ? a.dy : -50;
  const tx = a.cx + dx;
  const ty = a.cy + dy;
  const labelLines = String(a.text || "").split("\n");
  const lineH = 30;

  // Leader starts at the label edge nearest the point, vertically centred on
  // the first line of text.
  const longest = Math.max(...labelLines.map((ln) => ln.length));
  const startX = dx >= 0 ? tx - 10 : tx + longest * 15.6 + 10;
  const startY = ty - 9;

  const standOff = 8; // leader stops short of the data point
  const sx = a.cx >= startX ? 1 : -1; // horizontal direction of travel
  const goingDown = a.cy > startY;
  const sy = goingDown ? 1 : -1; // vertical direction of travel
  const endY = a.cy - sy * standOff;

  let leader;
  if (Math.abs(a.cy - startY) < 14) {
    // Level with the point: single horizontal run, chevron pointing sideways.
    const endX = a.cx - sx * standOff;
    leader =
      `<path d="M ${startX} ${startY} H ${endX}" fill="none" stroke="${muted}"
             stroke-width="2.5" stroke-linecap="round"/>` +
      chevron(a.cx - sx * 3, startY, sx > 0 ? "right" : "left", muted);
  } else {
    const r = Math.min(12, Math.abs(endY - startY) / 2, Math.abs(a.cx - startX) / 2);
    leader =
      `<path d="M ${startX} ${startY} H ${a.cx - sx * r}
             Q ${a.cx} ${startY} ${a.cx} ${startY + sy * r} V ${endY}"
             fill="none" stroke="${muted}" stroke-width="2.5" stroke-linecap="round"/>` +
      chevron(a.cx, a.cy - sy * 3, goingDown ? "down" : "up", muted);
  }

  return `
    <g class="annot">
      ${leader}
      ${labelLines
        .map(
          (ln, i) =>
            `<text x="${tx}" y="${ty + i * lineH}" fill="${muted}"
                   ${t.attrs("annotation")}>${escapeHtml(ln)}</text>`,
        )
        .join("")}
    </g>`;
}

// Bold chevron arrowhead (stroked, not filled) pointing toward the data point.
function chevron(x, y, dir, colour) {
  const s = 9;
  const pts = {
    down: `${x - s},${y - s + 2} ${x},${y + 2} ${x + s},${y - s + 2}`,
    up: `${x - s},${y + s - 2} ${x},${y - 2} ${x + s},${y + s - 2}`,
    left: `${x + s - 2},${y - s} ${x - 2},${y} ${x + s - 2},${y + s}`,
    right: `${x - s + 2},${y - s} ${x + 2},${y} ${x - s + 2},${y + s}`,
  }[dir];
  return `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"/>`;
}
