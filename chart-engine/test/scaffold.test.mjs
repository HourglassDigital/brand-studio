// chartScaffold footer chrome: the brand-mark watermark lockup (bottom-left)
// and its interaction with a kit's icon-only logo. The mark is opt-in via
// spec.watermark; the icon joins it only when the kit declares logo.icon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chartScaffold } from "../render/charts/util.mjs";

const SIZE = { width: 1600, height: 1100 };

const baseBrand = () => ({
  palette: { bg: "#fff", ink: "#111", muted: "#777", line: "#eee", primary: "#1F6FEB" },
  fonts: {
    headline: { family: "system-ui", files: [] },
    body: { family: "system-ui", files: [] },
  },
  chart: {},
});

const spec = (extra = {}) => ({ type: "bar", title: "T", ...extra });

test("no watermark in the spec means no brand mark in the footer", () => {
  const s = chartScaffold({ brand: baseBrand(), spec: spec(), size: SIZE });
  assert.ok(!s.footerSvg.includes("Acme"), "footer should carry no mark text");
});

test("spec.watermark renders as bottom-left text, at the left pad when the kit has no icon", () => {
  const s = chartScaffold({ brand: baseBrand(), spec: spec({ watermark: "Acme Studio" }), size: SIZE });
  assert.match(s.footerSvg, /Acme Studio/);
  assert.match(s.footerSvg, new RegExp(`<text x="${s.PAD_X}"`), "text starts at PAD_X without an icon");
});

test("a kit-declared logo.icon is inlined before the mark text, which shifts right", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bs-scaffold-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(
    path.join(dir, "assets", "icon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`,
  );
  const brand = { ...baseBrand(), logo: { icon: "icon.svg" }, _meta: { slug: "test-brand", dir } };
  const s = chartScaffold({ brand, spec: spec({ watermark: "Acme Studio" }), size: SIZE });
  assert.match(s.footerSvg, /<g transform="translate\(/, "icon group is inlined");
  assert.match(s.footerSvg, /circle/, "icon SVG content survives inlining");
  const textX = Number(s.footerSvg.match(/<text x="([\d.]+)"[^>]*\n?[^>]*>Acme Studio/)?.[1] ?? s.footerSvg.match(/<text x="([\d.]+)"/)?.[1]);
  assert.ok(textX > s.PAD_X, `mark text (x=${textX}) sits right of the icon (PAD_X=${s.PAD_X})`);
});

test("a declared-but-missing logo.icon fails loudly, same policy as fonts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bs-scaffold-"));
  fs.mkdirSync(path.join(dir, "assets"));
  const brand = { ...baseBrand(), logo: { icon: "ghost.svg" }, _meta: { slug: "test-brand", dir } };
  assert.throws(
    () => chartScaffold({ brand, spec: spec({ watermark: "Acme Studio" }), size: SIZE }),
    /logo icon missing/,
  );
});
