// Series colour derivation: a kit's few identity hues expanded into as many
// chart slots as a chart needs, without inventing a hue the brand never chose.
// Deterministic - no chromium needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { adaptProfile } from "../brand-adapter.mjs";
import {
  seriesColours,
  slotCapacity,
  checkColours,
  softenColour,
  toOklch,
  ordinalColours,
} from "../render/palette.mjs";

// A synthetic, fontless kit. The template's own tests must never need a client
// kit to run; see tests/kits/derivation.brand.json.
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "kits", "derivation.brand.json"),
    "utf8",
  ),
);

/** Synthetic kits shipped with the test suite. */
function shippedKits() {
  const dir = path.join(import.meta.dirname, "brands");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "brand.json")))
    .map((d) => {
      const brandDir = path.join(dir, d.name);
      return adaptProfile(JSON.parse(fs.readFileSync(path.join(brandDir, "brand.json"), "utf8")), brandDir);
    });
}

const brand = (chart, palette) => ({
  slug: "test",
  palette: { bg: "#FFFFFF", ink: "#111111", muted: "#777777", line: "#EEEEEE", ...palette },
  chart,
});

// The contract that keeps existing output stable

test("a chart with no more series than declared hues gets the brand's own hexes, untouched", () => {
  const b = brand({ hues: ["accent2", "accent", "purple"] }, {
    accent: "#FC6932", accent2: "#3843EB", purple: "#B19EF8",
  });
  assert.deepEqual(seriesColours(b, 1), ["#3843EB"]);
  assert.deepEqual(seriesColours(b, 2), ["#3843EB", "#FC6932"]);
  assert.deepEqual(seriesColours(b, 3), ["#3843EB", "#FC6932", "#B19EF8"]);
});

test("adding a series never repaints the ones already there", () => {
  const b = brand({ hues: ["accent2", "accent", "purple"] }, {
    accent: "#FC6932", accent2: "#3843EB", purple: "#B19EF8",
  });
  const full = seriesColours(b, slotCapacity(b));
  for (let n = 1; n <= full.length; n++) {
    assert.deepEqual(
      seriesColours(b, n),
      full.slice(0, n),
      `slot assignment for n=${n} must be a prefix of the full ladder`,
    );
  }
});

// The drift guard. Math.cbrt and ** are not bit-identical across JS engines, so
// a derived hex could shift by one 8-bit step on a Node upgrade and silently
// invalidate every golden PNG at once. Pinning the strings here turns that into
// a millisecond failure with an obvious cause.
test("derived hexes are exactly these values (guards engine-level float drift)", () => {
  const b = { ...fixture, chart: { ...fixture.chart } };
  assert.deepEqual(seriesColours(b, 6), [
    "#1F6FEB", // primary, verbatim
    "#E4572E", // secondary, verbatim
    "#8B5CF6", // tertiary, verbatim
    "#A02B00", // secondary darkened  (hue 36.5 -> 36.4)
    "#72A8FF", // primary lightened   (hue 259.7 -> 259.6)
    "#0051C2", // primary darkened    (hue 259.7 -> 259.8)
  ]);
});

test("derivation holds each hue's angle and moves only lightness", () => {
  const b = { ...fixture, chart: { ...fixture.chart } };
  const [, secondary, , secondaryDeep] = seriesColours(b, 4);
  const base = toOklch(secondary);
  const derived = toOklch(secondaryDeep);
  assert.ok(
    Math.abs(base.h - derived.h) < 2,
    `hue must be preserved: ${base.h.toFixed(1)} vs ${derived.h.toFixed(1)}`,
  );
  assert.ok(derived.L < base.L - 0.1, "the derived step must be visibly darker, not a near-duplicate");
});

// Every ladder the tool can emit must actually be readable

// Loaded from test/brands/ rather than named, so this keeps holding as
// synthetic test kits come and go. It also covers the derivation fixture.
test("every slot count a shipped kit can produce clears the separation thresholds", () => {
  for (const kit of [...shippedKits(), fixture]) {
    const b = { ...kit, chart: { ...kit.chart } };
    const capacity = slotCapacity(b);
    assert.ok(capacity >= 3, `${kit.slug}: expected at least 3 slots, got ${capacity}`);
    for (let n = 2; n <= capacity; n++) {
      const report = checkColours(seriesColours(b, n), b.palette.bg);
      assert.ok(
        report.ok,
        `${kit.slug} at ${n} series: neighbouring colours too close ` +
          `(colour-blind ${report.cvd.toFixed(1)}, normal vision ${report.normal.toFixed(1)})`,
      );
    }
  }
});

test("capacity is computed from the brand's own hues, not assumed", () => {
  // Two hues far apart on the wheel support more slots than two close together.
  const wide = brand({ hues: ["a", "b"] }, { a: "#3843EB", b: "#FC6932" });
  const narrow = brand({ hues: ["a", "b"] }, { a: "#3843EB", b: "#4A3AD0" });
  assert.ok(
    slotCapacity(wide) > slotCapacity(narrow),
    `expected the wide-apart pair to yield more slots (${slotCapacity(wide)} vs ${slotCapacity(narrow)})`,
  );
});

