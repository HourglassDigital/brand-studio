import fs from "node:fs";
import path from "node:path";
process.env.BRAND_STUDIO_DATA = path.resolve(import.meta.dirname);   // brands/ lives under test/
const { loadBrand } = await import("../brand-loader.mjs");
const { renderChart } = await import("../render/index.mjs");

const brand = loadBrand("_template");
fs.mkdirSync(path.join(import.meta.dirname, "golden"), { recursive: true });
// Goldens are only pixel-comparable on the platform whose font rasteriser made
// them; the test skips the diff elsewhere (see render-golden.test.mjs).
fs.writeFileSync(path.join(import.meta.dirname, "golden", ".platform"), process.platform);
for (const f of fs.readdirSync(path.join(import.meta.dirname, "fixtures")).filter((f) => f.endsWith(".json"))) {
  const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8"));
  const { buffer } = await renderChart({ brand, spec, scale: 1 });
  const out = path.join(import.meta.dirname, "golden", f.replace(/\.json$/, ".png"));
  fs.writeFileSync(out, buffer);
  console.log("wrote", out);
}
