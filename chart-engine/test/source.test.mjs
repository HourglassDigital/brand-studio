// Structured source attribution (spec §5.2): one canonical form, rendered
// exactly once, with legacy spec.footer mapped rather than broken.
// Deterministic - no chromium needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatSource, SOURCE_FIELDS } from "../render/charts/source.mjs";
import { validateSpec, applyDefaults } from "../spec.mjs";
import { renderBar } from "../render/charts/bar.mjs";

const brand = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "kits", "derivation.brand.json"), "utf8"),
);

const baseSpec = () => ({
  type: "bar",
  title: "T",
  series: [{ name: "s", values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] }],
});

test("the full citation renders in one fixed order", () => {
  assert.equal(
    formatSource({
      publication: "Financial Times",
      author: "John Burn-Murdoch",
      handle: "@jburnmurdoch",
      year: 2026,
      note: "Values digitised from the published graphic",
    }),
    "Source: Financial Times, John Burn-Murdoch (@jburnmurdoch), 2026. Values digitised from the published graphic",
  );
});

test("any subset of fields still forms a sentence, never an orphaned label", () => {
  assert.equal(formatSource({ publication: "Costco annual report" }), "Source: Costco annual report");
  assert.equal(formatSource({ note: "internal data" }), "internal data");
  assert.equal(formatSource({ url: "https://example.com/x" }), "Source: https://example.com/x");
  assert.equal(formatSource({}), "");
  assert.equal(formatSource(undefined), "");
});

test("a cited work carries its authors and quotes its title", () => {
  assert.equal(
    formatSource({ work: "Writing Code vs. Shipping Code", authors: "Demirer et al", year: 2026 }),
    "Source: “Writing Code vs. Shipping Code”, Demirer et al, 2026",
  );
});

test("a rendered chart carries the attribution exactly once", () => {
  const spec = applyDefaults({ ...baseSpec(), source: { publication: "ABS" } }, brand);
  const { body } = renderBar({ brand, spec, size: { width: 1600, height: 1100 } });
  assert.equal([...body.matchAll(/Source: ABS/g)].length, 1);
});

test("legacy spec.footer maps onto source.note and the footer key is removed", () => {
  const out = applyDefaults({ ...baseSpec(), footer: "hand-typed source line" }, brand);
  assert.equal(out.source.note, "hand-typed source line");
  assert.ok(!("footer" in out));
});

test("an explicit source.note wins over a legacy footer", () => {
  const out = applyDefaults(
    { ...baseSpec(), footer: "old", source: { note: "new" } },
    brand,
  );
  assert.equal(out.source.note, "new");
});

test("the validator flags footer as deprecated without failing the spec", () => {
  const v = validateSpec({ ...baseSpec(), footer: "old" });
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /footer is deprecated/.test(w)));
});

test("source must be an object, and unknown fields are named in a warning", () => {
  assert.equal(validateSpec({ ...baseSpec(), source: "FT" }).ok, false);
  const v = validateSpec({ ...baseSpec(), source: { publiction: "FT" } });
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /publiction/.test(w) && SOURCE_FIELDS.every((f) => w.includes(f))));
});
