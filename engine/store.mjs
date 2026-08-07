// Brand store: where saved brand kits live and how the active brand is resolved.
// Everything persists in the plugin's DATA dir so it survives plugin updates.
// Falls back to ~/.brand-studio when run outside Claude Code (e.g. tests).
//
// A brand on disk is:
//   brands/<slug>/brand.json         the immutable analysed base (identity, tokens, house style)
//   brands/<slug>/preferences.json   a separate, mutable override learned from edit loops
//   brands/<slug>/inspiration.json   distilled taste signals from references the brand admires
//   brands/<slug>/assets/            logo + font files
//   brands/<slug>/examples/          the brand's own reference graphics (their current look)
//   brands/<slug>/inspiration/       saved screenshots / files for things they admire
//
// Generation reads the base OVERLAID with preferences (preferences win). The base is never
// mutated to record a preference; that always goes in preferences.json. Inspiration rides
// alongside as its own top-level field on the loaded brand: it is taste, not look tokens,
// so it does not merge into colors / fonts / houseStyle.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function dataDir() {
  return (
    process.env.BRAND_STUDIO_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), ".brand-studio")
  );
}

export const brandsDir = () => path.join(dataDir(), "brands");
export const brandDir = (slug) => path.join(brandsDir(), slug);
export const assetsDir = (slug) => path.join(brandDir(slug), "assets");
export const examplesDir = (slug) => path.join(brandDir(slug), "examples");
export const inspirationDir = (slug) => path.join(brandDir(slug), "inspiration");
export const brandJsonPath = (slug) => path.join(brandDir(slug), "brand.json");
export const preferencesPath = (slug) => path.join(brandDir(slug), "preferences.json");
export const inspirationPath = (slug) => path.join(brandDir(slug), "inspiration.json");
const activeFile = () => path.join(dataDir(), "active.txt");

export function ensureDirs(slug) {
  fs.mkdirSync(brandsDir(), { recursive: true });
  if (slug) {
    fs.mkdirSync(assetsDir(slug), { recursive: true });
    fs.mkdirSync(examplesDir(slug), { recursive: true });
    fs.mkdirSync(inspirationDir(slug), { recursive: true });
  }
}

export function listBrands() {
  if (!fs.existsSync(brandsDir())) return [];
  return fs
    .readdirSync(brandsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(brandJsonPath(e.name)))
    .map((e) => e.name)
    .sort();
}

// The immutable analysed base.
export function loadProfile(slug) {
  const p = brandJsonPath(slug);
  if (!fs.existsSync(p)) throw new Error(`No brand "${slug}". Saved brands: ${listBrands().join(", ") || "(none)"}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// The mutable override (empty object if the brand has no saved preferences yet).
export function loadPreferences(slug) {
  const p = preferencesPath(slug);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

// Distilled taste signals (archetypes + visual grammar + dos/don'ts) the brand admires.
// Returns null when the brand has none yet, so callers can cheaply check `if (insp)`.
export function loadInspiration(slug) {
  const p = inspirationPath(slug);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Shallow-merge the nested token objects, top-level override for everything else.
// This is what generation actually designs against: base tokens, with any learned
// preference winning on a per-key basis.
export function mergeProfile(base = {}, prefs = {}) {
  const merged = { ...base, ...prefs };
  for (const key of ["colors", "fonts", "logo", "background", "houseStyle"]) {
    if (base[key] || prefs[key]) merged[key] = { ...(base[key] || {}), ...(prefs[key] || {}) };
  }
  return merged;
}

export function loadBrand(slug) {
  const merged = mergeProfile(loadProfile(slug), loadPreferences(slug));
  const inspiration = loadInspiration(slug);
  if (inspiration) merged.inspiration = inspiration;
  return merged;
}

export function activeSlug() {
  if (fs.existsSync(activeFile())) {
    const s = fs.readFileSync(activeFile(), "utf8").trim();
    if (s && listBrands().includes(s)) return s;
  }
  return listBrands()[0] || null;
}

export function setActive(slug) {
  if (!listBrands().includes(slug)) throw new Error(`No brand "${slug}" to activate.`);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(activeFile(), slug + "\n");
  return slug;
}

// Resolve a slug from an explicit arg, else the active/default brand.
export function resolveSlug(arg) {
  if (arg) {
    if (!listBrands().includes(arg)) throw new Error(`No brand "${arg}". Saved: ${listBrands().join(", ") || "(none)"}`);
    return arg;
  }
  const s = activeSlug();
  if (!s) throw new Error("No brands saved yet. Add one with the brand-add skill.");
  return s;
}
