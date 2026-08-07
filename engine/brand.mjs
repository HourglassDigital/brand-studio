// Data-driven brand kit. Given a saved brand profile (brand.json, already overlaid
// with preferences) it produces the colours, fonts, logo and the HTML document
// wrapper that an asset is authored into. The engine carries NO look of its own:
// the palette, fonts and logo are the brand's; the structure of each asset is
// authored fresh (by Claude) as the `css` + `body` passed to htmlDoc().
import fs from "node:fs";
import path from "node:path";

// Generic role-mapped palette. brand-add maps a brand's real colours onto these
// slots; any slot left out falls back here. Slot NAMES are neutral on purpose so
// no single brand's identity is baked into the engine.
export const DEFAULT_COLORS = {
  bg:         "#FFFFFF", // page background
  surface:    "#F5F5F5", // cards / raised surfaces
  ink:        "#161616", // primary text + lines
  muted:      "#6B6B6B", // secondary text
  accent:     "#2B6BF3", // primary accent
  accentSoft: "#D8E4FF", // highlight / tint of the accent
  accent2:    "#111111", // secondary accent / emphasis
  line:       "#E6E6E6", // hairlines, grid
  white:      "#FFFFFF",
};

export const COLOR_ROLES = Object.keys(DEFAULT_COLORS);

