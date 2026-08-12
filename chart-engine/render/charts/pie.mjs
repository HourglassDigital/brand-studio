// Pie / donut. One series; slices from values[].x labels (validator-enforced).
// Chart on the left, legend with value + percentage on the right.
import { pie as d3pie, arc as d3arc } from "d3-shape";
import {
  chartScaffold, seriesColours, softenColour, ordinalColours, isOrderedRamp, rampColours,
  makeFormatter, escapeHtml,
} from "./util.mjs";
import { renderAnnotations, pieAnchor } from "./annotate.mjs";

export const DEFAULT_SIZE = { width: 1600, height: 1100 };

export function renderPie({ brand, spec, size = DEFAULT_SIZE }) {
  const sc = chartScaffold({ brand, spec, size });
  const values = spec.series[0].values.map((v) => ({ label: String(v.x), y: +v.y }));
  const total = values.reduce((s, v) => s + v.y, 0);
  const fmt = makeFormatter(spec.yAxis?.format);

  const innerH = sc.CHART_BOTTOM - sc.CHART_TOP;
  const R = Math.min(innerH, (sc.innerRight - sc.innerLeft) * 0.45) / 2;
  const cx = sc.innerLeft + R + 20;
  const cy = sc.CHART_TOP + innerH / 2;
  const innerR = spec.donut ? R * 0.6 : 0;

  const arcs = d3pie().sort(null).value((d) => d.y)(values);
  const arcGen = d3arc().innerRadius(innerR).outerRadius(R).cornerRadius(
    Math.min(brand.chart?.cornerRadius ?? 0, 10) / 2,
  );

  // Colour follows the SHAPE of the data, not the kit's preference.
  //
  // spec.ordered marks slices that run in a sequence (stages, size bands, low to
  // high). Those get a blend, because the fade IS the order: the reader sees the
  // ranking without reading a legend.
  //
  // Everything else is named categories - Subscriptions, Advertising, Commerce -
  // where no order exists to show. Those get the brand's own colours, because a
  // blend between two distant brand hues passes through colours the brand does
  // not own (orange into purple gives a dusty pink nobody chose). Categorical is
  // the default: most pies name things rather than rank them.
  const declared = spec.ordered ? rampColours(brand, values.length) : null;
  const ramp = spec.ordered
    ? (isOrderedRamp(declared) ? declared : ordinalColours(brand, values.length))
    : null;
  const derived = ramp ? null : seriesColours(brand, values.length);
  const baseFill = (i) => (ramp ? ramp[i] : derived[i]);

  // spec.emphasis names the slice carrying the point: it keeps its colour while
  // the rest recede to a lighter step of their own, so the reader's eye lands
  // where the title says it should.
  const hero = spec.emphasis == null ? null : String(spec.emphasis);
  const sliceFill = (i) =>
    hero === null || values[i].label === hero ? baseFill(i) : softenColour(baseFill(i));

  // Slices are separated by the brand's outline when the kit declares one, and
  // by a background-coloured gap when it does not. Either way neighbouring
  // slices never bleed into each other.
  const sliceStroke =
    sc.markStroke || ` stroke="${(brand.palette || {}).bg || "#fff"}" stroke-width="3"`;

  const slicesSvg = arcs.map((a, i) =>
    `<path d="${arcGen(a)}" transform="translate(${cx} ${cy})"
           fill="${sliceFill(i)}"${sliceStroke}/>`,
  ).join("");

  // Legend: two-line rows (label, then value underneath) so text never
  // collides with a right-anchored column at narrow canvas sizes.
  // legendValue controls the second line (default "both"):
  //   both    -> "62 (60%)"  value + recomputed integer percentage
  //   value   -> "62"        raw value only
  //   percent -> "20.7%"     one-decimal share only (faithful when values ARE percentages)
  const pcts = largestRemainderPercentages(values.map((v) => v.y), total);
  const pct1 = (y) => (Math.round((y / total) * 1000) / 10).toFixed(1);
  const mode = spec.legendValue || "both";
  const valueLine = (v, i) =>
    mode === "percent" ? `${pct1(v.y)}%`
    : mode === "value" ? `${fmt(v.y)}`
    : `${fmt(v.y)} (${pcts[i]}%)`;
  const highlight = (brand.palette || {})[brand.chart?.highlight?.colour] || (brand.palette || {}).accentSoft;
  const legendX = cx + R + 80;
  // Rows are sized to the plot area, and everything inside a row scales with it.
  // Two fixed-size lines in a fixed 72px row ran past CHART_BOTTOM into the
  // footer on a short canvas, and merely capping the row height then made
  // consecutive rows overlap each other instead. Type and swatch scale together
  // so a row is always internally legible, whatever height it ends up with.
  const available = sc.CHART_BOTTOM - sc.CHART_TOP;
  const rowH = Math.min(72, available / values.length);
  const scale = rowH / 72;
  const labelSize = Math.max(15, 26 * scale);
  const valueSize = Math.max(13, 22 * scale);
  const valueDy = labelSize * 1.15;
  const swatch = Math.max(13, 22 * scale);
  const blockH = values.length * rowH;
  const legendY = Math.max(sc.CHART_TOP, cy - blockH / 2) + rowH / 2;
  const legendSvg = values.map((v, i) => {
    const yPos = legendY + i * rowH;
    const isHero = hero !== null && v.label === hero;
    const textX = legendX + swatch + 14;
    const swipe = isHero && highlight
      ? `<rect x="${textX - 6}" y="${yPos - labelSize * 0.78}" width="${v.label.length * labelSize * 0.62 + 12}"
               height="${labelSize * 1.12}" rx="5" fill="${highlight}"/>`
      : "";
    return `<rect x="${legendX}" y="${yPos - swatch * 0.73}" width="${swatch}" height="${swatch}" rx="${swatch / 4.4}"
                  fill="${sliceFill(i)}"${sc.markStroke}/>
            ${swipe}<text x="${textX}" y="${yPos}" dy="0.1em" fill="${sc.ink}"
                  ${sc.t.attrs("legend", { size: labelSize, weight: isHero ? 700 : 400 })}>${escapeHtml(v.label)}</text>
            <text x="${legendX + swatch + 14}" y="${yPos + valueDy}" dy="0.1em"
                  fill="${sc.muted}" ${sc.t.attrs("value", { size: valueSize })}>${escapeHtml(valueLine(v, i))}</text>`;
  }).join("");

  const annotSvg = renderAnnotations({
    annotations: spec.annotations,
    resolve: (a) => pieAnchor(a, { arcs, values, cx, cy, R }),
    muted: sc.muted,
    t: sc.t,
  });

  const svg = `
<svg viewBox="0 0 ${sc.W} ${sc.H}" xmlns="http://www.w3.org/2000/svg">
  ${sc.headerSvg}
  ${slicesSvg}
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

// Round percentages so they always total exactly 100 (largest remainder).
function largestRemainderPercentages(values, total) {
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  const left = 100 - floors.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) floors[order[k][1]] += 1;
  return floors;
}
