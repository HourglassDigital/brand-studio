// Render one on-brand asset: a saved brand + a shape + Claude-authored {css, body} -> PNG (+ PDF).
//
//   node cli.mjs --brand jane --shape ig-square --data asset.json --out out.png [--pdf]
//   echo '{"css":"...","body":"..."}' | node cli.mjs --shape ig-story --data -   (stdin, active brand)
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
//   {{cta}}         brand call-to-action
// Unknown placeholders and unavailable logo variants throw. Nothing is substituted
// silently: a wrong-colour or missing logo must not reach the PNG.
// CSS variables available: --bg --surface --ink --muted --accent --accent-soft --accent2 --line --white --safe
import fs from "node:fs";
import path from "node:path";
import { resolveSlug, loadBrand, assetsDir, setActive } from "./store.mjs";
import { makeBrand } from "./brand.mjs";
import { resolveShape } from "./shapes.mjs";
import { renderHtmlToFile, renderHtmlToPdf } from "./render.mjs";
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

function readData(src) {
  if (!src || src === true) throw new Error("Missing --data <file|-> (a JSON object {css, body})");
  const raw = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(src, "utf8");
  const data = JSON.parse(raw);
  if (typeof data.body !== "string") throw new Error('--data JSON must have a string "body" (the asset HTML).');
  return { css: data.css || "", body: data.body };
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
};

// Substitute {{...}} brand placeholders in a string. An unknown placeholder is an
// ERROR, not a passthrough: leaving it be bakes the literal braces into the PNG,
// which ships to the client as text reading "{{logo-mark}}".
function fillPlaceholders(s, brand) {
  return s.replace(/\{\{[\w-]+\}\}/g, (m) => {
    const fn = PLACEHOLDERS[m];
    if (!fn) {
      throw new Error(
        `Unknown placeholder ${m}. Known placeholders: ${Object.keys(PLACEHOLDERS).join(" ")}. ` +
          `Fix the spelling in the asset's css/body, or drop the placeholder.`,
      );
    }
    return fn(brand);
  });
}

try {
  const slug = resolveSlug(args.brand === true ? undefined : args.brand);
  const brand = makeBrand(loadBrand(slug), { assetsDir: assetsDir(slug) });
  const shape = resolveShape(args.shape);
  const { css, body } = readData(args.data);

  // Expose the shape's safe-area inset as --safe so authored CSS can pad to it.
  const safeCss = `:root{--safe:${shape.safeArea}px;}`;
  const fullCss = safeCss + fillPlaceholders(css, brand);
  const html = brand.htmlDoc({
    width: shape.width,
    height: shape.height,
    css: fullCss,
    // marks() first, on the authored body only: the logo SVG the placeholders inject
    // is engine-owned markup and must never be scanned for highlight syntax.
    body: fillPlaceholders(marks(body), brand),
  });

  const outPng = args.out && args.out !== true ? args.out : path.join("out", `${slug}-${shape.name}.png`);
  const t0 = Date.now();
  await renderHtmlToFile(html, shape, outPng, { scale: 2, audit: !args["no-audit"] });
  let pdf = null;
  if (args.pdf) {
    pdf = outPng.replace(/\.png$/i, "") + ".pdf";
    await renderHtmlToPdf(html, shape, pdf);
  }
  setActive(slug); // remember last-used brand
  console.log(JSON.stringify({ ok: true, brand: slug, shape: shape.name, size: `${shape.width}x${shape.height}`, png: outPng, pdf, ms: Date.now() - t0 }));
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
