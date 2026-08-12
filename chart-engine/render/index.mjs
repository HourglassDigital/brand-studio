// Chart engine — validate the spec, pick a chart template by spec.type,
// render to HTML, ship to the Playwright shell.
//
// Add a new chart type by writing a renderer in ./charts/<type>.mjs that
// returns { body, extraCss, size } and registering it below.

import path from "node:path";
import fs from "node:fs";
import { renderArea, DEFAULT_SIZE as AREA_SIZE } from "./charts/area.mjs";
import { renderBar, DEFAULT_SIZE as BAR_SIZE } from "./charts/bar.mjs";
import { renderPie, DEFAULT_SIZE as PIE_SIZE } from "./charts/pie.mjs";
import { htmlDoc } from "./brand-css.mjs";
import { renderHtmlToFile, renderHtmlToPdf, renderHtmlToBuffer } from "./playwright.mjs";
import { validateSpec, applyDefaults } from "../spec.mjs";

const CHART_TYPES = {
  area: { fn: renderArea, defaultSize: AREA_SIZE },
  bar: { fn: renderBar, defaultSize: BAR_SIZE },
  line: { fn: renderArea, defaultSize: AREA_SIZE }, // line = area with no fill stop opacity; handled in area.mjs
  pie: { fn: renderPie, defaultSize: PIE_SIZE },
};

export function listChartTypes() {
  return Object.keys(CHART_TYPES);
}

export async function renderChart({ brand, spec, outPng, outPdf, scale = 2 }) {
  const v = validateSpec(spec);
  if (!v.ok) throw new Error(`Invalid chart spec:\n- ${v.errors.join("\n- ")}`);
  spec = applyDefaults(spec, brand);

  const type = spec.type || "area";
  const handler = CHART_TYPES[type];
  if (!handler) {
    throw new Error(
      `Unknown chart type "${type}". Available: ${Object.keys(CHART_TYPES).join(", ")}`,
    );
  }

  const size = spec.size || handler.defaultSize;
  const { body, extraCss } = handler.fn({ brand, spec, size });
  const html = htmlDoc({ brand, width: size.width, height: size.height, extraCss, body });

  const written = {};
  if (outPng) {
    written.png = await renderHtmlToFile(html, size, path.resolve(outPng), { scale });
  } else {
    written.buffer = await renderHtmlToBuffer(html, size, { scale });
  }
  if (outPdf) {
    written.pdf = await renderHtmlToPdf(html, size, path.resolve(outPdf));
  }
  // Always also save the raw HTML next to the PNG for debugging.
  if (outPng) {
    const htmlPath = outPng.replace(/\.png$/i, ".html");
    fs.writeFileSync(htmlPath, html);
    written.html = htmlPath;
  }
  return { type, size, ...written };
}
