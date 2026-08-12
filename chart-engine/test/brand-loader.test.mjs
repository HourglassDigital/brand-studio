import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeKitRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sbkit-"));
}

function writeKit(root, slug, brand, { withAssetsDir = false } = {}) {
  const dir = path.join(root, "brands", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brand.json"), JSON.stringify(brand), "utf8");
  if (withAssetsDir) fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  return dir;
}

test("loadBrand throws when a declared font file is missing on disk", async () => {
  const root = makeKitRoot();
  const slug = "missing-font-kit";
  writeKit(root, slug, {
    slug,
    name: "Missing Font Kit",
    fonts: {
      headlineFamily: "X",
      bodyFamily: "X",
      files: [{ family: "X", file: "missing.otf", weight: 700 }],
    },
  });
  // No assets/ dir created at all -> file definitely absent.

  process.env.BRAND_STUDIO_DATA = root;
  const { loadBrand } = await import(`../brand-loader.mjs?t=${Date.now()}-a`);

  assert.throws(() => loadBrand(slug), /declared font file missing/);
});

test("loadBrand returns a loaded brand when no fonts are declared", async () => {
  const root = makeKitRoot();
  const slug = "no-font-kit";
  writeKit(
    root,
    slug,
    {
      slug,
      name: "No Font Kit",
      colors: { bg: "#FFFFFF", ink: "#000000" },
      fonts: { headlineFamily: "system-ui", bodyFamily: "system-ui", files: [] },
    },
    { withAssetsDir: true },
  );

  process.env.BRAND_STUDIO_DATA = root;
  const { loadBrand } = await import(`../brand-loader.mjs?t=${Date.now()}-b`);

  const b = loadBrand(slug);
  assert.ok(b.palette);
  assert.equal(b.palette.bg, "#FFFFFF");
});

test("assertKitFonts checks every declared role, not just headline and body", async () => {
  const root = makeKitRoot();
  const dir = path.join(root, "brands", "roles");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const { assertKitFonts } = await import(`../brand-loader.mjs?t=${Date.now()}-c`);

  // A role the adapter does not produce today still gets checked, so a kit can
  // never land half-formed just because it grew a font role.
  assert.throws(
    () => assertKitFonts(dir, { fonts: { mono: { files: [{ file: "nope.otf" }] } } }, "roles"),
    /declared font file missing: assets\/nope.otf/,
  );
});

test("assertKitFonts passes when the declared file is on disk", async () => {
  const root = makeKitRoot();
  const dir = path.join(root, "brands", "present");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "Real.otf"), "not really a font", "utf8");

  const { assertKitFonts } = await import(`../brand-loader.mjs?t=${Date.now()}-d`);

  assert.doesNotThrow(() =>
    assertKitFonts(dir, { fonts: { headline: { files: [{ file: "Real.otf" }] } } }, "present"));
});

test("listBrands reports where each kit resolved from", async () => {
  const root = makeKitRoot();
  const slug = "located-kit";
  writeKit(root, slug, {
    slug,
    name: "Located Kit",
    colors: { bg: "#FFFFFF" },
    fonts: { headlineFamily: "system-ui", bodyFamily: "system-ui", files: [] },
  }, { withAssetsDir: true });

  process.env.BRAND_STUDIO_DATA = root;
  const { listBrands, brandRoots } = await import(`../brand-loader.mjs?t=${Date.now()}-e`);

  const row = listBrands().find((b) => b.slug === slug);
  assert.ok(row, "the kit should be listed");
  assert.equal(row.dir, path.join(root, "brands", slug));
  assert.deepEqual(brandRoots(), [path.join(root, "brands")]);
});
