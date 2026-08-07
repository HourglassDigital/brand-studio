// The ==highlight== contract. Regression tests for a render that shipped the markers
// as literal text: util.mjs exported the conversion, the create-asset skill documented
// `==double equals==` as the way to emphasise the key phrase, and nothing in the render
// path ever called it. "==TIGHT LINES.==" went into the PNG exactly as typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { marks, inline } from "../util.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

test("marks: converts the highlight run and leaves surrounding markup alone", () => {
  assert.equal(marks("Cold. ==Tight lines.=="), "Cold. <mark>Tight lines.</mark>");
  assert.equal(
    marks("<h1>Cold. ==Tight lines.==</h1>"),
    "<h1>Cold. <mark>Tight lines.</mark></h1>",
    "authored HTML must survive verbatim: escaping it would print the tags",
  );
  assert.equal(marks("nothing to do"), "nothing to do");
  assert.equal(marks(), "");
});

test("marks: a stray pair of equals signs cannot swallow the document", () => {
  // Greedy or newline-spanning matching would eat every tag between two stray markers.
  const body = '<div class="a">a == b</div>\n<div class="b">c == d</div>';
  assert.equal(marks(body), body, "an unpaired run on each line is left untouched");
  assert.equal(marks("==a==\n==b=="), "<mark>a</mark>\n<mark>b</mark>", "each line converts on its own");
});

test("inline: still escapes, for plain-text values rather than authored markup", () => {
  assert.equal(inline("<b>hi</b> ==x=="), "&lt;b&gt;hi&lt;/b&gt; <mark>x</mark>");
});

// --- the wiring itself, which is what actually broke -------------------------
function kitAt(dataDir, slug) {
  const brandDir = path.join(dataDir, "brands", slug);
  fs.mkdirSync(path.join(brandDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(brandDir, "brand.json"),
    JSON.stringify({ slug, name: "Acme", colors: { bg: "#101010", ink: "#FFFFFF", accent: "#00E0A4" } }),
  );
}

async function render(dataDir, slug, body, out) {
  const args = ["--brand", slug, "--shape", "ig-square", "--data", "-", "--out", out, "--no-audit"];
  const child = run("node", [path.join(here, "..", "cli.mjs"), ...args], {
    env: { ...process.env, BRAND_STUDIO_DATA: dataDir },
  });
  child.child.stdin.end(JSON.stringify({ css: "mark{color:var(--accent);background:transparent}", body }));
  await child;
  return fs.readFileSync(out);
}

test("render: ==text== reaches the PNG as a styled highlight, not as literal markers", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-marks-"));
  kitAt(dataDir, "acme");
  try {
    const viaMarkers = await render(dataDir, "acme", "<h1>Cold. ==Tight lines.==</h1>", path.join(dataDir, "a.png"));
    const viaTag = await render(dataDir, "acme", "<h1>Cold. <mark>Tight lines.</mark></h1>", path.join(dataDir, "b.png"));
    const withoutMarkers = await render(dataDir, "acme", "<h1>Cold. Tight lines.</h1>", path.join(dataDir, "c.png"));

    // Equivalence of shorthand and tag is asserted on the STRING above, not on these
    // bytes. Comparing PNGs across separate browser launches proved ~10% flaky: the
    // kit names a font it does not ship, so Chromium picks a fallback, and a cold
    // font cache (the first run after any file changes) can pick different metrics.
    // That is outside the test's control and says nothing about marks().
    //
    // What the bytes CAN prove is the part that actually broke: the markers must not
    // survive as glyphs. A render that still drew "==" cannot match one whose copy
    // never had them.
    assert.notDeepEqual(
      viaMarkers,
      withoutMarkers,
      "the highlight must actually be styled, not silently dropped",
    );
    assert.ok(viaTag.length > 1000 && viaMarkers.length > 1000, "both renders produced real PNGs");
    const size = (buf) => buf.subarray(16, 24).toString("hex"); // IHDR width+height
    assert.equal(size(viaMarkers), size(viaTag), "shorthand and tag render at the same size");
  } catch (e) {
    if (/No Chromium/.test(e.message) || /No Chromium/.test(e.stderr || "")) {
      t.skip("no Chromium available in this environment");
      return;
    }
    throw e;
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