// Failing loudly rather than drawing something wrong (spec §12)

test("asking for more series than the kit can colour throws, naming the real ceiling", () => {
  const b = { ...fixture, chart: { ...fixture.chart } };
  const capacity = slotCapacity(b);
  assert.throws(
    () => seriesColours(b, capacity + 1),
    (e) =>
      e.message.includes(String(capacity)) &&
      /Other|small multiples|chart\.hues/.test(e.message),
    "the error must state the ceiling and what to do about it",
  );
});

test("structural colours are refused as data colours", () => {
  for (const key of ["bg", "ink", "muted", "line", "surface"]) {
    const b = brand({ hues: ["accent", key] }, { accent: "#FC6932", surface: "#FFFFFF" });
    assert.throws(
      () => seriesColours(b, 2),
      /structural/i,
      `chart.hues must reject "${key}": a grey series is the bug this module removes`,
    );
  }
});

test("a hue naming a colour the palette does not have throws", () => {
  const b = brand({ hues: ["accent", "nonexistent"] }, { accent: "#FC6932" });
  assert.throws(() => seriesColours(b, 2), /nonexistent/);
});

// Kits written before chart.hues existed

test("without chart.hues a kit still renders from chart.series", () => {
  const b = brand({ series: ["accent2", "accent"] }, { accent: "#FC6932", accent2: "#3843EB" });
  assert.deepEqual(seriesColours(b, 2), ["#3843EB", "#FC6932"]);
});

test("running past chart.series no longer falls back to ink and muted", () => {
  const b = brand({ series: ["accent2", "accent"] }, { accent: "#FC6932", accent2: "#3843EB" });
  assert.throws(
    () => seriesColours(b, 3),
    /chart\.hues/,
    "the old fallback drew a black bar and a grey bar; it must now ask for hues instead",
  );
});

test("zero series is not an error", () => {
  assert.deepEqual(seriesColours(brand({ hues: ["accent"] }, { accent: "#FC6932" }), 0), []);
});

// Emphasis support

test("softening a colour keeps its hue so the legend still matches the mark", () => {
  const base = "#FC6932";
  const soft = softenColour(base);
  assert.ok(Math.abs(toOklch(base).h - toOklch(soft).h) < 2, "hue must survive de-emphasis");
  assert.ok(toOklch(soft).L > toOklch(base).L, "a de-emphasised mark should recede, not darken");
});

test("a derived step never exceeds the brand's own saturation for that hue", () => {
  // A muted brand must not spawn a vivid one: holding the hue angle is not
  // enough to stay on-brand if chroma is free to climb to the gamut edge.
  const muted = brand({ hues: ["a", "b"] }, { a: "#2E86AB", b: "#E4572E" });
  const baseC = Object.fromEntries(["#2E86AB", "#E4572E"].map((h) => [h, toOklch(h).C]));
  const ladder = seriesColours(muted, slotCapacity(muted));
  for (const colour of ladder) {
    const { C, h } = toOklch(colour);
    const nearest = Object.entries(baseC).reduce((best, [hex, c]) =>
      Math.abs(toOklch(hex).h - h) < Math.abs(toOklch(best[0]).h - h) ? [hex, c] : best,
      ["#2E86AB", baseC["#2E86AB"]]);
    assert.ok(
      C <= nearest[1] + 0.005,
      `${colour} (chroma ${C.toFixed(3)}) is more saturated than its base ${nearest[0]} (${nearest[1].toFixed(3)})`,
    );
  }
});

// Ordered data takes a one-hue ramp, not categorical colours

test("an ordered ramp runs light to dark along a single hue", () => {
  const b = brand({ hues: ["accent2", "accent"] }, { accent: "#FC6932", accent2: "#3843EB" });
  const ramp = ordinalColours(b, 5);
  assert.equal(ramp.length, 5);
  const hues = ramp.map((c) => toOklch(c).h);
  for (const h of hues) {
    assert.ok(Math.abs(h - hues[0]) < 2, `ordered ramps use ONE hue; got ${hues.join(", ")}`);
  }
  const ls = ramp.map((c) => toOklch(c).L);
  for (let i = 1; i < ls.length; i++) {
    assert.ok(ls[i] < ls[i - 1], `each step must be darker than the last; got ${ls.join(", ")}`);
  }
});

test("an ordered ramp of one is just the hue itself", () => {
  const b = brand({ hues: ["accent"] }, { accent: "#FC6932" });
  assert.deepEqual(ordinalColours(b, 1), ["#FC6932"]);
});

test("ordered data with no hue to ramp along fails loudly", () => {
  assert.throws(() => ordinalColours(brand({}, {}), 4), /chart\.hues|chart\.pie\.ramp/);
});
