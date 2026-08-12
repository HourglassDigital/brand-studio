// Translate the brand kit (brand.json) into CSS variables + base styles
// and an HTML doc wrapper. Direct port of v3's brand.mjs pattern — same shape,
// driven by brand.json fields instead of hardcoded values.
//
// Fonts: font files declared in brand.json under fonts.{headline,body}.files
// come from the kit's assets/ per role and are served as base64 data URLs
// inside @font-face so the headless render needs no external network calls.
// A declared font file that is missing throws rather than being substituted silently.

import fs from "node:fs";
import path from "node:path";
import { ATTRIBUTION_CSS, ATTRIBUTION_MARKUP } from "../../engine/brand.mjs";

export function brandCss(brand) {
  const c = brand.palette || {};
  const lines = [];
  for (const [k, v] of Object.entries(c)) lines.push(`  --${cssVar(k)}: ${v};`);
  const vars = `:root {\n${lines.join("\n")}\n}`;

  const fontFace = fontFaceCss(brand);
  const headlineFamily = brand.fonts?.headline?.family || "system-ui";
  const bodyFamily = brand.fonts?.body?.family || "system-ui";

  return `
${vars}

${fontFace}

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  font-family: "${bodyFamily}", system-ui, -apple-system, sans-serif;
  color: var(--ink, #111);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
.frame {
  position: relative;
  background-color: var(--bg, #fff);
  overflow: hidden;
}
h1, h2, h3, .headline { font-family: "${headlineFamily}", "${bodyFamily}", system-ui, sans-serif; }
mark, .hl {
  background: var(--accentSoft, #fee);
  color: var(--ink, #111);
  padding: 0 .08em;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

${ATTRIBUTION_CSS}
`;
}

export function htmlDoc({ brand, width, height, extraCss = "", body }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
${brandCss(brand)}
.frame { width: ${width}px; height: ${height}px; }
${extraCss}
</style></head>
<body><div class="frame" id="frame">${body}<div class="bs-attribution">${ATTRIBUTION_MARKUP}</div></div></body></html>`;
}

function cssVar(k) {
  // colours like accentSoft / accent2 stay readable as CSS vars
  return k.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function fontFaceCss(brand) {
  const brandDir = brand._meta && brand._meta.dir;
  const roles = ["headline", "body"];
  const blocks = [];
  for (const role of roles) {
    const font = brand.fonts?.[role];
    for (const f of font?.files || []) {
      if (!brandDir) break;
      const abs = path.join(brandDir, "assets", f.file);
      if (!fs.existsSync(abs)) {
        throw new Error(`Brand font file missing at render time: assets/${f.file} (never substituted silently)`);
      }
      const ext = path.extname(f.file).toLowerCase();
      const fmt = ext === ".woff2" ? "woff2" : ext === ".woff" ? "woff" : ext === ".otf" ? "opentype" : "truetype";
      const mime = ext === ".woff2" ? "font/woff2" : ext === ".woff" ? "font/woff" : "application/octet-stream";
      const b64 = fs.readFileSync(abs).toString("base64");
      blocks.push(`@font-face {
  font-family: "${font.family}";
  font-weight: ${f.weight || 400};
  font-style: ${f.style || "normal"};
  font-display: block;
  src: url(data:${mime};base64,${b64}) format("${fmt}");
}`);
    }
  }
  return blocks.join("\n");
}
