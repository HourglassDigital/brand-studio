// Series colour derivation: turn a brand's small set of identity hues into as
// many distinct chart slots as a chart needs, without inventing a hue the brand
// has never used.
//
// The problem this solves: a kit declares two or three colours that can carry
// data (chart.series / chart.hues). Ask for a fourth series and the old
// seriesColour() fallback reached for ink and muted - a black bar and a grey bar
// in a chart that is meant to be orange and blue. Structural colours are not
// data colours.
//
// The fix: hold each hue's angle exactly where the brand put it and vary only
// lightness, so #FC6932 also yields a deep burnt orange. Same hue, same
// identity, a slot the eye reads as separate. Nothing is generated off the
// brand's hue wheel, so a kit cannot drift into colours its owner never chose.
//
// Everything here is a pure function of the kit: same brand.json in, same hex
// strings out, so goldens stay stable (see tests/palette.test.mjs, which pins
// the derived hexes exactly - Math.cbrt is not bit-identical across engines and
// a 1/255 drift would otherwise surface as a pile of golden diffs).
//
// Colour space is OKLCH, because lightness steps in sRGB are perceptually
// uneven: the same numeric step looks like a big jump in yellow and no change
// at all in blue. Conversions are the standard Björn Ottosson matrices.

// Lightness rungs derived steps may land on. Chosen so every rung sits inside
// the 0.43-0.77 band where a mark stays legible as a fill, with enough gap
// between rungs that two steps of one hue never read as a rendering artefact.
const LADDER = [0.47, 0.6, 0.73];

// Palette keys that describe furniture, never data. A kit that lists one of
// these under chart.hues is a kit-authoring mistake worth failing on: a grey
// series is exactly the bug this module exists to remove.
const STRUCTURAL = new Set(["bg", "surface", "ink", "muted", "line"]);

const DEFAULT_MAX_SLOTS = 9;

