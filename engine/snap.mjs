// Screenshot a live web page -> PNG. Used by /create-brand to capture a brand's
// website as a visual reference for analysis; carries no look of its own.
//
//   node snap.mjs <url> <out.png> [--width 1440] [--height 2000] [--full]
//
// --full captures the whole page height instead of the viewport.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { resolveExecutable } from "./render.mjs";

const positional = [];
let width = 1440;
let height = 2000;
let fullPage = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--width") width = Number(argv[++i]);
  else if (argv[i] === "--height") height = Number(argv[++i]);
  else if (argv[i] === "--full") fullPage = true;
  else positional.push(argv[i]);
}
const [url, out] = positional;
if (!url || !out) {
  console.error("Usage: node snap.mjs <url> <out.png> [--width 1440] [--height 2000] [--full]");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(async (e) => {
    // Some sites never go network-idle (analytics, chat widgets); fall back to load.
    if (String(e).includes("Timeout")) await page.goto(url, { waitUntil: "load", timeout: 45000 });
    else throw e;
  });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out, type: "png", fullPage });
  console.log(out);
} finally {
  await browser.close();
}
