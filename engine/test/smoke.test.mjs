// Smoke tests for the critical engine paths: shape resolution, the base + preferences
// merge that generation reads, and an actual HTML -> PNG render. Run: npm test (in engine/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveShape, listShapes, DEFAULT_SHAPE } from "../shapes.mjs";
import { makeBrand } from "../brand.mjs";
import { renderHtmlToFile, auditHtml } from "../render.mjs";

test("shapes: default, named, and unknown", () => {
  const def = resolveShape(undefined);
  assert.equal(def.name, DEFAULT_SHAPE);
  assert.equal(def.width, 1080);
  assert.equal(def.height, 1350);

  const sq = resolveShape("ig-square");
  assert.deepEqual([sq.width, sq.height], [1080, 1080]);

  const yt = resolveShape("youtube");
  assert.deepEqual([yt.width, yt.height], [1920, 1080]);

  assert.ok(listShapes().length >= 6);
  assert.throws(() => resolveShape("not-a-shape"), /Unknown shape/);
});

test("store: generation reads base overlaid with preferences", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-studio-test-"));
  process.env.BRAND_STUDIO_DATA = dir;
  // Import after setting the env so dataDir() resolves to the temp store. (store reads
  // the env lazily on each call, but importing fresh keeps the test self-contained.)
  const store = await import("../store.mjs?merge");

  const slug = "acme";
  store.ensureDirs(slug);
  fs.writeFileSync(
    store.brandJsonPath(slug),
    JSON.stringify({ slug, name: "Acme", voice: "punchy", colors: { accent: "#FF0000", ink: "#000000" } }),
  );
  fs.writeFileSync(
    store.preferencesPath(slug),
    JSON.stringify({ colors: { accent: "#00FF00" }, voice: "warmer" }),
  );

  const merged = store.loadBrand(slug);
  assert.equal(merged.voice, "warmer", "preference overrides a scalar");
  assert.equal(merged.colors.accent, "#00FF00", "preference overrides a token");
  assert.equal(merged.colors.ink, "#000000", "base token survives when not overridden");
  assert.equal(merged.name, "Acme", "untouched base field survives");
  assert.equal(merged.inspiration, undefined, "no inspiration → field absent");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("store: inspiration rides alongside, never merging into tokens", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-studio-inspo-"));
  process.env.BRAND_STUDIO_DATA = dir;
  const store = await import("../store.mjs?inspo");

  const slug = "acme";
  store.ensureDirs(slug);
  fs.writeFileSync(
    store.brandJsonPath(slug),
    JSON.stringify({
      slug, name: "Acme",
      colors: { accent: "#FF0000" },
      houseStyle: { cards: "hairline rows" },
    }),
  );

  // Absent: loadInspiration → null, loadBrand returns no inspiration field.
  assert.equal(store.loadInspiration(slug), null, "no file → null");
  let merged = store.loadBrand(slug);
  assert.equal(merged.inspiration, undefined, "no inspiration → field absent on loadBrand");

  // Present: loadBrand attaches it as a top-level field, untouched by the merge.
  const inspiration = {
    updatedAt: "2026-06-19",
    items: [{ id: "ins-001", source: "linkedin", tags: ["before-after"] }],
    distilled: {
      archetypes: [{ name: "before-after", summary: "two-column comparison" }],
      visualGrammar: { dividers: "hairline rules" },
      dos: ["lead with a number"],
      donts: ["no emoji"],
    },
  };
  fs.writeFileSync(store.inspirationPath(slug), JSON.stringify(inspiration));

  assert.deepEqual(store.loadInspiration(slug), inspiration, "loaded JSON round-trips");
  merged = store.loadBrand(slug);
  assert.deepEqual(merged.inspiration, inspiration, "attached at the top level");
  // The merge must not have folded inspiration into houseStyle or colors.
  assert.equal(merged.colors.accent, "#FF0000", "colors untouched");
  assert.equal(merged.houseStyle.cards, "hairline rows", "houseStyle untouched");
  assert.equal(merged.houseStyle.archetypes, undefined, "inspiration not merged into houseStyle");

  // ensureDirs also creates the inspiration folder.
  assert.ok(fs.existsSync(store.inspirationDir(slug)), "inspirationDir created");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("render: brand HTML -> PNG (skips if no Chromium present)", async (t) => {
  const brand = makeBrand({
    name: "Acme",
    colors: { bg: "#101010", ink: "#FFFFFF", accent: "#00E0A4" },
  });
  const shape = resolveShape("ig-square");
  const html = brand.htmlDoc({
    width: shape.width,
    height: shape.height,
    css: ".hero{padding:var(--safe,64px);} h1{color:var(--accent);font-size:72px;}",
    body: '<div class="hero"><h1>On brand</h1><p>Text stays text.</p></div>',
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-studio-png-"));
  const out = path.join(outDir, "smoke.png");
  try {
    await renderHtmlToFile(html, shape, out, { scale: 1 });
  } catch (e) {
    if (/No Chromium/.test(e.message)) {
      t.skip("no Chromium available in this environment");
      return;
    }
    throw e;
  }
  const buf = fs.readFileSync(out);
  assert.ok(buf.length > 1000, "PNG has real bytes");
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic header");
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("attribution: every render carries the Powered by Hourglass AI footer", () => {
  const brand = makeBrand({ name: "Acme" });
  const html = brand.htmlDoc({ width: 1080, height: 1080, css: "", body: "<div>hi</div>" });
  assert.match(html, /Powered by<\/span><span class="bs-attribution__brand">Hourglass AI/,
    "the footer text is in every document");
  assert.match(html, /class="bs-attribution"/, "wrapped in its styled pill");
  assert.match(html, /stroke="currentColor"/, "the hourglass glyph follows the badge colour");
  assert.match(html, /rgba\(4, 115, 90, 0\.95\)/, "the badge text is translucent deep teal");
  assert.match(html, /rgba\(255, 255, 255, 0\.85\)/, "on a light frosted chip");
  const frame = html.match(/<div class="frame"[^>]*>(.*)<\/div><\/body>/s)[1];
  assert.ok(frame.endsWith("Hourglass AI</span></div>"),
    "the badge is the last child of the frame, so it paints on top");
});

test("attribution: passes the legibility gate on both extreme backdrops (skips if no Chromium)", async (t) => {
  // The badge's light pill keeps its own backdrop light on any page, so the deep teal
  // clears the contrast floor against BOTH extremes. If either fails, whole classes of
  // brands break out of the box: a dark-brand render cannot be produced at all.
  const shape = resolveShape("ig-square");
  for (const bg of ["#FFFFFF", "#111110"]) {
    const brand = makeBrand({ name: "Acme", colors: { bg } });
    const html = brand.htmlDoc({ width: shape.width, height: shape.height, css: "", body: "" });
    let findings;
    try {
      findings = await auditHtml(html, shape);
    } catch (e) {
      if (/No Chromium/.test(e.message)) {
        t.skip("no Chromium available in this environment");
        return;
      }
      throw e;
    }
    assert.deepEqual(findings, [], `the badge alone must produce zero findings on ${bg}`);
  }
});