// Colour conversion

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function isHexColour(v) {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

function expandHex(hex) {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return h;
}

function toLinear(hex) {
  const h = expandHex(hex);
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

function oklabFromLinear([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearFromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function toOklch(hex) {
  const [L, a, b] = oklabFromLinear(toLinear(hex));
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

// Uppercase to match how kits author their palettes, so a derived slot printed
// by doctor sits next to the brand's own values without looking foreign.
function hexFromLinear(rgb) {
  return (
    "#" +
    rgb
      .map((c) => {
        const v = linearToSrgb(Math.max(0, Math.min(1, c)));
        return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
      })
      .join("")
      .toUpperCase()
  );
}

const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

// Build a colour at the given hue angle and lightness, pushing chroma as far as
// the sRGB gamut allows up to ceiling. Binary search rather than a closed form
// because the gamut boundary in OKLCH has no simple analytic shape; 32 rounds
// pins it well below one 8-bit step, so the result is stable.
export function stepColour(hueDeg, L, ceiling) {
  const rad = (hueDeg * Math.PI) / 180;
  const at = (C) => linearFromOklab([L, C * Math.cos(rad), C * Math.sin(rad)]);
  let lo = 0;
  let hi = ceiling;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return hexFromLinear(at(lo));
}

// Slot derivation

function resolveHues(brand) {
  const palette = brand.palette || {};
  const keys = brand.chart && brand.chart.hues;
  if (!Array.isArray(keys) || keys.length === 0) return null;

  const slug = (brand._meta && brand._meta.slug) || brand.slug || "unknown";
  const structural = keys.filter((k) => STRUCTURAL.has(k));
  if (structural.length) {
    throw new Error(
      `Brand "${slug}": chart.hues lists structural colour(s) ${structural.join(", ")}. ` +
        `Those are background/text/rule colours, not data colours - a chart series must never be drawn in them.`,
    );
  }
  const missing = keys.filter((k) => !isHexColour(palette[k]));
  if (missing.length) {
    throw new Error(
      `Brand "${slug}": chart.hues names ${missing.join(", ")}, which ${
        missing.length === 1 ? "is" : "are"
      } not a hex colour in the palette.`,
    );
  }
  return keys.map((k) => palette[k]);
}

// Separation thresholds, OKLab distance x100.
//
// A fixed tier pattern cannot be trusted to produce distinguishable slots: how
// far apart two hues sit depends entirely on the brand. A kit whose blue sits at
// 271 deg and whose purple sits at 293 deg has them only 22 deg apart, so they
// separate on lightness alone - put both on the same rung and they collapse to a
// worst-adjacent distance of 3.1, which no amount of tidy pattern-making fixes.
// So the module does not assume; it measures every candidate and refuses to emit
// a slot that fails.
//
// NEIGHBOUR_* gates the pair a reader compares most: marks that touch (bars in
// a group, stacked segments, neighbouring pie slices). ANY_* is the weaker gate
// applied against every slot already placed, because a legend puts all of them
// side by side even when the marks are far apart.
const NEIGHBOUR_CVD = 8;
const NEIGHBOUR_NORMAL = 15;
const ANY_CVD = 6;
const ANY_NORMAL = 10;

// Every colour this brand can offer, in a fixed order: the declared hues first
// (verbatim, they are the brand), then each hue at each lightness rung.
function candidatePool(bases) {
  // The chroma ceiling is the brand's OWN chroma for that hue, never more. A
  // muted teal must not spawn an electric cyan two slots later: holding the hue
  // angle is not enough to stay on-brand if saturation is free to climb to the
  // gamut edge. The gamut search may still land below this ceiling at extreme
  // lightness, which is the right direction to err in.
  const meta = bases.map((hex) => {
    const { C, h } = toOklch(hex);
    return { h, ceiling: C };
  });
  const pool = [...bases];
  for (const rung of LADDER) {
    for (const m of meta) {
      const hex = stepColour(m.h, rung, m.ceiling);
      // Drop anything that is effectively a brand colour already: two slots one
      // 8-bit step apart is a rendering artefact, not an identity.
      if (!pool.some((c) => deltaE(c, hex) < 2)) pool.push(hex);
    }
  }
  return pool;
}

const separation = (a, b) => Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));

function admissible(candidate, placed) {
  if (placed.length === 0) return true;
  const prev = placed[placed.length - 1];
  if (separation(candidate, prev) < NEIGHBOUR_CVD) return false;
  if (deltaE(candidate, prev) < NEIGHBOUR_NORMAL) return false;
  return placed.every(
    (c) => separation(candidate, c) >= ANY_CVD && deltaE(candidate, c) >= ANY_NORMAL,
  );
}

// Greedy: at each slot take the admissible candidate that sits furthest from
// everything already placed. Deterministic, and prefix-stable by construction -
// slot k is chosen without reference to how many slots were asked for, so
// growing a chart from 4 series to 5 never repaints the first four. That is the
// "colour follows the entity, not its rank" rule holding under a changing
// series count.
function buildSlots(bases, limit) {
  const pool = candidatePool(bases);
  const placed = bases.slice(0, Math.min(bases.length, limit));
  while (placed.length < limit) {
    let best = null;
    for (const candidate of pool) {
      if (placed.includes(candidate)) continue;
      if (!admissible(candidate, placed)) continue;
      const score = placed.reduce((min, c) => Math.min(min, separation(candidate, c)), Infinity);
      if (!best || score > best.score) best = { candidate, score };
    }
    if (!best) break;
    placed.push(best.candidate);
  }
  return placed;
}

/**
 * n chart colours for a brand, in assignment order.
 *
 * Contract: for n <= the number of declared hues the brand's own hex values are
 * returned verbatim, so one and two-series charts are pixel-identical to what
 * the kit has always produced. Derivation only engages at the slot where the
 * old code reached for black.
 */
export function seriesColours(brand, n) {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];

  const bases = resolveHues(brand);
  if (!bases) return legacyColours(brand, count);
  if (count <= bases.length) return bases.slice(0, count);

  const maxSlots = brand.chart?.maxSlots ?? DEFAULT_MAX_SLOTS;
  const slots = buildSlots(bases, Math.min(count, maxSlots));
  if (slots.length < count) {
    const slug = (brand._meta && brand._meta.slug) || brand.slug || "unknown";
    throw new Error(
      `Brand "${slug}": ${count} series requested but this kit can only supply ${slots.length} ` +
        `distinguishable colours (from ${bases.length} declared hue${bases.length === 1 ? "" : "s"}: ` +
        `${bases.join(", ")}). Past ${slots.length}, two series would be too close to tell apart. ` +
        `Fold the smallest series into "Other", split into small multiples, or add another hue to chart.hues.`,
    );
  }
  return slots;
}

/** The most slots this brand can safely fill. Used by doctor and the kit docs. */
export function slotCapacity(brand) {
  const bases = resolveHues(brand);
  if (!bases) return ((brand.chart && brand.chart.series) || []).length;
  return buildSlots(bases, brand.chart?.maxSlots ?? DEFAULT_MAX_SLOTS).length;
}

// Pre-chart.hues behaviour, kept so existing kits render byte-identically.
// The old ink/muted tail is deliberately NOT reproduced: it is the bug. A kit
// that runs past its declared series list now gets a loud, actionable error
// instead of a black bar nobody asked for.
function legacyColours(brand, n) {
  const palette = brand.palette || {};
  const order = (brand.chart && brand.chart.series) || [];
  const keys = order.filter((k) => isHexColour(palette[k]));
  if (keys.length === 0) {
    const fallback = ["accent2", "accent"].filter((k) => isHexColour(palette[k]));
    if (fallback.length === 0) {
      throw new Error(
        `Brand "${(brand._meta && brand._meta.slug) || brand.slug || "unknown"}": no usable series colours. ` +
          `Declare chart.hues (preferred) or chart.series in the kit.`,
      );
    }
    keys.push(...fallback);
  }
  if (n <= keys.length) return keys.slice(0, n).map((k) => palette[k]);
  throw new Error(
    `Brand "${(brand._meta && brand._meta.slug) || brand.slug || "unknown"}": ${n} series requested but only ` +
      `${keys.length} colour${keys.length === 1 ? "" : "s"} declared in chart.series. ` +
      `Add chart.hues to the kit so extra slots can be derived from the brand's own hues, or reduce the series count.`,
  );
}

// Emphasis support: quieten a colour without changing its hue, so a
// de-emphasised mark still reads as the same series in the legend.
export function softenColour(hex, amount = 0.6) {
  const { L, C, h } = toOklch(hex);
  const target = L + (0.88 - L) * amount;
  return stepColour(h, target, C * (1 - amount * 0.55));
}

// Verification helpers - used by tests and doctor, not by the render path.

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function simulate(hex, kind) {
  const [r, g, b] = toLinear(hex);
  const M = MACHADO[kind];
  return M.map((row) => Math.max(0, Math.min(1, row[0] * r + row[1] * g + row[2] * b)));
}

// Euclidean distance in OKLab x100. kind omitted = unsimulated (normal) vision.
export function deltaE(a, b, kind) {
  const pa = oklabFromLinear(kind ? simulate(a, kind) : toLinear(a));
  const pb = oklabFromLinear(kind ? simulate(b, kind) : toLinear(b));
  return 100 * Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

const relativeLuminance = (hex) => {
  const [r, g, b] = toLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Report on a derived slot list: the checks that can be computed from colour
 * alone. Adjacent pairs only, which is the right pairlist for bars, stacks,
 * lines and pie slices - the forms this tool renders, where only neighbouring
 * marks touch.
 */
export function checkColours(colours, surface) {
  const pairs = colours.slice(1).map((_, i) => [colours[i], colours[i + 1]]);
  const worst = (kind) =>
    pairs.reduce((min, [a, b]) => Math.min(min, deltaE(a, b, kind)), Infinity);
  const cvd = Math.min(worst("protan"), worst("deutan"));
  const normal = worst();
  const lowContrast = colours.filter((c) => contrastRatio(c, surface) < 3);
  return {
    cvd: pairs.length ? cvd : Infinity,
    normal: pairs.length ? normal : Infinity,
    lowContrast,
    // 8.0 is the separation target for adjacent marks; 15.0 the floor below
    // which full-colour readers struggle with neighbouring slots too.
    ok: !pairs.length || (cvd >= 8 && normal >= 15),
  };
}

/**
 * n colours for ORDERED slices (stages, size bands, low to high) when the kit
 * declares no explicit ramp: one hue, stepped light to dark, so the fade itself
 * carries the ranking. A single hue is the point - a rainbow would imply
 * categories, which is what ordered data is not.
 *
 * Uses the first declared hue, or palette.accent for kits predating chart.hues.
 */
export function ordinalColours(brand, n) {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];
  const bases = resolveHues(brand);
  const base = bases ? bases[0] : (brand.palette || {}).accent;
  if (!isHexColour(base)) {
    throw new Error(
      `Brand "${(brand._meta && brand._meta.slug) || brand.slug || "unknown"}": ordered data needs a hue to ` +
        `ramp along. Declare chart.hues (or chart.pie.ramp) in the kit.`,
    );
  }
  const { C, h } = toOklch(base);
  if (count === 1) return [base];
  // Light to dark across the legible band, ends inset so the pale end still
  // reads as a fill and the dark end still reads as the brand's hue.
  const LIGHT = 0.78;
  const DARK = 0.44;
  return Array.from({ length: count }, (_, i) =>
    stepColour(h, LIGHT + ((DARK - LIGHT) * i) / (count - 1), C),
  );
}

/**
 * Does this colour list read as an ORDER? Only if lightness moves one way the
 * whole path, with steps big enough to see.
 *
 * A kit's chart.pie.ramp is not automatically ordered. A ramp written for
 * variety (teal -> pale peach -> orange) wanders in lightness, so the middle
 * slice is the palest and the ranking is invisible. Such a ramp is fine for
 * "give me distinct slices" and useless for "show me the order", so ordered
 * charts fall back to a derived single-hue ramp when the declared one wanders.
 */
export function isOrderedRamp(colours) {
  if (!Array.isArray(colours) || colours.length < 2) return false;
  const ls = colours.map((c) => toOklch(c).L);
  const descending = ls[1] < ls[0];
  for (let i = 1; i < ls.length; i++) {
    const step = descending ? ls[i - 1] - ls[i] : ls[i] - ls[i - 1];
    if (step < 0.04) return false;
  }
  return true;
}
