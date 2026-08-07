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

export const DEFAULT_SHAPE = "ig-portrait";

export function listShapes() {
  return Object.entries(SHAPES).map(([name, s]) => ({ name, ...s }));
}

// Resolve a shape by name. Falls back to the default when nothing is given.
// Throws on an unknown name so a typo is a loud error, not a silent default.
export function resolveShape(name) {
  const key = (name && name !== true ? String(name) : DEFAULT_SHAPE).trim();
  const shape = SHAPES[key];
  if (!shape) {
    throw new Error(`Unknown shape "${key}". Available: ${Object.keys(SHAPES).join(", ")}.`);
  }
  return { name: key, ...shape };
}
