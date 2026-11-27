// Render one on-brand asset: a saved brand + a shape + Claude-authored {css, body} -> PNG (+ PDF).
//
//   node cli.mjs --brand jane --shape ig-square --data asset.json --out out.png [--pdf]
//   echo '{"css":"...","body":"..."}' | node cli.mjs --shape ig-story --data -   (stdin, active brand)
//   node cli.mjs --brand jane --shape business-card --data card.json --out out/card.pdf [--bleed 5] [--cmyk]
//
// Print shapes (business-card) take { css, pages: { front, back } } instead of a single
// body, always write a print PDF (one page per side, physical size, bleed included) plus
// one trimmed 300 dpi PNG preview per side, and never carry the attribution pill.
// --bleed <mm> overrides the shape's bleed (Officeworks wants 5); --cmyk converts the
// PDF to CMYK. Print PDFs need Ghostscript (exact size, trim box). CSS variables add --bleed and --trim-safe (mm lengths).
//
// An optional "qr": { "text": "...", "dark": "#111614", "light": "#FFFFFF" } in --data
// renders {{qr}} as a vector QR code (a URL, a vCard, anything a phone can read).
//
// --data is a JSON object { css, body } that the caller (the /create skill) authors
// fresh for this asset, grounded in the brand's house style. The engine wraps it with
// the brand's fonts, palette CSS variables and logo, sizes the canvas to the shape,
// and screenshots it. The engine imposes no structure of its own.
//
// Placeholders the engine substitutes in css + body (so raw HTML can use brand assets):
//   {{logo}}        the brand's default lockup        {{logo-light}}  inverse lockup (dark bg)
//   {{logo-dark}}   ink lockup                        {{logo-icon}}   mark only (tight corners)
//   {{name}}        brand name                        {{handle}}      brand handle
//   {{cta}}         brand call-to-action          {{qr}}          QR from data.qr (vector SVG)
// Unknown placeholders and unavailable logo variants throw. Nothing is substituted
// silently: a wrong-colour or missing logo must not reach the PNG.
// CSS variables available: --bg --surface --ink --muted --accent --accent-soft --accent2 --line --white --safe
import fs from "node:fs";
import path from "node:path";
import { resolveSlug, loadBrand, assetsDir, setActive } from "./store.mjs";
import { makeBrand } from "./brand.mjs";
import QRCode from "qrcode";
import { resolveShape, PRINT_MIN_FONT_PX } from "./shapes.mjs";
import { renderHtmlToFile, renderHtmlToPdf, renderPrintPdf } from "./render.mjs";
import { marks } from "./util.mjs";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

function readData(src, shape) {
  if (!src || src === true) throw new Error("Missing --data <file|-> (a JSON object {css, body})");
  const raw = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(src, "utf8");
  const data = JSON.parse(raw);
  const qr = data.qr || null;
  if (qr && typeof qr.text !== "string") throw new Error('--data "qr" must be an object with a string "text".');
  if (!shape.print) {
    if (typeof data.body !== "string") throw new Error('--data JSON must have a string "body" (the asset HTML).');
    return { css: data.css || "", pages: [["", data.body]], qr };
  }
  // Print: one body per named side, in the shape's page order. A side may be left out
  // (a one-sided card); an unknown side name is a typo and fails loudly.
  const given = data.pages;
  if (!given || typeof given !== "object" || Array.isArray(given)) {
    throw new Error(`Print shape "${shape.name}" needs "pages": { ${shape.pages.map((p) => `"${p}": "<html>"`).join(", ")} } in --data.`);
  }
  const unknown = Object.keys(given).filter((k) => !shape.pages.includes(k));
  if (unknown.length) throw new Error(`Unknown page(s) ${unknown.join(", ")} for "${shape.name}". Its pages are: ${shape.pages.join(", ")}.`);
  const pages = shape.pages.filter((p) => typeof given[p] === "string").map((p) => [p, given[p]]);
  if (!pages.length) throw new Error(`"pages" has no HTML for any side of "${shape.name}".`);
  return { css: data.css || "", pages, qr };
}

async function qrSvg(qr) {
  return QRCode.toString(qr.text, {
    type: "svg", margin: 0, errorCorrectionLevel: qr.errorCorrection || "M",
    color: { dark: qr.dark || "#000000", light: qr.light || "#FFFFFF" },
  });
}

