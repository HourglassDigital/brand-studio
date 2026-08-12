// Area / line chart card — single-SVG layout (chartr-style).
//
// Everything (title, subtitle, axes, area, annotations, watermark, source) is
// positioned inside one SVG with a fixed viewBox, so alignment is deterministic
// and the screenshot captures every pixel we drew.
//
// Title/subtitle/watermark/footer text and outer geometry come from the shared
// chartScaffold() (lib/render/charts/util.mjs); this file only owns the parts
// specific to an area/line chart: the data path, axes, and annotations.

import { scaleLinear, scaleTime } from "d3-scale";
import { area as d3area, line as d3line, curveMonotoneX, curveLinear } from "d3-shape";
import { extent, max, min } from "d3-array";
import {
  chartScaffold,
  normalisePoints,
  coerceX,
  makeFormatter,
  hexAlpha,
  seriesColours,
  escapeHtml,
} from "./util.mjs";
import { renderAnnotations } from "./annotate.mjs";

export const DEFAULT_SIZE = { width: 1600, height: 1100 };

export function renderArea({ brand, spec, size = DEFAULT_SIZE }) {
  const isLine = spec.type === "line";

  const sc = chartScaffold({ brand, spec, size });
  const { W, H, CHART_TOP, CHART_BOTTOM, innerLeft, innerRight, muted, grid, headerSvg, footerSvg } =
    sc;

  const points = normalisePoints(spec.series[0].values, spec.xAxis);
  const xDomain = extent(points, (d) => d.x);
  const yMax =
    spec.yAxis && spec.yAxis.max != null
      ? spec.yAxis.max
      : Math.ceil(max(points, (d) => d.y) * 1.05);
  const yMin =
    spec.yAxis && spec.yAxis.min != null ? spec.yAxis.min : Math.min(0, min(points, (d) => d.y));

  const x = (spec.xAxis && spec.xAxis.type === "time" ? scaleTime() : scaleLinear())
    .domain(xDomain)
    .range([innerLeft, innerRight]);
  const y = scaleLinear().domain([yMin, yMax]).range([CHART_BOTTOM, CHART_TOP]).nice();

  // Optional spec.curve: "linear" draws straight month-to-month segments (matches
  // most published source charts exactly); default stays monotone smoothing.
  const curve = spec.curve === "linear" ? curveLinear : curveMonotoneX;
  const areaGen = d3area()
    .x((d) => x(d.x))
    .y0(y(yMin))
    .y1((d) => y(d.y))
    .curve(curve);
  const lineGen = d3line()
    .x((d) => x(d.x))
    .y((d) => y(d.y))
    .curve(curve);

  const xTicks = pickXTicks(x, spec.xAxis);
  const yTicks = (spec.yAxis && spec.yAxis.ticks) || y.ticks(6);
  const yFmt = makeFormatter(spec.yAxis && spec.yAxis.format);

  // palette.accent stays the line colour, because the area fill underneath it is
  // palette.accentSoft - the two are a matched pair in every kit, and taking the
  // first derived slot instead would put a teal line over a peach fill. The fix
  // here is only to the tail: this used to fall back to a hardcoded #FC6932,
  // silently painting any brand without palette.accent in one client's orange.
  const accent = spec.accent || (brand.palette && brand.palette.accent) || seriesColours(brand, 1)[0];
  const accentSoft =
    spec.accentSoft || (brand.palette && brand.palette.accentSoft) || hexAlpha(accent, 0.28);

  // area/line anchors: { x, y } in data units resolve to the point on the
  // path. Drawing routes through the shared built-in annotation layer.
  const annotSvg = renderAnnotations({
    annotations: spec.annotations,
    resolve: (a) => ({ x: x(coerceX(a.x, spec.xAxis)), y: y(a.y) }),
    muted,
    t: sc.t,
  });

  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${headerSvg}

  ${yTicks
    .map(
      (t) =>
        `<g transform="translate(0 ${y(t)})">
           ${sc.gridAttrs ? `<line x1="${innerLeft}" x2="${innerRight}" stroke="${grid}" ${sc.gridAttrs}/>` : ""}
           <text x="${innerLeft - 16}" y="0" dy="0.32em" text-anchor="end" fill="${muted}"
                 ${sc.t.attrs("axis")}>${yFmt(t)}</text>
         </g>`,
    )
    .join("")}

  ${!isLine ? `<path d="${areaGen(points)}" fill="${accentSoft}"/>` : ""}
  <path d="${lineGen(points)}" fill="none" stroke="${accent}" stroke-width="3"/>

  ${xTicks
    .map(
      (t) =>
        `<text x="${x(t.x)}" y="${CHART_BOTTOM + 38}" text-anchor="middle" fill="${muted}"
               ${sc.t.attrs("axis")}>${escapeHtml(t.label)}</text>`,
    )
    .join("")}

  ${annotSvg}

  ${footerSvg}
</svg>`;

  const body = `<div class="chart-card">${svg}</div>`;
  const extraCss = `
    .frame { padding: 0; }
    .chart-card { width: 100%; height: 100%; background: var(--bg, #fff); }
    .chart-card svg { display: block; width: 100%; height: 100%; }
  `;

  return { body, extraCss, size };
}

function pickXTicks(scale, xAxis) {
  if (xAxis && Array.isArray(xAxis.tickLabels) && xAxis.tickLabels.length) {
    return xAxis.tickLabels.map((t) => ({
      x: xAxis.type === "time" ? new Date(t.at) : +t.at,
      label: t.label,
    }));
  }
  const raw = scale.ticks ? scale.ticks(8) : [];
  return raw.map((t) => ({
    x: t,
    label: xAxis && xAxis.type === "time" ? String(t.getFullYear ? t.getFullYear() : t) : String(t),
  }));
}
