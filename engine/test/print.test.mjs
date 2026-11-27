// Print shapes: the business card's geometry, the print document (no attribution pill,
// one page per side), and the print PDF a printer actually receives: exact physical page
// size, trim/bleed boxes, embedded fonts, CMYK, art to every edge, and the {{qr}} path.
// The PDF tests need Chromium, Ghostscript and poppler's pdfinfo/pdffonts; they skip
// without them, and the floor gate fails on any skip, so CI must have all three.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { resolveShape, listShapes, PRINT_MIN_FONT_PX } from "../shapes.mjs";
import { makeBrand } from "../brand.mjs";
import { resolveExecutable, resolveGhostscript } from "../render.mjs";

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PT = 72 / 25.4;

const have = (fn) => { try { fn(); return true; } catch { return false; } };
const hasTool = (bin) => spawnSync(bin, ["-v"], { stdio: "ignore" }).error === undefined;
const toolchain = () =>
  have(resolveExecutable) && have(resolveGhostscript) && hasTool("pdfinfo") && hasTool("pdffonts");

test("print shape: business card is 90 x 55 trim with 3 mm bleed and a 4 mm safe zone", () => {
  const s = resolveShape("business-card");
  assert.equal(s.print, true);
  assert.deepEqual(s.trim, { width: 90, height: 55 });
  assert.equal(s.bleed, 3);
  assert.deepEqual(s.mm, { width: 96, height: 61 });
  assert.deepEqual(s.pages, ["front", "back"]);
  // safeArea is measured from the canvas edge: bleed + safe, in CSS px.
  assert.equal(s.safeArea, Math.round(7 * (96 / 25.4)));
  assert.ok(listShapes().some((x) => x.name === "business-card"));
  assert.ok(PRINT_MIN_FONT_PX > 7.9 && PRINT_MIN_FONT_PX < 8.1, "print floor is 6 pt (8 CSS px)");
});

test("print shape: --bleed overrides (Officeworks 5 mm), bad bleeds and screen shapes refuse it", () => {
  assert.deepEqual(resolveShape("business-card", { bleed: 5 }).mm, { width: 100, height: 65 });
  assert.deepEqual(resolveShape("business-card", { bleed: "0" }).mm, { width: 90, height: 55 });
  assert.throws(() => resolveShape("business-card", { bleed: "five" }), /Bleed must be a number/);
  assert.throws(() => resolveShape("business-card", { bleed: 25 }), /between 0 and 10/);
  assert.throws(() => resolveShape("ig-square", { bleed: 3 }), /only applies to print shapes/);
});

test("print document: one frame per side, physical @page size, and no attribution pill", () => {
  const brand = makeBrand({ name: "Acme" });
  const shape = resolveShape("business-card", { bleed: 5 });
  const html = brand.htmlDoc({ width: shape.width, height: shape.height, css: "", body: ["<p>front</p>", "<p>back</p>"], print: shape.mm });
  assert.equal((html.match(/class="frame"/g) || []).length, 2);
  assert.match(html, /@page \{ size: 100mm 65mm; margin: 0; \}/);
  assert.doesNotMatch(html, /<div class="bs-attribution">/, "a physical card must not carry the pill");
  // The screen path keeps its pill, and refuses a multi-page body.
  const screen = brand.htmlDoc({ width: 1080, height: 1080, css: "", body: "<p>x</p>" });
  assert.match(screen, /<div class="bs-attribution">/);
  assert.throws(() => brand.htmlDoc({ width: 1080, height: 1080, css: "", body: ["a", "b"] }), /print shapes only/);
});

// --- CLI end to end ------------------------------------------------------------------

function tempBrand() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-studio-print-"));
  const b = path.join(dir, "brands", "acme");
  fs.mkdirSync(path.join(b, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(b, "brand.json"),
    JSON.stringify({ slug: "acme", name: "Acme", colors: { bg: "#FFFFFF", ink: "#111614", accent: "#0B6E5B", white: "#FFFFFF" } }),
  );
  return dir;
}

const CARD = {
  qr: { text: "BEGIN:VCARD\nVERSION:3.0\nFN:Test Person\nEND:VCARD", dark: "#111614", light: "#FFFFFF" },
  css:
    ".c{position:absolute;inset:0} .front{background:var(--white)} .back{background:var(--accent);color:var(--white)}" +
    " .s{position:absolute;inset:var(--trim-safe);font-size:9pt} .q{position:absolute;right:0;bottom:0;width:14mm;height:14mm}" +
    " .q svg{display:block;width:100%;height:100%}",
  pages: {
    front: '<div class="c front"><div class="s">Test Person<br>test@example.com</div></div>',
    back: '<div class="c back"><div class="s">Back side<div class="q">{{qr}}</div></div></div>',
  },
};

function runCli(dataDir, card, extra = []) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-studio-card-"));
  const dataFile = path.join(work, "card.json");
  fs.writeFileSync(dataFile, JSON.stringify(card));
  const out = path.join(work, "card.pdf");
  const r = spawnSync(process.execPath, ["cli.mjs", "--brand", "acme", "--shape", "business-card", "--data", dataFile, "--out", out, ...extra], {
    cwd: ENGINE, env: { ...process.env, BRAND_STUDIO_DATA: dataDir }, encoding: "utf8",
  });
  return { ...r, out, work };
}

