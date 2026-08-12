// Typography roles (spec 2026-07-27 §5.1): every piece of chart text is a
// named role, and each role resolves to family, weight and size from the kit.
//
// The problem this solves: the renderers hardcoded font-family="monospace" in
// ten places and asked for weights the kits do not ship (800 for titles, 900
// for the watermark, over fonts whose heaviest file is 700). The browser
// answered by synthesising fake bold, a visible brand-wide inconsistency that
// no kit author chose. Roles put every text decision in one table, and weight
// clamping guarantees nothing is emitted that would make a browser invent a
// weight the kit never shipped.
//
// Clamping is deliberately a clamp, not a loud failure: the fail-loudly rule
// (v1 spec §12) covers substituting a different FAMILY. Snapping a requested
// 800 to a shipped 700 keeps the declared family, and doctor reports every
// clamp so the gap stays visible (see typographyClamps below).

// The role table. fam names the kit slot (headline or body); weight and size
// are the engine's requests, matching what the renderers drew before roles
// existed so that a kit shipping every weight renders identically.
export const ROLES = {
  title: { fam: "headline", weight: 800, size: 52 },
  subtitle: { fam: "body", weight: 700, size: 26 },
  axis: { fam: "body", weight: 400, size: 22 },
  category: { fam: "body", weight: 400, size: 22 },
  legend: { fam: "body", weight: 400, size: 22 },
  value: { fam: "body", weight: 400, size: 22 },
  annotation: { fam: "body", weight: 400, size: 26 },
  source: { fam: "body", weight: 400, size: 22 },
  watermark: { fam: "headline", weight: 900, size: 28 },
};

// The average glyph advance as a fraction of font size, used wherever layout
// needs a text width before any browser exists to measure one. 0.62 sits at
// the wide end of real proportional body faces, so estimates err toward too
// much space: text may get more room than it needs, never less.
const ADVANCE_RATIO = 0.62;

export function estimateTextWidth(text, size) {
  return String(text).length * size * ADVANCE_RATIO;
}

function familyOf(brand, fam) {
  return brand.fonts?.[fam]?.family || "system-ui";
}

// Weights the kit actually ships for a family slot, from its declared files.
// An empty or missing files list means the kit resolves to system fonts (the
// fontless _template does this by design); there is nothing to clamp against,
// so requests pass through untouched.
function shippedWeights(brand, fam) {
  const files = brand.fonts?.[fam]?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const ws = files.map((f) => +f.weight).filter((w) => Number.isFinite(w));
  return ws.length ? [...new Set(ws)].sort((a, b) => a - b) : null;
}

function clampWeight(requested, shipped) {
  if (!shipped || shipped.includes(requested)) return requested;
  // Nearest shipped weight; a tie snaps DOWN, because too light is a style
  // choice and too heavy does not exist (that is the fake-bold trap again).
  return shipped.reduce((best, w) =>
    Math.abs(w - requested) < Math.abs(best - requested) ||
    (Math.abs(w - requested) === Math.abs(best - requested) && w < best)
      ? w
      : best,
  );
}

/**
 * The kit's resolved typography. role() and attrs() are what renderers use;
 * clamps records every weight that had to snap, for doctor.
 *
 * Overrides exist because some text carries state the role table cannot know:
 * an emphasised category asks for 700, a pie legend scales its size to the
 * row. Overridden weights clamp exactly like the role's own.
 */
export function typography(brand) {
  const clamps = [];
  const seen = new Set();

  const resolve = (name, overrides = {}) => {
    const def = ROLES[name];
    if (!def) {
      throw new Error(`Unknown typography role "${name}". Roles: ${Object.keys(ROLES).join(", ")}`);
    }
    const requested = overrides.weight ?? def.weight;
    const shipped = shippedWeights(brand, def.fam);
    const weight = clampWeight(requested, shipped);
    if (weight !== requested) {
      const key = `${name}:${requested}`;
      if (!seen.has(key)) {
        seen.add(key);
        clamps.push({ role: name, family: familyOf(brand, def.fam), requested, used: weight });
      }
    }
    return { family: familyOf(brand, def.fam), weight, size: overrides.size ?? def.size };
  };

  const attrs = (name, overrides = {}) => {
    const r = resolve(name, overrides);
    return `font-family="${escapeAttr(r.family)}" font-weight="${r.weight}" font-size="${r.size}"`;
  };

  return { role: resolve, attrs, clamps };
}

/**
 * Every clamp this kit forces across the whole role table, including the
 * emphasis variants renderers actually request. Doctor prints these so a kit
 * asking the engine for weights it does not ship hears about it.
 */
export function typographyClamps(brand) {
  const t = typography(brand);
  for (const name of Object.keys(ROLES)) t.role(name);
  // The two live override cases: emphasised categories and pie legend labels
  // both bold to 700.
  t.role("category", { weight: 700 });
  t.role("legend", { weight: 700 });
  return t.clamps;
}

// Local copy rather than an import from util.mjs, which imports this module.
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
