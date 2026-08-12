// HTML -> PNG / PDF via headless Chromium. Ported from infographic-studio-v3
// (itself lifted from v1) - same proven shell, no behaviour changes.

import { chromium } from "playwright-core";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

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

export async function renderHtmlToBuffer(html, size, { scale = 2 } = {}) {
  const executablePath = resolveExecutable();
  const browser = await chromium.launch({ executablePath, headless: true, args: launchArgs(executablePath) });
  try {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: scale,
    });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const el = (await page.$("#frame")) || (await page.$("body"));
    return await el.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

export async function renderHtmlToFile(html, size, outPath, opts) {
  const buf = await renderHtmlToBuffer(html, size, opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

export async function renderHtmlToPdf(html, size, outPath) {
  const executablePath = resolveExecutable();
  const browser = await chromium.launch({ executablePath, headless: true, args: launchArgs(executablePath) });
  try {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
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
    return outPath;
  } finally {
    await browser.close();
  }
}
