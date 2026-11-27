// Render engine: a raw HTML document -> PNG (and optionally PDF), via headless
// Chromium (Playwright). Brand- and layout-agnostic; the CLI feeds it HTML.
import { chromium } from "playwright-core";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { auditInPage, formatFindings, DEFAULTS } from "./legibility.mjs";

export class LegibilityError extends Error {
  constructor(findings, pngPath) {
    super(
      `Legibility gate failed: ${findings.length} issue${findings.length === 1 ? "" : "s"} in the render.\n` +
        formatFindings(findings) +
        `\n\nThe render was still written to ${pngPath} so you can see it. Fix the layout and render again, ` +
        `or pass --no-audit if this is deliberate.`,
    );
    this.name = "LegibilityError";
    this.findings = findings;
    this.png = pngPath;
  }
}

// Find a usable Chromium/Chrome binary without forcing a download.
export function resolveExecutable() {
  if (process.env.PW_CHROME && fs.existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const caches = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"), // macOS
    path.join(os.homedir(), ".cache/ms-playwright"), // linux
    path.join(os.homedir(), "AppData/Local/ms-playwright"), // windows
  ];
  const headlessCandidates = [];
  const appCandidates = [];
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const dir of fs.readdirSync(cache).sort()) {
      headlessCandidates.push(
        path.join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-headless-shell-linux64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-headless-shell-win64/chrome-headless-shell.exe"),
        path.join(cache, dir, "chrome-mac/headless_shell"),
      );
      appCandidates.push(
        path.join(cache, dir, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        path.join(cache, dir, "chrome-linux/chrome"),
        path.join(cache, dir, "chrome-win/chrome.exe"),
      );
    }
  }
  const candidates = [
    ...headlessCandidates,
    ...appCandidates,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "No Chromium/Chrome found. Run `npx playwright install chromium`, or set PW_CHROME=/path/to/chrome.",
    );
  }
  return found;
}

// macOS headless shell refuses to fork under seatbelt-sandboxed shells (the
// default for Claude Code sessions, where this plugin's renders actually run);
// --single-process keeps first-run renders working there. Full Chrome/Chromium
// launches its own way and never gets the flag.
function launchArgs(executablePath) {
  if (process.platform === "darwin" && /headless[_-]shell/.test(executablePath)) return ["--single-process"];
  return [];
}

async function withPage(size, fn, { scale } = {}) {
  const executablePath = resolveExecutable();
  const browser = await chromium.launch({ executablePath, headless: true, args: launchArgs(executablePath) });
  try {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: scale || 1,
    });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// Measure the live page for unreadable text. Exported so it can be run on its own
// (tests, a lint pass) without producing a PNG.
export async function auditHtml(html, size, { scale = 2, ...opts } = {}) {
  return withPage(
    size,
    async (page) => {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const frameSelector = (await page.$("#frame")) ? "#frame" : "body";
      return page.evaluate(auditInPage, { ...DEFAULTS, ...opts, frameSelector });
    },
    { scale },
  );
}

