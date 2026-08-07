// The legibility gate. The `covered` case is the regression test for the OpenAI org
// chart that shipped with "Owns & controls" rendering as "owns & c": an edge label
// emitted BEFORE the node boxes, so the opaque boxes painted over both of its ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditHtml, renderHtmlToFile, LegibilityError } from "../render.mjs";
import { formatFindings } from "../legibility.mjs";

const SIZE = { width: 600, height: 400 };

const page = (inner, css = "") =>
  `<!doctype html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    #frame{width:${SIZE.width}px;height:${SIZE.height}px;position:relative;background:#FFFAF3;
           font-family:Helvetica,Arial,sans-serif;overflow:hidden}
    ${css}
  </style></head><body><div id="frame">${inner}</div></body></html>`;

// Run an audit, skipping the whole test when this environment has no browser.
async function audit(t, html, opts = {}) {
  try {
    return await auditHtml(html, SIZE, { scale: 1, ...opts });
  } catch (e) {
    if (/No Chromium/.test(e.message)) {
      t.skip("no Chromium available in this environment");
      return null;
    }
    throw e;
  }
}

const kinds = (findings) => findings.map((f) => f.kind);
const forText = (findings, text) => findings.filter((f) => f.text === text);

test("clean layout produces no findings", async (t) => {
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:40px;top:40px;font-size:28px;color:#232222">Board of directors</div>
          <div style="position:absolute;left:40px;top:200px;font-size:20px;color:#232222">Holding company</div>`),
  );
  if (!found) return;
  assert.deepEqual(found, [], `expected a clean page, got:\n${formatFindings(found)}`);
});

test("covered: an edge label painted over by node boxes drawn after it", async (t) => {
  // The org-chart bug, minimised. The label sits in a 60px gap between two boxes and
  // needs ~150px, and both boxes are emitted after it, so they paint over its ends.
  const svg = `<svg width="600" height="400" style="position:absolute;inset:0">
      <text x="300" y="200" text-anchor="middle" font-size="18" font-weight="700" fill="#232222">Owns &amp; controls</text>
      <rect x="20" y="150" width="250" height="100" rx="12" fill="#FFFFFF" stroke="#232222" stroke-width="3"/>
      <rect x="330" y="150" width="250" height="100" rx="12" fill="#FFFFFF" stroke="#232222" stroke-width="3"/>
    </svg>`;
  const found = await audit(t, page(svg));
  if (!found) return;

  const covered = found.filter((f) => f.kind === "covered");
  assert.equal(covered.length, 1, `expected exactly one covered label, got:\n${formatFindings(found)}`);
  assert.equal(covered[0].text, "Owns & controls");
  assert.match(covered[0].detail, /painted over by rect/);
});

test("covered: a knockout chip drawn BEFORE the label is not a false positive", async (t) => {
  // Same geometry, but the opaque rect precedes the text: that is a knockout behind the
  // label, which is exactly how the brand's callout() draws one. It must not be flagged.
  const svg = `<svg width="600" height="400" style="position:absolute;inset:0">
      <rect x="200" y="180" width="200" height="40" rx="6" fill="#FFFFFF"/>
      <text x="300" y="206" text-anchor="middle" font-size="18" font-weight="700" fill="#232222">Owns &amp; controls</text>
    </svg>`;
  const found = await audit(t, page(svg));
  if (!found) return;
  assert.deepEqual(kinds(found), [], `knockout behind text must pass, got:\n${formatFindings(found)}`);
});

test("clipped: text running past the frame edge", async (t) => {
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:480px;top:100px;width:400px;font-size:24px;color:#232222;white-space:nowrap">Minority owner</div>`),
  );
  if (!found) return;
  const clipped = found.filter((f) => f.kind === "clipped");
  assert.equal(clipped.length, 1, `expected a clipped finding, got:\n${formatFindings(found)}`);
  assert.match(clipped[0].detail, /past the right edge of #frame/);
});

