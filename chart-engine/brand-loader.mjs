// Resolve a kit through brand-studio's single-root plugin store, then adapt it
// to the render engine's shape. No hardcoded paths: engine/store.mjs owns the
// data-dir resolution.
import fs from "node:fs";
import path from "node:path";
import { adaptProfile } from "./brand-adapter.mjs";
import {
  loadBrand as loadPluginBrand, brandDir, listBrands as listPluginBrands,
  resolveSlug, brandsDir,
} from "../engine/store.mjs";

/** Where new kits are written. */
export function brandsRoot() { return brandsDir(); }

/** The single brands/ dir brand-studio reads from. */
export function brandRoots() { return [brandsDir()]; }

export function listBrands() {
  return listPluginBrands().map((slug) => {
    const p = loadPluginBrand(slug);
    const dir = brandDir(slug);
    return { slug, name: p.name || slug, aliases: p.aliases || [], dir, root: path.dirname(dir) };
  });
}

/**
 * Fonts fail loudly; nothing is substituted silently (spec §12). Exported so
 * anything that installs or verifies a kit runs the same check, and so a kit can
 * never land half-formed.
 */
export function assertKitFonts(dir, brand, slug) {
  for (const role of Object.keys(brand.fonts || {})) {
    for (const f of brand.fonts[role]?.files || []) {
      const abs = path.join(dir, "assets", f.file);
      if (!fs.existsSync(abs)) {
        throw new Error(
          `Brand "${slug}": declared font file missing: assets/${f.file}. ` +
            "Fonts are never substituted silently - add the file or remove the declaration.",
        );
      }
    }
  }
}

export function loadBrand(input) {
  const slug = resolveSlug(input);
  const profile = loadPluginBrand(slug);     // base overlaid with preferences.json
  const dir = brandDir(slug);
  const adapted = adaptProfile(profile, dir);
  assertKitFonts(dir, adapted, slug);
  return adapted;
}