// Rasterise one PDF page with Ghostscript to raw PPM and return a pixel reader.
function rasterise(pdf, pageNo, dpi = 150) {
  const ppm = execFileSync(resolveGhostscript(), [
    "-q", "-dBATCH", "-dNOPAUSE", "-dSAFER", "-sDEVICE=ppmraw", `-r${dpi}`,
    `-dFirstPage=${pageNo}`, `-dLastPage=${pageNo}`, "-sOutputFile=-", pdf,
  ]);
  // P6 header, with the comment line Ghostscript adds: "P6\n# Image generated by ...\nW H\n255\n".
  const header = ppm.toString("latin1", 0, 200).match(/^P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s/);
  const [w, h] = [Number(header[1]), Number(header[2])];
  const off = header[0].length;
  return { w, h, px: (x, y) => [...ppm.subarray(off + (y * w + x) * 3, off + (y * w + x) * 3 + 3)] };
}

// Colour operators actually used in the page content: inflate every Flate stream and
// count RGB fill/stroke (rg/RG) against CMYK (k/K) operators.
function colourOps(pdf) {
  const raw = fs.readFileSync(pdf);
  const text = raw.toString("latin1");
  let rgb = 0, cmyk = 0;
  for (const m of text.matchAll(/\/FlateDecode[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    let body;
    try { body = zlib.inflateSync(raw.subarray(start, end)).toString("latin1"); } catch { continue; }
    rgb += (body.match(/(?:^|\s)(?:[\d.]+\s+){3}(?:rg|RG)(?=\s)/g) || []).length;
    cmyk += (body.match(/(?:^|\s)(?:[\d.]+\s+){4}(?:k|K)(?=\s)/g) || []).length;
  }
  return { rgb, cmyk };
}

const boxes = (pdf) => execFileSync("pdfinfo", ["-box", "-f", "1", "-l", "2", pdf], { encoding: "utf8" });
const box = (info, page, name) => {
  const m = info.match(new RegExp(`Page\\s+${page} ${name}:\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`));
  return m.slice(1).map(Number);
};

test("print PDF: exact 100 x 65 mm pages, trim box 5 mm in, fonts embedded, CMYK, teal to every edge (skips without the toolchain)", async (t) => {
  if (!toolchain()) return t.skip("needs Chromium, Ghostscript, pdfinfo and pdffonts");
  const dataDir = tempBrand();
  const r = runCli(dataDir, CARD, ["--bleed", "5", "--cmyk"]);
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(res.pages, ["front", "back"]);
  assert.equal(res.png.length, 2);
  for (const png of res.png) assert.ok(fs.statSync(png).size > 1000, `${png} preview written`);

  const info = boxes(r.out);
  assert.match(execFileSync("pdfinfo", [r.out], { encoding: "utf8" }), /Pages:\s+2/);
  const near = (a, b) => Math.abs(a - b) < 0.05;
  for (const page of [1, 2]) {
    const media = box(info, page, "MediaBox");
    assert.ok(near(media[2], 100 * PT) && near(media[3], 65 * PT), `page ${page} is 100 x 65 mm, got ${media}`);
    const trim = box(info, page, "TrimBox");
    assert.ok(near(trim[0], 5 * PT) && near(trim[2], 95 * PT) && near(trim[3], 60 * PT), `page ${page} trim box 5 mm in, got ${trim}`);
  }
  // Every font is embedded (pdffonts "emb" column).
  const fonts = execFileSync("pdffonts", [r.out], { encoding: "utf8" }).trim().split("\n").slice(2);
  assert.ok(fonts.length > 0, "the text is real text, so fonts are present");
  for (const line of fonts) assert.match(line, /\byes\b/, `font not embedded: ${line}`);
  // CMYK: every colour the pages paint is a CMYK operator. The control proves the
  // check can fail: the same card without --cmyk paints with RGB operators.
  const ops = colourOps(r.out);
  assert.equal(ops.rgb, 0, `CMYK file still paints ${ops.rgb} RGB colours`);
  assert.ok(ops.cmyk > 0, "CMYK file paints with CMYK operators");
  const rgb = runCli(dataDir, CARD, ["--bleed", "5"]);
  assert.equal(rgb.status, 0, rgb.stderr);
  assert.ok(colourOps(rgb.out).rgb > 0, "control: the RGB render paints RGB colours");

  // The teal back reaches all four edges of the page: no white sliver left by the
  // Chromium page-size rounding.
  const back = rasterise(r.out, 2);
  const centre = back.px(Math.floor(back.w / 2), Math.floor(back.h / 2));
  const isTeal = ([r2, g, b]) => g > r2 + 30 && g < 200 && b < 200;
  assert.ok(isTeal(centre), `back centre is teal, got ${centre}`);
  for (const [x, y] of [[0, 0], [back.w - 1, 0], [0, back.h - 1], [back.w - 1, back.h - 1], [Math.floor(back.w / 2), 0], [0, Math.floor(back.h / 2)]]) {
    assert.ok(isTeal(back.px(x, y)), `edge pixel (${x},${y}) is teal, got ${back.px(x, y)}`);
  }
  // The {{qr}} placeholder drew a dark-module QR on the back (not left as literal text).
  assert.doesNotMatch(execFileSync("pdftotext", [r.out, "-"], { encoding: "utf8" }), /\{\{qr\}\}/);
});

test("print CLI: an unknown side or a {{qr}} without data.qr fails loudly (skips without Chromium)", async (t) => {
  if (!have(resolveExecutable)) return t.skip("needs Chromium");
  const dataDir = tempBrand();
  const typo = runCli(dataDir, { ...CARD, pages: { ...CARD.pages, rear: "<p>x</p>" } });
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /Unknown page\(s\) rear/);
  const noQr = runCli(dataDir, { ...CARD, qr: undefined });
  assert.notEqual(noQr.status, 0);
  assert.match(noQr.stderr, /\{\{qr\}\} needs a/);
  const noPages = runCli(dataDir, { css: "", body: "<p>x</p>" });
  assert.notEqual(noPages.status, 0);
  assert.match(noPages.stderr, /needs \\"pages\\"/);
});
