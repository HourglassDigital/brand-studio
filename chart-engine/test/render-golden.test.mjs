import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

process.env.BRAND_STUDIO_DATA = path.resolve(import.meta.dirname);
const { loadBrand } = await import("../brand-loader.mjs");
const { renderChart } = await import("../render/index.mjs");
const { resolveExecutable } = await import("../render/playwright.mjs");

function chromiumAvailable() {
  try {
    resolveExecutable();
    return true;
  } catch {
    return false;
  }
}

const FIX = path.join(import.meta.dirname, "fixtures");
const GOLD = path.join(import.meta.dirname, "golden");

for (const f of fs.readdirSync(FIX).filter((f) => f.endsWith(".json"))) {
  test(`render matches golden: ${f}`, { skip: !chromiumAvailable() && "no Chromium" }, async () => {
    const spec = JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
    const brand = loadBrand("_template");
    const { buffer } = await renderChart({ brand, spec, scale: 1 });
    const got = PNG.sync.read(buffer);
    const want = PNG.sync.read(fs.readFileSync(path.join(GOLD, f.replace(/\.json$/, ".png"))));
    assert.equal(got.width, want.width);
    assert.equal(got.height, want.height);
    const diff = pixelmatch(got.data, want.data, null, got.width, got.height, { threshold: 0.1 });
    assert.ok(diff / (got.width * got.height) < 0.005, `diffRatio too high for ${f}`);
  });
}
