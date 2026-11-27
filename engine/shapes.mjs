// Shapes: the standard canvases an asset can be rendered at. A shape is JUST a
// canvas (size + a recommended safe-area inset). It carries NO content assumptions:
// what gets drawn is decided by the brand kit + the prompt, not by the shape.
// Add a shape here and it is available to every brand.

export const SHAPES = {
  "ig-square":   { platform: "Instagram post",            width: 1080, height: 1080, safeArea: 64 },
  "ig-portrait": { platform: "Instagram / LinkedIn portrait", width: 1080, height: 1350, safeArea: 72 },
  "ig-story":    { platform: "Instagram / Reels story",    width: 1080, height: 1920, safeArea: 96 },
  "linkedin":    { platform: "LinkedIn post",              width: 1200, height: 1200, safeArea: 72 },
  "x":           { platform: "X / Twitter",                width: 1600, height: 900,  safeArea: 64 },
  "youtube":     { platform: "YouTube thumbnail / cover",  width: 1920, height: 1080, safeArea: 80 },
};

// Print shapes: physical pieces measured in millimetres. `trim` is the finished size,
// `bleed` the artwork that runs past the cut on every side (printers want 3 mm; some,
// like Officeworks, ask for 5 mm, so it can be overridden per render), `safe` the
// inset from the trim that text and logos stay inside. `pages` names the sides, in
// the order the print PDF carries them. Print shapes render with no attribution pill
// and a print-size legibility floor (6 pt), since they are read at arm's length.
export const PRINT_SHAPES = {
  "business-card": {
    platform: "Business card (AU standard)",
    trim: { width: 90, height: 55 }, bleed: 3, safe: 4, pages: ["front", "back"],
  },
};

export const MM_TO_PX = 96 / 25.4; // CSS pixels per millimetre
const PT_TO_PX = 96 / 72;
export const PRINT_MIN_FONT_PX = 6 * PT_TO_PX; // 6 pt, the smallest text a card can carry

export const DEFAULT_SHAPE = "ig-portrait";

export function listShapes() {
  return [
    ...Object.entries(SHAPES).map(([name, s]) => ({ name, ...s })),
    ...Object.entries(PRINT_SHAPES).map(([name]) => resolveShape(name)),
  ];
}

// Expand a print shape into pixel geometry. The canvas is the trim plus bleed on every
// side; safeArea is measured from the canvas edge (bleed + safe), so authored CSS that
// pads by --safe lands inside the printer's safe zone exactly as it does on social shapes.
function printShape(name, def, { bleed } = {}) {
  const b = bleed === undefined || bleed === true ? def.bleed : Number(bleed);
  if (!Number.isFinite(b) || b < 0 || b > 10) {
    throw new Error(`Bleed must be a number of millimetres between 0 and 10 (got "${bleed}").`);
  }
  const mm = { width: def.trim.width + 2 * b, height: def.trim.height + 2 * b };
  return {
    name, platform: def.platform, print: true, pages: def.pages,
    trim: def.trim, bleed: b, safe: def.safe, mm,
    width: Math.round(mm.width * MM_TO_PX),
    height: Math.round(mm.height * MM_TO_PX),
    safeArea: Math.round((b + def.safe) * MM_TO_PX),
  };
}

// Resolve a shape by name. Falls back to the default when nothing is given.
// Throws on an unknown name so a typo is a loud error, not a silent default.
export function resolveShape(name, opts = {}) {
  const key = (name && name !== true ? String(name) : DEFAULT_SHAPE).trim();
  if (PRINT_SHAPES[key]) return printShape(key, PRINT_SHAPES[key], opts);
  const shape = SHAPES[key];
  if (!shape) {
    const all = [...Object.keys(SHAPES), ...Object.keys(PRINT_SHAPES)];
    throw new Error(`Unknown shape "${key}". Available: ${all.join(", ")}.`);
  }
  if (opts.bleed !== undefined) throw new Error(`--bleed only applies to print shapes (${Object.keys(PRINT_SHAPES).join(", ")}).`);
  return { name: key, ...shape };
}