test("overlap: two labels stacked on the same spot", async (t) => {
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:60px;top:100px;font-size:22px;color:#232222">Calendar</div>
          <div style="position:absolute;left:60px;top:104px;font-size:22px;color:#232222">CapCut</div>`),
  );
  if (!found) return;
  assert.ok(found.some((f) => f.kind === "overlap"), `expected an overlap finding, got:\n${formatFindings(found)}`);
});

test("tiny: text below the size floor", async (t) => {
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:40px;top:40px;font-size:7px;color:#232222">source: sensor tower</div>`),
  );
  if (!found) return;
  const tiny = forText(found, "source: sensor tower").filter((f) => f.kind === "tiny");
  assert.equal(tiny.length, 1, `expected a tiny finding, got:\n${formatFindings(found)}`);
  assert.match(tiny[0].detail, /7\.0px, floor is 11px/);
});

test("contrast: a label sunk into the bubble behind it", async (t) => {
  // "TRY & FORGET" set in muted grey on top of a periwinkle bubble, from the bubble chart.
  const svg = `<svg width="600" height="400" style="position:absolute;inset:0">
      <circle cx="200" cy="200" r="120" fill="#A9A7F5"/>
      <text x="200" y="206" text-anchor="middle" font-size="20" font-weight="700" fill="#8C8AC9">TRY &amp; FORGET</text>
    </svg>`;
  const found = await audit(t, page(svg));
  if (!found) return;
  const contrast = found.filter((f) => f.kind === "contrast");
  assert.equal(contrast.length, 1, `expected a contrast finding, got:\n${formatFindings(found)}`);
  assert.match(contrast[0].detail, /against its backdrop/);
});

test("contrast: white text on a translucent dark chip over a white page passes", async (t) => {
  // Regression: the backdrop walk used to let an opaque layer REPLACE the translucent
  // layers above it, so this chip was discarded and the text measured white-on-white
  // (1.00:1). The attribution pill is exactly this construction.
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:150px;top:180px;font-size:20px;color:#FFFFFF;
                      background:rgba(17,17,17,0.6);padding:6px 16px;border-radius:999px">Powered by Hourglass AI</div>`),
  );
  if (!found) return;
  assert.deepEqual(kinds(found), [], `translucent chip must count as the backdrop, got:\n${formatFindings(found)}`);
});

test("contrast: a chip too faint to help still fails", async (t) => {
  // The same shape at alpha 0.1 composites to near-white, so white text on it is
  // still unreadable: the fix must composite the chip, not just take its own colour.
  const found = await audit(
    t,
    page(`<div style="position:absolute;left:150px;top:180px;font-size:20px;color:#FFFFFF;
                      background:rgba(17,17,17,0.1);padding:6px 16px;border-radius:999px">barely there</div>`),
  );
  if (!found) return;
  const contrast = forText(found, "barely there").filter((f) => f.kind === "contrast");
  assert.equal(contrast.length, 1, `expected a contrast finding, got:\n${formatFindings(found)}`);
});

test("the gate can be switched off, and a failing render still writes its PNG", async (t) => {
  const svg = `<svg width="600" height="400" style="position:absolute;inset:0">
      <text x="300" y="200" text-anchor="middle" font-size="18" fill="#232222">Owns &amp; controls</text>
      <rect x="20" y="150" width="560" height="100" fill="#FFFFFF"/>
    </svg>`;
  const html = page(svg);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legibility-"));
  const out = path.join(dir, "r.png");

  try {
    await assert.rejects(
      () => renderHtmlToFile(html, SIZE, out, { scale: 1 }),
      (e) => {
        assert.ok(e instanceof LegibilityError, "throws a LegibilityError");
        assert.ok(e.findings.length >= 1, "carries structured findings");
        assert.equal(e.png, out, "names the PNG it wrote");
        return true;
      },
    );
  } catch (e) {
    if (/No Chromium/.test(e.message)) {
      t.skip("no Chromium available in this environment");
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    throw e;
  }

  assert.ok(fs.statSync(out).size > 1000, "the broken render is still on disk to look at");
  fs.rmSync(out);

  // audit: false renders the same page without complaint.
  await renderHtmlToFile(html, SIZE, out, { scale: 1, audit: false });
  assert.ok(fs.statSync(out).size > 1000, "--no-audit renders anyway");
  fs.rmSync(dir, { recursive: true, force: true });
});
