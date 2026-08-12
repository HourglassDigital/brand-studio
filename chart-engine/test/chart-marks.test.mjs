// Mark treatment: the kit fields that describe how data marks are drawn.
// chart.borderWidth and chart.gridStyle were declared in every shipped kit and
// read by nothing, so charts came out flatter than the brand asked for.
// Deterministic - no chromium needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chartScaffold } from "../render/charts/util.mjs";

const size = { width: 1600, height: 1100 };
const spec = { title: "Test" };
const scaffold = (chart) =>
  chartScaffold({
    brand: { slug: "test", palette: { bg: "#FFFFFF", ink: "#232222", muted: "#6B6660", line: "#EAE2D5" }, chart },
    spec,
    size,
  });

test("gridStyle defaults to plain, matching what kits rendered before it was read", () => {
  const sc = scaffold({});
  assert.match(sc.gridAttrs, /stroke-width="1"/);
  assert.doesNotMatch(sc.gridAttrs, /dasharray/);
});

test("faint-warm draws a dotted rule rather than a solid one", () => {
  assert.match(scaffold({ gridStyle: "faint-warm" }).gridAttrs, /stroke-dasharray/);
});

test("gridStyle none removes the rules entirely", () => {
  assert.equal(scaffold({ gridStyle: "none" }).gridAttrs, null);
});

test("an unknown gridStyle fails loudly and lists the styles that exist", () => {
  assert.throws(
    () => scaffold({ gridStyle: "squiggly" }),
    (e) => /squiggly/.test(e.message) && /faint-warm/.test(e.message),
  );
});

test("borderWidth outlines marks in the brand's ink", () => {
  const sc = scaffold({ borderWidth: 3 });
  assert.match(sc.markStroke, /stroke="#232222"/);
  assert.match(sc.markStroke, /stroke-width="3"/);
});

test("a kit that declares no borderWidth gets no outline", () => {
  assert.equal(scaffold({}).markStroke, "");
  assert.equal(scaffold({ borderWidth: 0 }).markStroke, "");
});
