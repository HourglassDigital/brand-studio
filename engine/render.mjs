// Render engine: a raw HTML document -> PNG (and optionally PDF), via headless
// Chromium (Playwright). Brand- and layout-agnostic; the CLI feeds it HTML.
import { chromium } from "playwright-core";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
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
function resolveExecutable() {
  if (process.env.PW_CHROME && fs.existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const caches = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"), // macOS
    path.join(os.homedir(), ".cache/ms-playwright"), // linux
  ];
  const candidates = [];
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const dir of fs.readdirSync(cache)) {
      candidates.push(
        path.join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-headless-shell-linux64/chrome-headless-shell"),
        path.join(cache, dir, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        path.join(cache, dir, "chrome-linux/chrome"),
      );
    }
  }
  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  );
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "No Chromium/Chrome found. Run `npx playwright install chromium`, or set PW_CHROME=/path/to/chrome.",
    );
  }
  return found;
}

async function withPage(size, fn, { scale } = {}) {
  const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true });
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

export async function renderHtmlToFile(html, size, outPath, { scale = 2, audit = true, auditOptions = {} } = {}) {
  const { buf, findings } = await withPage(
    size,
    async (page) => {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const frameSelector = (await page.$("#frame")) ? "#frame" : "body";
      // Measure BEFORE the screenshot, on the same loaded page: same layout, no second render.
      const found = audit
        ? await page.evaluate(auditInPage, { ...DEFAULTS, ...auditOptions, frameSelector })
        : [];
      const el = (await page.$(frameSelector)) || (await page.$("body"));
      return { buf: await el.screenshot({ type: "png" }), findings: found };
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
