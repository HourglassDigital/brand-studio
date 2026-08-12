// Bar chart - grouped (default) and stacked (spec.stacked). Categories come
// from series[0].values[].x; the validator guarantees aligned lengths.
import { scaleBand, scaleLinear } from "d3-scale";
import {
  chartScaffold, seriesColours, softenColour, makeFormatter, escapeHtml, layoutLegend,
} from "./util.mjs";
import { renderAnnotations, barAnchor } from "./annotate.mjs";

export const DEFAULT_SIZE = { width: 1600, height: 1100 };

export function renderBar({ brand, spec, size = DEFAULT_SIZE }) {
  const sc = chartScaffold({ brand, spec, size });
  const categories = spec.series[0].values.map((v) => String(v.x));
  const names = spec.series.map((s, i) => s.name || `series ${i + 1}`);
  const stacked = !!spec.stacked;
  const colours = seriesColours(brand, spec.series.length);

  // spec.emphasis names the category that carries the point. That one keeps its
  // full colour and takes the brand highlighter behind its axis label; every
  // other bar recedes to a lighter step of ITS OWN colour, so identity survives
  // and the legend swatches still match. The chart then argues something instead
  // of presenting numbers at equal volume.
  const hero = spec.emphasis == null ? null : String(spec.emphasis);
  const quiet = colours.map((c) => softenColour(c));
  const fillFor = (si, cat) => (hero === null || cat === hero ? colours[si] : quiet[si]);

  const totals = categories.map((_, ci) =>
    spec.series.reduce((sum, s) => sum + +s.values[ci].y, 0),
  );
  const rawMax = stacked
    ? Math.max(...totals)
    : Math.max(...spec.series.flatMap((s) => s.values.map((v) => +v.y)));
  const yMax = spec.yAxis?.max ?? Math.ceil(rawMax * 1.05);
  const yMin = spec.yAxis?.min ?? 0;

  const x0 = scaleBand().domain(categories).range([sc.innerLeft, sc.innerRight])
    .paddingInner(0.25).paddingOuter(0.1);
  const x1 = scaleBand().domain(names).range([0, x0.bandwidth()]).padding(0.12);
  const y = scaleLinear().domain([yMin, yMax]).range([sc.CHART_BOTTOM, sc.CHART_TOP]).nice();

  const yTicks = spec.yAxis?.ticks || y.ticks(6);
  const yFmt = makeFormatter(spec.yAxis?.format);
  const radius = Math.min(brand.chart?.cornerRadius ?? 6, (stacked ? x0.bandwidth() : x1.bandwidth()) / 2, 14);

  const gridSvg = yTicks.map((t) =>
    `<g transform="translate(0 ${y(t)})">
       ${sc.gridAttrs ? `<line x1="${sc.innerLeft}" x2="${sc.innerRight}" stroke="${sc.grid}" ${sc.gridAttrs}/>` : ""}
       <text x="${sc.innerLeft - 16}" y="0" dy="0.32em" text-anchor="end" fill="${sc.muted}"
             ${sc.t.attrs("axis")}>${yFmt(t)}</text>
     </g>`).join("");

  let barsSvg = "";
  if (stacked) {
    categories.forEach((cat, ci) => {
      let cum = yMin;
      spec.series.forEach((s, si) => {
        const v = +s.values[ci].y;
        const yTop = y(cum + v), yBot = y(cum);
        const topSegment = si === spec.series.length - 1;
        barsSvg += barRect(x0(cat), yTop, x0.bandwidth(), yBot - yTop,
          topSegment ? radius : 0, fillFor(si, cat), sc.markStroke);
        cum += v;
      });
    });
  } else {
    categories.forEach((cat, ci) => {
      spec.series.forEach((s, si) => {
        const v = +s.values[ci].y;
        barsSvg += barRect(x0(cat) + x1(names[si]), y(v), x1.bandwidth(), y(yMin) - y(v),
          radius, fillFor(si, cat), sc.markStroke);
      });
    });
  }

  const highlight = (brand.palette || {})[brand.chart?.highlight?.colour] || (brand.palette || {}).accentSoft;
  const catSvg = categories.map((cat) => {
    const cx = x0(cat) + x0.bandwidth() / 2;
    const isHero = hero !== null && cat === hero;
    const swipe = isHero && highlight
      ? `<rect x="${cx - cat.length * 7 - 10}" y="${sc.CHART_BOTTOM + 20}" width="${cat.length * 14 + 20}"
               height="30" rx="6" fill="${highlight}"/>`
      : "";
    return `${swipe}<text x="${cx}" y="${sc.CHART_BOTTOM + 38}" text-anchor="middle"
           fill="${isHero ? sc.ink : sc.muted}"
           ${sc.t.attrs("category", { weight: isHero ? 700 : 400 })}>${escapeHtml(cat)}</text>`;
  }).join("");

  // Legend entries are spaced by measured text (layoutLegend), because the old
  // fixed 220px slots overlapped as soon as a third real-world series name
  // arrived. Overflow rows stack upward into the header whitespace, last row
  // on the baseline so reading order survives.
  const legend = sc.t.role("legend");
  const placed = names.length > 1
    ? layoutLegend(names, {
        size: legend.size,
        right: sc.innerRight,
        maxWidth: sc.innerRight - sc.innerLeft,
      })
    : [];
  const legendRows = placed.length ? placed[placed.length - 1].row + 1 : 0;
  const legendSvg = placed.map(({ name, i, x, row }) => {
    const baseY = sc.CHART_TOP - 14 - (legendRows - 1 - row) * 34;
    return `<rect x="${x}" y="${baseY}" width="18" height="18" rx="4"
                  fill="${colours[i]}"${sc.markStroke}/>
            <text x="${x + 26}" y="${baseY + 15}" ${sc.t.attrs("legend")}
                  fill="${sc.ink}">${escapeHtml(name)}</text>`;
  }).join("");

  const annotSvg = renderAnnotations({
    annotations: spec.annotations,
    resolve: (a) => barAnchor(a, { categories, names, series: spec.series, x0, x1, y, stacked }),
    muted: sc.muted,
    t: sc.t,
  });

  const svg = `
<svg viewBox="0 0 ${sc.W} ${sc.H}" xmlns="http://www.w3.org/2000/svg">
  ${sc.headerSvg}
  ${gridSvg}
  ${barsSvg}
  ${catSvg}
  ${legendSvg}
  ${annotSvg}
  ${sc.footerSvg}
</svg>`;

  return {
    body: `<div class="chart-card">${svg}</div>`,
    extraCss: `
      .frame { padding: 0; }
      .chart-card { width: 100%; height: 100%; background: var(--bg, #fff); }
      .chart-card svg { display: block; width: 100%; height: 100%; }
    `,
    size,
  };
}

// Rectangle with rounded TOP corners only (baseline stays square).
function barRect(x, yTop, w, h, r, fill, stroke = "") {
  if (h <= 0) return "";
  const rr = Math.min(r, h);
  if (rr <= 0) return `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${fill}"${stroke}/>`;
  return `<path d="M ${x} ${yTop + h} L ${x} ${yTop + rr} Q ${x} ${yTop} ${x + rr} ${yTop}
    L ${x + w - rr} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + rr} L ${x + w} ${yTop + h} Z"
    fill="${fill}"${stroke}/>`;
}
