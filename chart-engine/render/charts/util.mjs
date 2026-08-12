// Shared chart utilities — used by all chart renderers (area, bar, pie, etc).

import fs from "node:fs";
import path from "node:path";
import { typography, estimateTextWidth } from "./typography.mjs";
import { formatSource } from "./source.mjs";

export { estimateTextWidth };

// Text and HTML helpers

export function wordWrap(text, maxLen) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + " " + w).length <= maxLen) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function wrappedText(text, { x, y, width, size, weight, family, fill, lineHeight }) {
  const approxCharsPerLine = Math.floor(width / (size * 0.5));
  const lines = wordWrap(String(text), approxCharsPerLine);
  return lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${y + i * size * lineHeight}" font-family="${escapeAttr(family)}"
               font-weight="${weight}" font-size="${size}" letter-spacing="-0.01em"
               fill="${fill}">${escapeHtml(ln)}</text>`,
    )
    .join("");
}

export function titleBlockHeight(text, width) {
  const size = 52;
  const approxCharsPerLine = Math.floor(width / (size * 0.5));
  const lines = wordWrap(String(text), approxCharsPerLine);
  return lines.length * size * 1.06;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s) {
  return escapeHtml(s);
}

// Data normalisation

export function normalisePoints(values, xAxis) {
  if (values.length === 0) return [];
  const first = values[0];
  if (typeof first === "object" && !Array.isArray(first)) {
    return values.map((d) => ({ x: coerceX(d.x, xAxis), y: +d.y }));
  }
  if (Array.isArray(first)) {
    return values.map(([x, y]) => ({ x: coerceX(x, xAxis), y: +y }));
  }
  const xs = (xAxis && xAxis.values) || values.map((_, i) => i);
  return values.map((y, i) => ({ x: coerceX(xs[i], xAxis), y: +y }));
}

export function coerceX(raw, xAxis) {
  if (xAxis && xAxis.type === "time") {
    if (raw instanceof Date) return raw;
    return new Date(raw);
  }
  return +raw;
}

// Formatting and colour utilities

export function makeFormatter(fmt) {
  if (fmt === "K") return (n) => (n === 0 ? "0K" : `${Math.round(n / 1000)}K`);
  if (fmt === "M") return (n) => (n === 0 ? "0M" : `${(n / 1_000_000).toFixed(n >= 1e7 ? 0 : 1)}M`);
  if (fmt === "%") return (n) => `${Math.round(n * 100)}%`;
  if (typeof fmt === "function") return fmt;
  return (n) => String(n);
}

export function hexAlpha(hex, alpha) {
  const m = /^#?([a-f0-9]{6}|[a-f0-9]{3})$/i.exec(hex);
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Series and scaffold — chart-wide layout

// Series colours are derived from the kit's declared hues (lib/render/palette.mjs).
// Renderers ask for all n at once rather than one at a time, because whether a
// given slot is safe depends on the slots either side of it.
export { seriesColours, softenColour, ordinalColours, isOrderedRamp } from "../palette.mjs";

// Interpolate n colours across an ordered list of palette-key stops
// (brand.chart.pie.ramp). Lets a pie/donut fill many slices from the brand's
// OWN colours instead of cycling seriesColour's 2-4 flat keys (which repeat and
// drag in ink/muted once slices > keys). Returns null when no usable ramp is
// configured, so callers fall back to seriesColour. Linear RGB lerp, fully
// deterministic - no new deps, golden-safe.
export function rampColours(brand, n) {
  const cfg = brand.chart && brand.chart.pie && brand.chart.pie.ramp;
  if (!Array.isArray(cfg) || cfg.length < 2) return null;
  const p = brand.palette || {};
  const stops = cfg.map((key) => p[key]).filter((c) => typeof c === "string" && /^#[0-9a-f]{3,6}$/i.test(c));
  if (stops.length < 2) return null;
  if (n <= 1) return [stops[0]];
  const segs = stops.length - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segs; // position along the whole ramp, 0..segs
    const seg = Math.min(Math.floor(t), segs - 1);
    out.push(lerpHex(stops[seg], stops[seg + 1], t - seg));
  }
  return out;
}

function parseHex(hex) {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lerpHex(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  const ch = (k) => Math.round(pa[k] + (pb[k] - pa[k]) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

export function chartScaffold({ brand, spec, size }) {
  const W = size.width, H = size.height;
  const PAD_X = 64;
  const p = brand.palette || {};
  const ink = p.ink || "#1a1a1a";
  const muted = p.muted || hexAlpha(ink, 0.5);
  const grid = p.line || hexAlpha(ink, 0.12);
  const gridAttrs = gridStyleAttrs(brand);
  const markStroke = markStrokeAttrs(brand, ink);
  const t = typography(brand);
  const headlineFamily = brand.fonts?.headline?.family || "system-ui";

  const TITLE_Y = 76;
  const SUBTITLE_Y = TITLE_Y + (spec.title ? titleBlockHeight(spec.title, W - PAD_X * 2) + 12 : 0);
  const CHART_TOP = SUBTITLE_Y + (spec.subtitle ? 56 : 24);
  const ATTRIBUTION_RESERVED = 92;
  const FOOTER_Y = H - ATTRIBUTION_RESERVED;
  const CHART_BOTTOM = FOOTER_Y - 80;
  const innerLeft = PAD_X + 60;
  const innerRight = W - PAD_X - 20;

  // Title and subtitle draw in their roles: the weights below are whatever the
  // kit can actually honour, never a request the browser must fake (spec §5.1).
  const title = t.role("title");
  const subtitle = t.role("subtitle");
  const titleSvg = spec.title
    ? wrappedText(spec.title, {
        x: PAD_X, y: TITLE_Y, width: W - PAD_X * 2,
        size: title.size, weight: title.weight, family: title.family, fill: ink, lineHeight: 1.06,
      })
    : "";
  const subtitleSvg = spec.subtitle
    ? `<text x="${PAD_X}" y="${SUBTITLE_Y}" font-family="${escapeAttr(subtitle.family)}"
             font-size="${subtitle.size}" fill="${ink}">
         <tspan font-weight="${subtitle.weight}">${escapeHtml(spec.subtitle)}</tspan>${
           spec.subtitleAnnotation
             ? `<tspan font-weight="400" fill="${muted}"> [${escapeHtml(spec.subtitleAnnotation)}]</tspan>`
             : ``
         }
       </text>`
    : "";
  // Watermark lockup: when the kit declares an icon (brand.logo.icon, an
  // icon-only SVG in the kit's assets/ with no <text> elements so it has no
  // font dependency), it is inlined natively before the watermark text. A
  // declared-but-missing icon fails loudly, same policy as fonts (spec §12).
  let watermarkIconSvg = "";
  let watermarkTextX = PAD_X;
  if (spec.watermark && brand.logo?.icon) {
    const iconH = 34;
    const { inner, vbW, vbH } = readLogoIcon(brand);
    const scale = iconH / vbH;
    watermarkIconSvg = `<g transform="translate(${PAD_X} ${FOOTER_Y - 27}) scale(${scale.toFixed(4)})">${inner}</g>`;
    watermarkTextX = PAD_X + vbW * scale + 14;
  }
  const watermarkSvg = spec.watermark
    ? `${watermarkIconSvg}<text x="${watermarkTextX}" y="${FOOTER_Y}" ${t.attrs("watermark")}
            letter-spacing="-0.01em" fill="${ink}">${escapeHtml(spec.watermark)}</text>`
    : "";
  // The one attribution line (spec §5.2): formatSource() is the single
  // renderer, in the source role, exactly once. applyDefaults has already
  // mapped a legacy spec.footer onto source.note, so nothing else in the
  // engine ever draws a source. It sits above the engine attribution strip,
  // bottom-right because bottom-left is
  // the watermark lockup's home in a standalone chart card; when a chart is
  // composed into an asset the chrome owns both corners.
  const sourceText = formatSource(spec.source);
  const sourceSvg = sourceText
    ? `<text x="${W - PAD_X}" y="${FOOTER_Y}" text-anchor="end" ${t.attrs("source")}
            fill="${muted}">${escapeHtml(sourceText)}</text>`
    : "";

  return {
    W, H, PAD_X, CHART_TOP, CHART_BOTTOM, FOOTER_Y, innerLeft, innerRight,
    ink, muted, grid, gridAttrs, markStroke, headlineFamily, t,
    headerSvg: titleSvg + subtitleSvg,
    footerSvg: watermarkSvg + sourceSvg,
  };
}

/**
 * Horizontal legend layout that measures its text (spec §5.1). The old code
 * gave every entry a fixed 220px slot, so three real-world series names
 * overlapped each other. Entries are sized from estimateTextWidth and packed
 * in declaration order into rows no wider than the plot, each row
 * right-aligned at `right`; row 0 sits at the caller's baseline and later
 * rows stack upward into the header whitespace.
 */
export function layoutLegend(names, { size, right, maxWidth, swatch = 18, gapText = 8, gapEntry = 40 }) {
  const widths = names.map((n) => swatch + gapText + estimateTextWidth(n, size) + gapEntry);
  const rows = [];
  let row = [];
  let rowW = 0;
  names.forEach((n, i) => {
    if (row.length && rowW + widths[i] > maxWidth) {
      rows.push({ entries: row, width: rowW });
      row = [];
      rowW = 0;
    }
    row.push({ name: n, i, width: widths[i] });
    rowW += widths[i];
  });
  if (row.length) rows.push({ entries: row, width: rowW });

  const out = [];
  rows.forEach((r, rowIndex) => {
    let x = right - r.width;
    for (const e of r.entries) {
      out.push({ name: e.name, i: e.i, x, row: rowIndex });
      x += e.width;
    }
  });
  return out;
}

// chart.gridStyle: how the axis rules are drawn. Declared in every shipped kit
// and, until now, read by nothing. "plain" reproduces the previous hardcoded
// behaviour, so a kit that does not set it renders identically.
const GRID_STYLES = {
  plain: `stroke-width="1"`,
  "faint-warm": `stroke-width="1" stroke-dasharray="2 7" stroke-linecap="round"`,
  none: null,
};

function gridStyleAttrs(brand) {
  const style = (brand.chart && brand.chart.gridStyle) || "plain";
  if (!Object.prototype.hasOwnProperty.call(GRID_STYLES, style)) {
    throw new Error(
      `Brand "${brand._meta?.slug || brand.slug}": unknown chart.gridStyle "${style}". ` +
        `Known styles: ${Object.keys(GRID_STYLES).join(", ")}.`,
    );
  }
  return GRID_STYLES[style];
}

// chart.borderWidth: the brand's outline language applied to data marks. Also
// the contrast relief for pale fills - a fill below 3:1 against the background
// is still unambiguous inside an ink outline, which is why checkColours' low
// contrast list is a warning rather than a render failure when this is set.
function markStrokeAttrs(brand, ink) {
  const width = (brand.chart && brand.chart.borderWidth) || 0;
  if (!(width > 0)) return "";
  return ` stroke="${ink}" stroke-width="${width}" stroke-linejoin="round"`;
}

// Read the kit's icon-only logo (SVG inlined natively, or PNG embedded as a
// base64 image). SVG icons must not contain <text> elements - an inlined icon
// cannot load fonts, so text would silently render wrong (the reason the kit
// stores an icon-only file, not the lockup).
function readLogoIcon(brand) {
  const dir = brand._meta && brand._meta.dir;
  const file = brand.logo.icon;
  const abs = dir ? path.join(dir, "assets", file) : null;
  if (!abs || !fs.existsSync(abs)) {
    throw new Error(
      `Brand "${brand._meta?.slug || brand.slug}": declared logo icon missing: assets/${file} (spec §12: nothing substituted silently)`,
    );
  }
  if (/\.png$/i.test(file)) {
    const buf = fs.readFileSync(abs);
    // PNG IHDR: width/height are big-endian uint32 at byte offsets 16 and 20.
    const vbW = buf.readUInt32BE(16);
    const vbH = buf.readUInt32BE(20);
    const inner = `<image href="data:image/png;base64,${buf.toString("base64")}" width="${vbW}" height="${vbH}"/>`;
    return { inner, vbW, vbH };
  }
  const raw = fs.readFileSync(abs, "utf8");
  if (/<text[\s>]/i.test(raw)) {
    throw new Error(
      `Brand logo icon assets/${file} contains <text> elements - inlined icons cannot load fonts. Store an icon-only SVG (see distil-brand).`,
    );
  }
  const vb = /viewBox\s*=\s*"([\d.\s-]+)"/i.exec(raw);
  if (!vb) throw new Error(`Brand logo icon assets/${file} has no viewBox - add one so it can be scaled.`);
  const [vbX, vbY, vbW, vbH] = vb[1].trim().split(/\s+/).map(Number);
  const rootTag = /<svg[^>]*>/i.exec(raw)[0];
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  // Presentation attributes on the root <svg> (fill="none" etc.) stop applying
  // once the tag is stripped, so carry them onto the wrapper group - otherwise
  // outlined icons render as filled black blobs.
  const carried = ["fill", "stroke", "stroke-width", "opacity"]
    .map((attr) => {
      const m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i").exec(rootTag);
      return m ? ` ${attr}="${m[1]}"` : "";
    })
    .join("");
  const translate = vbX || vbY ? ` transform="translate(${-vbX} ${-vbY})"` : "";
  return { inner: `<g${carried}${translate}>${body}</g>`, vbW, vbH };
}