const mime = (f) =>
  ({ ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[
    path.extname(f).toLowerCase()
  ] || "application/octet-stream");

const kebab = (k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

// Build a brand object bound to one (merged) profile. `assetsDir` is where uploaded
// logo/font files live (may be undefined for the generated-wordmark default).
export function makeBrand(profile = {}, { assetsDir } = {}) {
  const colors = { ...DEFAULT_COLORS, ...(profile.colors || {}) };
  const fonts = profile.fonts || {};
  const headlineFamily = fonts.headlineFamily || "Plus Jakarta Sans";
  const bodyFamily = fonts.bodyFamily || headlineFamily;
  const gridOn = profile.background?.grid === true; // grid is opt-in, off by default

  const readAsset = (file) => {
    if (!assetsDir || !file) return null;
    const p = path.join(assetsDir, file);
    return fs.existsSync(p) ? p : null;
  };
  const dataUri = (p) => `data:${mime(p)};base64,${fs.readFileSync(p).toString("base64")}`;

  // --- fonts: a Google family by name, plus any uploaded @font-face files ---
  function fontLink() {
    const links = [];
    if (fonts.googleFamily) {
      links.push(
        `<link rel="preconnect" href="https://fonts.googleapis.com">`,
        `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
        `<link href="https://fonts.googleapis.com/css2?family=${fonts.googleFamily}&display=swap" rel="stylesheet">`,
      );
    }
    const faces = (fonts.files || [])
      .map((f) => {
        const p = readAsset(f.file);
        if (!p) return "";
        return `@font-face{font-family:'${f.family || headlineFamily}';src:url('${dataUri(p)}');` +
          `font-weight:${f.weight || 400};font-style:${f.style || "normal"};font-display:swap;}`;
      })
      .join("");
    return links.join("\n") + (faces ? `<style>${faces}</style>` : "");
  }

  // --- optional faint grid background as inline SVG (opt-in via background.grid) ---
  function gridBackground(color = colors.line, size = 26) {
    if (!gridOn) return "none";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
      `<path d='M ${size} 0 L 0 0 0 ${size}' fill='none' stroke='${color}' stroke-width='1'/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }

  // --- logo: an uploaded asset if present, else a generated wordmark ---
  // brand.json `logo` fields:
  //   file    the default lockup (conventionally ink-on-light)
  //   light   an inverse lockup, for dark surfaces
  //   dark    an explicit ink lockup (defaults to `file`)
  //   icon    a mark-only variant, for tight corners
  //   height  rendered height in px
  // A variant that cannot be honoured FAILS LOUDLY. Silently returning the default
  // lockup where an inverse one was asked for renders an invisible logo (dark ink on
  // a dark surface), which is worse than not rendering at all.
  const logoCfg = profile.logo || {};
  const logoAsset = readAsset(logoCfg.file);
  const brandLabel = profile.name || profile.slug || "this brand";
  let monoSeq = 0;

  const isSvg = (p) => path.extname(p).toLowerCase() === ".svg";

  // Distinct fill colours an SVG actually paints. `none` and friends are excluded:
  // an open shape paints nothing, so it never merges with what sits under it.
  // Strokes are ignored on purpose. An outline flattened to one colour is still an
  // outline; it is stacked FILLS that merge into a silhouette.
  function distinctFills(svgSource) {
    const found = new Set();
    const add = (v) => {
      const c = String(v).trim().toLowerCase();
      if (!c || c === "none" || c === "transparent" || c === "currentcolor" || c === "inherit") return;
      if (c.startsWith("url(")) return; // a gradient/pattern reference, not a flat colour
      found.add(c);
    };
    for (const m of svgSource.matchAll(/fill\s*=\s*"([^"]*)"/g)) add(m[1]);
    for (const m of svgSource.matchAll(/fill\s*:\s*([^;"'}]+)/g)) add(m[1]);
    return found;
  }

  // Force an inline SVG to a single colour. Shapes explicitly set to `none` keep it,
  // so outlines stay outlines; everything else (including a multi-colour mark) is
  // flattened to `color`, which is what a mono variant means.
  function monoStyle(cls, color) {
    return `<style>` +
      `.${cls} svg *:not([fill="none"]){fill:${color}}` +
      `.${cls} svg [stroke]:not([stroke="none"]){stroke:${color}}` +
      `</style>`;
  }

  function assetMarkup(file, { h, color = null }) {
    if (isSvg(file)) {
      const raw = fs.readFileSync(file, "utf8").replace(/<\?xml.*?\?>/s, "");
      if (!color) return `<span class="bs-logo" style="--logo-h:${h}px">${raw}</span>`;
      const cls = `bs-logo-mono-${++monoSeq}`;
      return `${monoStyle(cls, color)}<span class="bs-logo ${cls}" style="--logo-h:${h}px">${raw}</span>`;
    }
    return `<span class="bs-logo"><img src="${dataUri(file)}" style="height:${h}px;width:auto" alt="logo"/></span>`;
  }

  function logo({ color, scale = 1, stacked = false, variant = "default" } = {}) {
    const h = (logoCfg.height || 30) * scale;
    const variantFile = { light: logoCfg.light, dark: logoCfg.dark, icon: logoCfg.icon }[variant];
    const variantAsset = readAsset(variantFile);

    // A dedicated asset for the variant IS the variant: use it as authored.
    if (variantAsset) return assetMarkup(variantAsset, { h });

    if (variant === "icon") {
      throw new Error(
        `${brandLabel} has no icon-only logo. {{logo-icon}} needs \`"logo": { "icon": "<file>" }\` in brand.json ` +
          `pointing at a mark-only file in the brand's assets/. Use {{logo}} for the full lockup instead.`,
      );
    }

    if (logoAsset) {
      // No variant asset. An SVG can be flattened to the requested colour; a raster cannot.
      if (variant === "dark" || variant === "default") return assetMarkup(logoAsset, { h });
      if (isSvg(logoAsset)) {
        // Flattening only survives a mark whose shapes do not stack. Two or more fill
        // colours means one filled shape sits on another (a field with knocked-out
        // letters, a ring around a body), and painting them the same colour welds them
        // into a silhouette: the render still succeeds, so nothing catches it.
        const fills = distinctFills(fs.readFileSync(logoAsset, "utf8"));
        if (fills.size > 1) {
          throw new Error(
            `${brandLabel}'s logo (${logoCfg.file}) paints ${fills.size} fill colours, so flattening it for ` +
              `{{logo-${variant}}} would merge its shapes into a solid silhouette. ` +
              `Add a purpose-made inverse file to the brand's assets/ and set ` +
              `\`"logo": { "${variant}": "<file>" }\` in brand.json, or use {{logo}} if the full-colour ` +
              `lockup already reads on this background.`,
          );
        }
        return assetMarkup(logoAsset, { h, color: color || colors.white });
      }
      throw new Error(
        `${brandLabel} has no ${variant} logo variant. {{logo-${variant}}} was requested but ` +
          `logo.${variant} is unset and logo.file (${logoCfg.file}) is a raster image, which cannot be recoloured. ` +
          `Add an inverse file to the brand's assets/ and set \`"logo": { "${variant}": "<file>" }\` in brand.json.`,
      );
    }

    // No uploaded logo: a clean wordmark from the brand name (or logo.text).
    const text = logoCfg.text || profile.name || "";
    const word = String(text).replace(/\s+/, "<br>");
    const wordColor = color || (variant === "light" ? colors.white : colors.ink);
    return `<span class="bs-logo ${stacked ? "bs-logo--stacked" : ""}" style="--logo-color:${wordColor}">` +
      `<span class="bs-logo__word">${word}</span></span>`;
  }

  // The document wrapper. Injects the brand fonts, the palette as CSS custom
  // properties (--bg, --ink, --accent, --accent-soft, ...), generic logo plumbing
  // and the frame. The asset's own look is the `css` + `body` authored per asset.
  function baseCss() {
    const vars = Object.entries(colors).map(([k, v]) => `--${kebab(k)}:${v};`).join("");
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { ${vars} }
    html, body {
      font-family: '${bodyFamily}', system-ui, sans-serif;
      color: var(--ink); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    }
    .frame {
      position: relative; background-color: var(--bg);
      background-image: ${gridBackground()}; overflow: hidden;
    }
    h1, h2, h3 { font-family: '${headlineFamily}', system-ui, sans-serif; }
    /* Reset the default highlighter so an un-styled ==mark== never renders yellow.
       An asset opts in by styling mark in its own css. */
    mark { background: transparent; color: inherit; padding: 0; }
    /* Generic logo plumbing for the logo() helper / {{logo}} placeholder. */
    .bs-logo { display: inline-flex; align-items: center; gap: 10px; }
    .bs-logo svg { height: var(--logo-h, auto); width: auto; }
    .bs-logo__word {
      font-family: '${headlineFamily}', system-ui, sans-serif;
      font-weight: 700; line-height: 0.98; letter-spacing: -0.01em;
      color: var(--logo-color); font-size: 20px;
    }
    .bs-logo--stacked .bs-logo__word { font-size: 18px; }
    /* Engine-added attribution, pinned to the bottom of every render. Hourglass's own
       branding, NOT the client brand's: system font stack and inline SVG so it is
       self-contained. Deep-teal text on a light frosted chip, with a soft teal aura
       (box-shadow on the chip, text-shadow on the text: neither affects the gate's
       backdrop maths). The chip is 85% white ON PURPOSE: sheerer glass over a dark
       brand page composites to mid-grey, where no green text survives; at 0.85 the
       backdrop stays light everywhere, so the deep teal clears the gate's 3.0:1 floor
       over white AND near-black pages (5.1:1 and 3.9:1). Painted last, so authored
       content straying under it is caught by the legibility gate. */
    .bs-attribution {
      position: absolute; left: 50%; transform: translateX(-50%);
      bottom: calc(var(--safe, 24px) * 0.4);
      display: inline-flex; align-items: center; gap: 8px;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 20px; letter-spacing: 0.01em; white-space: nowrap;
      color: rgba(4, 115, 90, 0.95);
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(16, 163, 127, 0.35);
      box-shadow: 0 0 30px rgba(16, 163, 127, 0.35);
      text-shadow: 0 0 12px rgba(16, 163, 127, 0.35);
      padding: 7px 18px 7px 13px; border-radius: 999px; z-index: 2147483647;
    }
    .bs-attribution svg { width: 17px; height: 17px; display: block; filter: drop-shadow(0 0 6px rgba(16, 163, 127, 0.5)); }
    .bs-attribution__by { font-weight: 450; }
    .bs-attribution__brand { font-weight: 700; letter-spacing: -0.01em; }
    `;
  }

  // The attribution footer every render carries: Hourglass AI's mark and name, one
  // place to change. The glyph is a line-drawn hourglass; currentColor keeps it in
  // step with the text tone above.
  const ATTRIBUTION =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M6 3h12M6 21h12M7.5 3c0 4.2 4.5 5 4.5 9s-4.5 4.8-4.5 9M16.5 3c0 4.2-4.5 5-4.5 9s4.5 4.8 4.5 9"/></svg>` +
    `<span class="bs-attribution__by">Powered by</span><span class="bs-attribution__brand">Hourglass AI</span>`;

  function htmlDoc({ width, height, css, body }) {
    return `<!doctype html><html><head><meta charset="utf-8">${fontLink()}
    <style>${baseCss()}${css || ""}
      .frame { width: ${width}px; height: ${height}px; }
    </style></head>
    <body><div class="frame" id="frame">${body}<div class="bs-attribution">${ATTRIBUTION}</div></div></body></html>`;
  }

  return {
    profile, colors, fonts: { headlineFamily, bodyFamily },
    meta: {
      name: profile.name || profile.slug || "",
      handle: profile.handle || "",
      cta: profile.cta || "",
      voice: profile.voice || "",
      about: profile.about || "",
      audience: profile.audience || "",
      categories: profile.categories || [],
      houseStyle: profile.houseStyle || {},
    },
    fontLink, gridBackground, logo, baseCss, htmlDoc,
  };
}
