// The logo lockup. Regression tests for a render that shipped an invisible logo:
// {{logo-light}} asked for an inverse lockup, brand.logo() ignored the colour whenever
// an asset file existed, and the dark wordmark went out on a dark surface. A variant
// that cannot be honoured must fail loudly instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeBrand } from "../brand.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const SVG_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <rect x="2" y="2" width="36" height="36" rx="6" fill="none" stroke="#1A1A1A" stroke-width="3"/>
  <circle cx="60" cy="20" r="8" fill="#EE5A3A"/>
</svg>`;

function kitWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-logo-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test("default variant renders the asset, at the configured height", () => {
  const dir = kitWith({ "wordmark.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  const brand = makeBrand({ name: "Acme", logo: { file: "wordmark.png", height: 34 } }, { assetsDir: dir });

  const html = brand.logo();
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /height:34px;width:auto/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("light variant on a raster logo with no inverse asset throws, and says how to fix it", () => {
  const dir = kitWith({ "wordmark.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const brand = makeBrand({ name: "Acme", logo: { file: "wordmark.png" } }, { assetsDir: dir });

  assert.throws(
    () => brand.logo({ variant: "light" }),
    (e) => {
      assert.match(e.message, /Acme has no light logo variant/);
      assert.match(e.message, /raster image, which cannot be recoloured/);
      assert.match(e.message, /"logo": \{ "light": "<file>" \}/, "names the brand.json fix");
      return true;
    },
    "an inverse lockup that cannot be produced must fail, not render dark-on-dark",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("light variant uses a dedicated inverse asset when the kit has one", () => {
  const dir = kitWith({
    "wordmark.png": Buffer.from([1, 2, 3]),
    "wordmark-light.png": Buffer.from([9, 9, 9, 9, 9]),
  });
  const brand = makeBrand(
    { name: "Acme", logo: { file: "wordmark.png", light: "wordmark-light.png" } },
    { assetsDir: dir },
  );

  const light = brand.logo({ variant: "light" });
  const dark = brand.logo({ variant: "dark" });
  assert.notEqual(light, dark, "the inverse lockup is a different asset");
  assert.match(light, new RegExp(Buffer.from([9, 9, 9, 9, 9]).toString("base64")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("light variant flattens an inline SVG to the requested colour, keeping outlines open", () => {
  const dir = kitWith({ "logo.svg": SVG_LOGO });
  const brand = makeBrand({ name: "Acme", logo: { file: "logo.svg" } }, { assetsDir: dir });

  const html = brand.logo({ variant: "light", color: "#FFFFFF" });
  assert.match(html, /<style>/, "emits a scoped mono rule");
  assert.match(html, /\*:not\(\[fill="none"\]\)\{fill:#FFFFFF\}/, "recolours filled shapes");
  assert.match(html, /\[stroke\]:not\(\[stroke="none"\]\)\{stroke:#FFFFFF\}/, "recolours strokes");
  assert.doesNotMatch(html, /\[fill="none"\]\{fill/, "never fills a shape that is deliberately open");

  // Two calls must not collide on the same generated class name.
  const second = brand.logo({ variant: "light", color: "#FFFFFF" });
  const cls = (s) => s.match(/bs-logo-mono-(\d+)/)[1];
  assert.notEqual(cls(html), cls(second), "each instance gets its own scope");
  fs.rmSync(dir, { recursive: true, force: true });
});

// A mark whose shapes stack cannot survive being painted one colour. The real case is
// a badge lockup: an outer ring around a band around a filled field with the letters
// knocked out of it. Flattened to white it renders as a featureless blob, and because
// the render still SUCCEEDS nothing catches it before the client does.
const STACKED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <path d="M0 0h100v40H0z" fill="#7A5AF8"/>
  <path d="M4 4h92v32H4z" fill="#1F8A70"/>
  <path d="M20 14h60v12H20z" fill="#FFFFFF"/>
</svg>`;

