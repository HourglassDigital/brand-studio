// Chart-type-agnostic annotations: anchors resolve per type, drawing uses the
// built-in elbow, and targets that do not exist fail loudly.
// Deterministic - no chromium needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scaleBand, scaleLinear } from "d3-scale";
import { pie as d3pie } from "d3-shape";
import { barAnchor, pieAnchor } from "../render/charts/annotate.mjs";
import { validateSpec } from "../spec.mjs";
import { renderBar } from "../render/charts/bar.mjs";
import { renderPie } from "../render/charts/pie.mjs";
import { renderArea } from "../render/charts/area.mjs";

const brand = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "kits", "derivation.brand.json"), "utf8"),
);
const size = { width: 1600, height: 1100 };

// Anchor maths, on hand-built scales so the numbers are checkable.

const series = [
  { name: "first", values: [{ x: "A", y: 10 }, { x: "B", y: 30 }] },
  { name: "second", values: [{ x: "A", y: 20 }, { x: "B", y: 5 }] },
];
const categories = ["A", "B"];
const names = ["first", "second"];
const x0 = scaleBand().domain(categories).range([100, 900]).paddingInner(0.25).paddingOuter(0.1);
const x1 = scaleBand().domain(names).range([0, x0.bandwidth()]).padding(0.12);
const y = scaleLinear().domain([0, 40]).range([1000, 100]);

test("bar anchor with a series name lands on that bar's top centre", () => {
  const a = barAnchor({ category: "B", series: "first" }, { categories, names, series, x0, x1, y, stacked: false });
  assert.equal(a.x, x0("B") + x1("first") + x1.bandwidth() / 2);
  assert.equal(a.y, y(30));
});

test("bar anchor without a series lands on the group's tallest bar", () => {
  const a = barAnchor({ category: "A" }, { categories, names, series, x0, x1, y, stacked: false });
  assert.equal(a.x, x0("A") + x0.bandwidth() / 2);
  assert.equal(a.y, y(20));
});

test("stacked bar anchor with a series lands on that segment's top", () => {
  const a = barAnchor({ category: "A", series: "second" }, { categories, names, series, x0, x1, y, stacked: true });
  assert.equal(a.x, x0("A") + x0.bandwidth() / 2);
  assert.equal(a.y, y(30)); // 10 + 20 cumulative
});

test("pie anchor sits on the outer arc at the slice's mid angle", () => {
  const values = [{ label: "A", y: 1 }, { label: "B", y: 1 }];
  const arcs = d3pie().sort(null).value((d) => d.y)(values);
  const a = pieAnchor({ slice: "A" }, { arcs, values, cx: 500, cy: 400, R: 200 });
  // A spans 0..pi, mid pi/2: due east of centre.
  assert.ok(Math.abs(a.x - 700) < 1e-6 && Math.abs(a.y - 400) < 1e-6);
});

// Routing: every chart type uses the built-in elbow.

test("every chart type renders annotations with the built-in elbow", () => {
  const bar = renderBar({ brand, spec: {
    type: "bar", title: "T",
    series: [{ name: "first", values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] }],
    annotations: [{ category: "B", text: "note" }],
  }, size }).body;
  const pie = renderPie({ brand, spec: {
    type: "pie", title: "T",
    series: [{ values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] }],
    annotations: [{ slice: "B", text: "note" }],
  }, size }).body;
  const area = renderArea({ brand, spec: {
    type: "area", title: "T",
    series: [{ values: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
    annotations: [{ x: 2, y: 2, text: "peak" }],
  }, size }).body;
  for (const body of [bar, pie, area]) assert.match(body, /class="annot"/);
});

// Validation: an arrow pointing at nothing must never render.

const barSpec = (annotations) => ({
  type: "bar", series: [{ name: "first", values: [{ x: "A", y: 1 }] }], annotations,
});

test("bar annotations naming an unknown category or series are rejected", () => {
  assert.ok(!validateSpec(barSpec([{ category: "Z", text: "x" }])).ok);
  assert.ok(!validateSpec(barSpec([{ category: "A", series: "zzz", text: "x" }])).ok);
  assert.ok(validateSpec(barSpec([{ category: "A", series: "first", text: "x" }])).ok);
});

test("pie annotations naming an unknown slice are rejected", () => {
  const spec = { type: "pie", series: [{ values: [{ x: "A", y: 1 }] }], annotations: [{ slice: "Z", text: "x" }] };
  const v = validateSpec(spec);
  assert.ok(!v.ok && v.errors.some((e) => /slice "Z"/.test(e)));
});

test("area annotations need x and y in data units, and every annotation needs text", () => {
  const area = { type: "area", series: [{ values: [{ x: 1, y: 1 }] }] };
  assert.ok(!validateSpec({ ...area, annotations: [{ text: "x" }] }).ok);
  assert.ok(!validateSpec({ ...area, annotations: [{ x: 1, y: 1 }] }).ok);
  assert.ok(validateSpec({ ...area, annotations: [{ x: 1, y: 1, text: "x" }] }).ok);
});
