// Dependency preflight (spec §10). "fail" blocks rendering; "warn" degrades.
import fs from "node:fs";
import path from "node:path";
import { resolveExecutable } from "./render/playwright.mjs";
import { loadBrand, listBrands, brandRoots, brandsRoot } from "./brand-loader.mjs";
import { typographyClamps } from "./render/charts/typography.mjs";

export async function runDoctor({ brand } = {}) {
  const checks = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push(major >= 20
    ? { name: "node", status: "ok", message: `Node ${process.versions.node}` }
    : { name: "node", status: "fail", message: `Node ${process.versions.node} - need >= 20` });

  try {
    checks.push({ name: "chromium", status: "ok", message: resolveExecutable() });
  } catch (e) {
    checks.push({ name: "chromium", status: "fail", message: e.message });
  }

  const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  checks.push({ name: "playwright-pin", status: "ok",
    message: `playwright-core pinned at ${pkg.dependencies["playwright-core"]} (golden-test determinism)` });

  // Which kits resolved, and from where. The root is printed either way:
  // "no kits" is almost always "looked in the wrong data dir", not "kit missing".
  const kits = listBrands();
  checks.push(kits.length
    ? { name: "kits", status: "ok",
        message: `${kits.length} found (${kits.map((k) => k.slug).join(", ")}); searching ${brandRoots().join(path.delimiter)}` }
    : { name: "kits", status: "warn",
        message: `no brand kits found. Searched ${brandRoots().join(path.delimiter)}. ` +
          `Set BRAND_STUDIO_DATA to the directory holding brands/, or add a kit under ${brandsRoot()}.` });

  if (brand) {
    try {
      const b = loadBrand(brand); // kit resolved + adapted via the store's search path
      checks.push({ name: "brand", status: "ok", message: `${b.name} kit loads; fonts present` });

      // Weight clamps (spec §5.1): a role asking for a weight the kit does not
      // ship snaps to the nearest shipped file instead of letting the browser
      // synthesise fake bold. Deliberate, but never silent - the kit owner
      // should know which asks the fonts cannot honour.
      const clamps = typographyClamps(b);
      checks.push(clamps.length
        ? { name: "typography", status: "warn",
            message: "weight clamps: " + clamps
              .map((c) => `${c.role} ${c.requested}->${c.used} (${c.family} ships no ${c.requested})`)
              .join("; ") }
        : { name: "typography", status: "ok",
            message: "every role weight resolves to a shipped font file (or the kit is fontless)" });
    } catch (e) {
      checks.push({ name: "brand", status: "fail", message: e.message });
    }
  }

  const critic = !!process.env.OPENAI_API_KEY;
  checks.push(critic
    ? { name: "cross-model critic", status: "ok", message: "OPENAI_API_KEY present" }
    : { name: "cross-model critic", status: "warn",
        message: "OPENAI_API_KEY absent - visual critique runs in degraded mode (rubric-only). The codex CLI does not cover image critique." });

  return { ok: !checks.some((c) => c.status === "fail"), checks };
}