test("light variant refuses to flatten a stacked multi-fill mark into a silhouette", () => {
  const dir = kitWith({ "logo.svg": STACKED_SVG });
  const brand = makeBrand({ name: "Northwind", logo: { file: "logo.svg" } }, { assetsDir: dir });

  assert.doesNotThrow(() => brand.logo(), "the full-colour lockup is always fine");
  assert.throws(
    () => brand.logo({ variant: "light" }),
    (e) => {
      assert.match(e.message, /Northwind's logo \(logo\.svg\) paints 3 fill colours/);
      assert.match(e.message, /merge its shapes into a solid silhouette/);
      assert.match(e.message, /"logo": \{ "light": "<file>" \}/, "names the brand.json fix");
      assert.match(e.message, /use \{\{logo\}\}/, "offers the escape hatch that needs no new file");
      return true;
    },
    "a blob is a silent failure; it must be loud instead",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("light variant still flattens a mark whose shapes cannot merge", () => {
  // One filled shape plus an open outline: nothing stacks, so mono is lossless.
  const dir = kitWith({ "logo.svg": SVG_LOGO });
  const brand = makeBrand({ name: "Acme", logo: { file: "logo.svg" } }, { assetsDir: dir });
  assert.match(brand.logo({ variant: "light" }), /fill:#FFFFFF/, "single-fill marks keep working");

  // A gradient reference is not a flat colour and must not be counted as one.
  const grad = kitWith({
    "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="url(#g)"/></svg>`,
  });
  const gradBrand = makeBrand({ name: "Acme", logo: { file: "logo.svg" } }, { assetsDir: grad });
  assert.doesNotThrow(() => gradBrand.logo({ variant: "light" }));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(grad, { recursive: true, force: true });
});

test("icon variant throws when the kit has no mark, and never falls back to the full lockup", () => {
  const dir = kitWith({ "wordmark.png": Buffer.from([1, 2, 3]) });
  const brand = makeBrand({ name: "Acme", logo: { file: "wordmark.png" } }, { assetsDir: dir });

  assert.throws(() => brand.logo({ variant: "icon" }), /has no icon-only logo/);

  const withIcon = makeBrand(
    { name: "Acme", logo: { file: "wordmark.png", icon: "mark.svg" } },
    { assetsDir: kitWith({ "wordmark.png": Buffer.from([1]), "mark.svg": SVG_LOGO }) },
  );
  assert.match(withIcon.logo({ variant: "icon" }), /<svg/, "uses the mark, inlined");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("with no uploaded logo at all, the generated wordmark still inverts", () => {
  const brand = makeBrand({ name: "Acme Co", colors: { ink: "#161616", white: "#FFFFFF" } });
  assert.match(brand.logo(), /--logo-color:#161616/);
  assert.match(brand.logo({ variant: "light" }), /--logo-color:#FFFFFF/);
  assert.match(brand.logo(), /Acme<br>Co/, "the name wraps as a wordmark");
});

test("an unknown {{placeholder}} fails the render instead of baking braces into the PNG", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-ph-"));
  const slug = "acme";
  const brandDir = path.join(dataDir, "brands", slug);
  fs.mkdirSync(path.join(brandDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(brandDir, "brand.json"),
    JSON.stringify({ slug, name: "Acme", colors: { ink: "#161616" } }),
  );

  const out = path.join(dataDir, "out.png");
  const args = ["--brand", slug, "--shape", "ig-square", "--data", "-", "--out", out];
  const body = JSON.stringify({ body: '<div class="f">{{logo-mark}}</div>' });

  await assert.rejects(
    async () => {
      const child = run("node", [path.join(here, "..", "cli.mjs"), ...args], {
        env: { ...process.env, BRAND_STUDIO_DATA: dataDir },
      });
      child.child.stdin.end(body);
      await child;
    },
    (e) => {
      assert.match(e.stderr, /Unknown placeholder \{\{logo-mark\}\}/);
      assert.match(e.stderr, /Known placeholders:.*\{\{logo-icon\}\}/s, "lists what it does know");
      return true;
    },
  );
  assert.equal(fs.existsSync(out), false, "nothing is written when a placeholder is wrong");
  fs.rmSync(dataDir, { recursive: true, force: true });
});