// Every placeholder the engine knows, as a thunk. Lazy on purpose: a variant that
// throws (e.g. {{logo-icon}} on a brand with no icon) must only throw for an asset
// that actually asks for it.
const PLACEHOLDERS = {
  "{{logo}}": (b) => b.logo(),
  "{{logo-light}}": (b) => b.logo({ variant: "light" }),
  "{{logo-dark}}": (b) => b.logo({ variant: "dark" }),
  "{{logo-icon}}": (b) => b.logo({ variant: "icon" }),
  "{{name}}": (b) => b.meta.name,
  "{{handle}}": (b) => b.meta.handle,
  "{{cta}}": (b) => b.meta.cta,
  "{{qr}}": (b, ctx) => {
    if (!ctx.qr) throw new Error('{{qr}} needs a "qr": { "text": "..." } object in --data.');
    return ctx.qr;
  },
};

// Substitute {{...}} brand placeholders in a string. An unknown placeholder is an
// ERROR, not a passthrough: leaving it be bakes the literal braces into the PNG,
// which ships to the client as text reading "{{logo-mark}}".
function fillPlaceholders(s, brand, ctx = {}) {
  return s.replace(/\{\{[\w-]+\}\}/g, (m) => {
    const fn = PLACEHOLDERS[m];
    if (!fn) {
      throw new Error(
        `Unknown placeholder ${m}. Known placeholders: ${Object.keys(PLACEHOLDERS).join(" ")}. ` +
          `Fix the spelling in the asset's css/body, or drop the placeholder.`,
      );
    }
    return fn(brand, ctx);
  });
}

try {
  const slug = resolveSlug(args.brand === true ? undefined : args.brand);
  const brand = makeBrand(loadBrand(slug), { assetsDir: assetsDir(slug) });
  const shape = resolveShape(args.shape, args.bleed === undefined ? {} : { bleed: args.bleed });
  const { css, pages, qr } = readData(args.data, shape);
  const ctx = { qr: qr ? await qrSvg(qr) : null };

  // Expose the shape's safe-area inset as --safe so authored CSS can pad to it.
  const printVars = shape.print ? `--bleed:${shape.bleed}mm;--trim-safe:${shape.bleed + shape.safe}mm;` : "";
  const safeCss = `:root{--safe:${shape.safeArea}px;${printVars}}`;
  const fullCss = safeCss + fillPlaceholders(css, brand, ctx);
  // marks() first, on the authored body only: the logo SVG the placeholders inject
  // is engine-owned markup and must never be scanned for highlight syntax.
  const bodies = pages.map(([name, body]) => [name, fillPlaceholders(marks(body), brand, ctx)]);
  const doc = (body) =>
    brand.htmlDoc({ width: shape.width, height: shape.height, css: fullCss, body, print: shape.print ? shape.mm : null });

  const t0 = Date.now();
  if (!shape.print) {
    const html = doc(bodies[0][1]);
    const outPng = args.out && args.out !== true ? args.out : path.join("out", `${slug}-${shape.name}.png`);
    await renderHtmlToFile(html, shape, outPng, { scale: 2, audit: !args["no-audit"] });
    let pdf = null;
    if (args.pdf) {
      pdf = outPng.replace(/\.png$/i, "") + ".pdf";
      await renderHtmlToPdf(html, shape, pdf);
    }
    setActive(slug); // remember last-used brand
    console.log(JSON.stringify({ ok: true, brand: slug, shape: shape.name, size: `${shape.width}x${shape.height}`, png: outPng, pdf, ms: Date.now() - t0 }));
  } else {
    const out = args.out && args.out !== true ? args.out : path.join("out", `${slug}-${shape.name}.pdf`);
    const base = out.replace(/\.(pdf|png)$/i, "");
    // One trimmed 300 dpi preview per side, each through the legibility gate at the print floor.
    const pngs = [];
    for (const [name, body] of bodies) {
      const png = `${base}-${name}.png`;
      await renderHtmlToFile(doc(body), shape, png, {
        scale: 300 / 96,
        audit: !args["no-audit"],
        auditOptions: { minFontSize: PRINT_MIN_FONT_PX },
        inset: shape.bleed * (96 / 25.4),
      });
      pngs.push(png);
    }
    const pdf = await renderPrintPdf(doc(bodies.map(([, b]) => b)), shape, `${base}.pdf`, { cmyk: !!args.cmyk });
    setActive(slug);
    console.log(JSON.stringify({
      ok: true, brand: slug, shape: shape.name, trim: `${shape.trim.width}x${shape.trim.height}mm`,
      bleed: `${shape.bleed}mm`, pages: bodies.map(([n]) => n), cmyk: !!args.cmyk, pdf, png: pngs, ms: Date.now() - t0,
    }));
  }
} catch (e) {
  // The legibility gate carries structured findings; keep them machine-readable so the
  // authoring skill can act on each one, and print the human-readable list to stderr.
  if (e.name === "LegibilityError") {
    console.error(JSON.stringify({ ok: false, error: "legibility", png: e.png, findings: e.findings }));
    console.error(e.message);
  } else {
    console.error(JSON.stringify({ ok: false, error: e.message }));
  }
  process.exit(1);
}
