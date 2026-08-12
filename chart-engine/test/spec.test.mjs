import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec, SPEC_TYPES } from "../spec.mjs";

test("SPEC_TYPES lists the supported chart types", () => {
  assert.deepEqual(SPEC_TYPES, ["area", "line", "bar", "pie"]);
});

test("a minimal pie spec validates", () => {
  const r = validateSpec({ type: "pie", series: [{ values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] }] });
  assert.equal(r.ok, true, r.errors.join());
});

test("pie rejects non-positive values and missing labels", () => {
  const r = validateSpec({ type: "pie", series: [{ values: [{ x: "A", y: 0 }, { y: 5 }] }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /must be > 0/);
  assert.match(r.errors.join(), /need a label/);
});

test("unconfirmed uncertain extraction blocks render (hard data gate)", () => {
  const base = { type: "bar", series: [{ values: [{ x: "C1", y: 1 }] }] };
  const blocked = validateSpec({ ...base, provenance: { uncertain: ["y"], confirmedByUser: false } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors.join(), /confirm/i);
  const ok = validateSpec({ ...base, provenance: { uncertain: ["y"], confirmedByUser: true } });
  assert.equal(ok.ok, true);
});

test("emphasis must name a category that exists", () => {
  const bar = (emphasis) => ({
    type: "bar",
    emphasis,
    series: [{ name: "a", values: [{ x: "Q1", y: 1 }, { x: "Q2", y: 2 }] }],
  });
  assert.equal(validateSpec(bar("Q2")).ok, true);
  const bad = validateSpec(bar("Q9"));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /Q9.*Q1, Q2/, "the error must list the labels that do exist");
});

test("emphasis is rejected on chart types that cannot show it", () => {
  const r = validateSpec({
    type: "area",
    emphasis: "2024",
    series: [{ name: "a", values: [{ x: 1, y: 1 }] }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /emphasis is only valid for bar and pie/);
});