// `inset` (CSS px) crops that much off every edge of the screenshot: a print preview
// crops the bleed away so the PNG shows the card as it will be cut.
// `media: "print"` lays the page out with print CSS, so a print preview (and its
// legibility audit) measures the same layout the print PDF will carry.
export async function renderHtmlToFile(html, size, outPath, { scale = 2, audit = true, auditOptions = {}, inset = 0, media = null } = {}) {
  const { buf, findings } = await withPage(
    size,
    async (page) => {
      if (media) await page.emulateMedia({ media });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const frameSelector = (await page.$("#frame")) ? "#frame" : "body";
      // Measure BEFORE the screenshot, on the same loaded page: same layout, no second render.
      const found = audit
        ? await page.evaluate(auditInPage, { ...DEFAULTS, ...auditOptions, frameSelector, inset })
        : [];
      const el = (await page.$(frameSelector)) || (await page.$("body"));
      if (!inset) return { buf: await el.screenshot({ type: "png" }), findings: found };
      const box = await el.boundingBox();
      const clip = { x: box.x + inset, y: box.y + inset, width: box.width - 2 * inset, height: box.height - 2 * inset };
      return { buf: await page.screenshot({ type: "png", clip }), findings: found };
    },
    { scale },
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  // Write first, then fail: seeing the broken render is how you fix it.
  if (findings.length) throw new LegibilityError(findings, outPath);
  return outPath;
}

// Same layout as a single-page PDF with a REAL, selectable text layer — the
// handoff for editing in Canva/Illustrator (text stays text, not pixels).
export async function renderHtmlToPdf(html, size, outPath) {
  await withPage(size, async (page) => {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.pdf({
      path: outPath,
      width: `${size.width}px`,
      height: `${size.height}px`,
      printBackground: true,
      pageRanges: "1",
    });
  });
  return outPath;
}

// A print-ready PDF at the piece's physical size (bleed included), one page per side,
// text kept as real vector text with its fonts embedded.
//
// Chromium rounds PDF page sizes (a 100 x 65 mm request comes back about 0.3 mm off,
// with the art sitting at the bottom-left of a slightly larger page), so every print
// PDF goes through Ghostscript: pdfwrite fixes the page at the exact size from the
// bottom-left origin, which is exactly where the art already sits, and stamps
// TrimBox/BleedBox on every page so a printer's RIP knows where the cut is. With
// `cmyk` the same pass converts to DeviceCMYK (text and vectors stay as they are).
// No Ghostscript is a loud error, never a silently wrong-size file.
export async function renderPrintPdf(html, shape, outPath, { cmyk = false } = {}) {
  if (!shape.print) throw new Error(`renderPrintPdf needs a print shape; "${shape.name}" is a screen shape.`);
  const gs = resolveGhostscript();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const rawPath = outPath.replace(/\.pdf$/i, "") + ".chromium.pdf";
  await withPage(shape, async (page) => {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: rawPath, width: `${shape.mm.width}mm`, height: `${shape.mm.height}mm`, printBackground: true });
  });
  try {
    const PT = 72 / 25.4;
    const f = (n) => n.toFixed(3);
    const w = shape.mm.width * PT;
    const h = shape.mm.height * PT;
    const b = shape.bleed * PT;
    // EndPage runs once per page (reason 0 or 1 = a real page), so the boxes land on every side.
    const boxes =
      `<</EndPage {exch pop 2 lt {[/TrimBox [${f(b)} ${f(b)} ${f(w - b)} ${f(h - b)}] ` +
      `/BleedBox [0 0 ${f(w)} ${f(h)}] /PAGE pdfmark true} {false} ifelse}>> setpagedevice`;
    execFileSync(gs, [
      "-dBATCH", "-dNOPAUSE", "-dQUIET", "-dSAFER",
      "-sDEVICE=pdfwrite", "-dPDFSETTINGS=/prepress", "-dEmbedAllFonts=true", "-dSubsetFonts=true",
      "-dFIXEDMEDIA", `-dDEVICEWIDTHPOINTS=${f(w)}`, `-dDEVICEHEIGHTPOINTS=${f(h)}`,
      ...(cmyk ? ["-sColorConversionStrategy=CMYK", "-sProcessColorModel=DeviceCMYK"] : []),
      `-sOutputFile=${outPath}`,
      "-c", boxes,
      "-f", rawPath,
    ]);
  } finally {
    fs.rmSync(rawPath, { force: true });
  }
  return outPath;
}

export function resolveGhostscript() {
  const candidates = [process.env.BRAND_STUDIO_GS, "/opt/homebrew/bin/gs", "/usr/local/bin/gs", "/usr/bin/gs"];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error(
      "Print PDFs need Ghostscript (exact page size, trim box, CMYK). Install it (macOS: `brew install ghostscript`; Debian/Ubuntu: " +
        "`sudo apt-get install ghostscript`) or set BRAND_STUDIO_GS to its path.",
    );
  }
  return found;
}
