// Manage saved brand kits.
//   node brandctl.mjs list                  -> JSON list of brands with the active flag
//   node brandctl.mjs path [slug]           -> the dirs/files for a brand (write brand.json, assets, examples, preferences, inspiration here)
//   node brandctl.mjs active                -> active slug
//   node brandctl.mjs use <slug>            -> set active brand
//   node brandctl.mjs validate <slug>       -> check brand.json is well-formed and on-brand-ready
//   node brandctl.mjs inspiration <slug>    -> the distilled taste signals for a brand (or null)
//   node brandctl.mjs shapes                -> the built-in canvas shapes an asset can render at
import {
  listBrands, loadProfile, loadPreferences, loadInspiration,
  brandDir, assetsDir, examplesDir, inspirationDir,
  brandJsonPath, preferencesPath, inspirationPath,
  activeSlug, setActive, ensureDirs,
} from "./store.mjs";
import { listShapes } from "./shapes.mjs";

const [cmd, arg] = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o));

try {
  switch (cmd) {
    case "list": {
      const active = activeSlug();
      out({
        ok: true, active,
        brands: listBrands().map((slug) => {
          const p = loadProfile(slug);
          return { slug, name: p.name || slug, handle: p.handle || "", active: slug === active };
        }),
      });
      break;
    }
    case "path": {
      const slug = arg || activeSlug();
      if (!slug) throw new Error("No brand specified and none active.");
      ensureDirs(slug);
      out({
        ok: true, slug,
        dir: brandDir(slug),
        brandJson: brandJsonPath(slug),
        preferences: preferencesPath(slug),
        inspiration: inspirationPath(slug),
        assets: assetsDir(slug),
        examples: examplesDir(slug),
        inspirationDir: inspirationDir(slug),
      });
      break;
    }
    case "active":
      out({ ok: true, active: activeSlug() });
      break;
    case "use":
      if (!arg) throw new Error("Usage: use <slug>");
      out({ ok: true, active: setActive(arg) });
      break;
    case "validate": {
      if (!arg) throw new Error("Usage: validate <slug>");
      const p = loadProfile(arg);
      const hasPrefs = Object.keys(loadPreferences(arg)).length > 0;
      const insp = loadInspiration(arg);
      const inspirationItems = insp?.items?.length || 0;
      const inspirationDistilled = !!insp?.distilled && Object.keys(insp.distilled).length > 0;
      const missing = ["slug", "name"].filter((k) => !p[k]);
      const warn = [];
      if (!p.colors) warn.push("no colors (generic defaults will be used)");
      if (!p.fonts) warn.push("no fonts (a default font will be used)");
      if (!p.handle) warn.push("no handle");
      if (!p.voice) warn.push("no voice (copy will not sound on-brand)");
      if (!p.houseStyle || !Object.keys(p.houseStyle).length)
        warn.push("no houseStyle (assets will not have a consistent, recognisable look)");
      if (!insp) warn.push("no inspiration (run /collect-inspo to teach taste)");
      out({
        ok: missing.length === 0,
        slug: arg, missing, warnings: warn,
        hasPreferences: hasPrefs,
        inspirationItems,
        inspirationDistilled,
      });
      break;
    }
    case "inspiration": {
      const slug = arg || activeSlug();
      if (!slug) throw new Error("No brand specified and none active.");
      const insp = loadInspiration(slug);
      out({ ok: true, slug, inspiration: insp });
      break;
    }
    case "shapes":
      out({ ok: true, shapes: listShapes() });
      break;
    default:
      out({ ok: false, error: `Unknown command "${cmd}". Use: list | path | active | use | validate | inspiration | shapes` });
      process.exit(1);
  }
} catch (e) {
  out({ ok: false, error: e.message });
  process.exit(1);
}
