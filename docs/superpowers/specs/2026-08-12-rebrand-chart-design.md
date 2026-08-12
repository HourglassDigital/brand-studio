# Rebrand-chart: port the chart engine into brand-studio

Date: 2026-08-12. Status: approved design, implementation in progress on `feat/rebrand-chart`.

## Goal

Any brand saved by `/create-brand` can have a source chart image re-skinned into its
branding: same data, deterministic SVG render, exact PNG. The chart engine that today
lives in the Tom Alder repo (`~/Hourglass-AI/strategy-breakdown-render/render-engine/`)
becomes a generalised, multi-brand part of brand-studio.

**This plugin is distributed.** Nothing Strategy Breakdowns / Tom Alder specific may land
in this repo: no brand slugs, no font family names (New Order, Avenir Next), no font
binaries, no client images, no learned conventions from that repo. Synthetic fixtures only.

## Source of the port

`~/Hourglass-AI/strategy-breakdown-render/render-engine/` (read-only source; that repo is
NOT modified). Its `package.json` is already named `brand-studio-render-engine`. Its
`brand-adapter.mjs` already maps brand-studio's `brand.json` shape (colors{} + flat fonts +
houseStyle) onto the chart engine's shape (palette{} + role-nested fonts + chart{}). Its
tests use a synthetic fontless kit (`test/kits/derivation.brand.json`, `test/brands/_template`).

## Destination layout

```
chart-engine/            ported renderer, own package.json (deps: d3-array, d3-scale,
  spec.mjs               d3-shape, d3-time, d3-time-format, playwright-core;
  brand-adapter.mjs      dev: pixelmatch, pngjs)
  brand-loader.mjs       TRIMMED: single-root (see below)
  doctor.mjs
  rubric.mjs
  cli.mjs                commands unchanged: render | validate | doctor | brands
  render/                index, brand-css, palette, playwright, charts/{area,bar,pie,
                         annotate,source,typography,util}
  test/                  full ported suite + goldens (regenerated, see attribution)
scripts/cross-critic.mjs OpenAI vision critic; exit 2 = degraded (no OPENAI_API_KEY)
skills/rebrand-chart/    new skill (generalised, multi-brand)
```

## Changes during the port (everything else is a faithful copy)

1. **Single-root brand loader.** Source `brand-loader.mjs` imports `brandsDirs`,
   `brandDirsFor` (multi-root search) and exposes `kitShadows()`. Brand-studio's
   `engine/store.mjs` is single-root (`dataDir()` via `CLAUDE_PLUGIN_DATA` /
   `BRAND_STUDIO_DATA` / `~/.brand-studio`). Trim the loader to the single-root store:
   drop `kitShadows()` and `brandRoots()` (or reduce to `[brandsDir()]`), keep
   `assertKitFonts` (fonts fail loudly, never substituted silently). Do NOT backport
   multi-root into `engine/store.mjs`.
2. **Data-only: remove the kit code toolkit.** `render/charts/annotate.mjs` may load a
   per-brand `connectors.mjs` toolkit (`loadKitToolkit`). Remove the hook entirely;
   annotations always use the engine's built-in callout styled from brand tokens.
   Brand-studio's contract: brand is data, not code. Adjust/remove the toolkit tests.
3. **Attribution pill.** Brand-studio's contract: every render carries the "Powered by
   Hourglass AI" mark, pinned bottom-centre (see `engine/brand.mjs` `htmlDoc()`; reuse its
   pill markup/CSS, extracting a shared export if practical rather than duplicating).
   Add it to the chart engine's `render/brand-css.mjs` `htmlDoc()`. Chart layouts must
   keep the bottom-centre strip clear (extend bottom padding if a source credit line
   collides). Regenerate all goldens after this change via `test/update-goldens.mjs`.
4. **Chromium detection.** Ensure `chart-engine/render/playwright.mjs` uses the same
   auto-detection as `engine/render.mjs` (Google Chrome or cached Playwright Chromium).
   Align to brand-studio's if they differ.
5. **Sanitise test files.** `test/brand-adapter.test.mjs` and `test/typography.test.mjs`
   reference the strategy-breakdowns slug and New Order / Avenir Next font names. Rename
   to neutral synthetic values (e.g. slug `test-brand`, families `Test Display` /
   `Test Sans`); assertions keep identical structure. Final gate: a case-insensitive grep
   for `strategy|alder|avenir|new ?order` over the repo (excluding node_modules and this
   spec) must return nothing.
6. **SessionStart hook.** Extend `hooks/` dependency install to also `npm install` in
   `chart-engine/` (same pattern as `engine/`).

## The `/rebrand-chart` skill

Base: the Tom Alder repo's `skills/rebrand-chart/SKILL.md` flow, generalised:

- **Brand resolution** like `/create-asset`: named slug → active brand → if several, ask;
  none → route to `/create-brand` and stop. Never `--brand` hardcoded. Never expose other
  brands to a user.
- Paths: `ROOT="${CLAUDE_PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}"`, engine at
  `$ROOT/chart-engine`, critic at `$ROOT/scripts/cross-critic.mjs`. No
  `BRAND_STUDIO_DATA=$ROOT` override (brand-studio kits live in the data dir, not the repo).
- Flow: preflight `doctor` → resolve brand → ingest source (image / path / URL) →
  classify (area / line / bar grouped|stacked / pie / donut; donut = `type:"pie"` +
  `"donut": true`; be honest about unsupported types, route multi-section sources to
  `/create-infographic` where installed, else `/create-asset`) → extract chart-spec with
  `provenance.sourceImage` + `provenance.uncertain` → **data gate** (uncertain values
  block render until user confirms `confirmedByUser: true`; validator enforces) →
  render → autonomous critique loop (cap 4: rubric + cross-critic, exit 2 = degraded
  rubric-only) → deliver PNG (+ optional `--out-pdf`) + `work/trail.md` → edit loop →
  offer to persist preferences to the kit's `preferences.json`.
- Hard rules carried over: never render past the data gate; the loop edits the CHART-SPEC
  only (brand token changes are proposals for the human); never add a SessionStart hook.
- Human-gate mode for a brand's first three rebrands or on request.
- `## Learned conventions` section starts EMPTY (nothing carried from the Tom Alder repo).
- Question-driven via AskUserQuestion, matching the other brand-studio skills.

## Docs

- `CLAUDE.md`: add `/rebrand-chart` to the skills table; add `chart-engine/` to the repo
  layout; note in the engine contract that there are now two renderers, both look-neutral
  (attribution pill excepted), and that the chart path is deterministic spec → SVG.
- `PROJECT.md`: status entry for this feature.
- `README.md`: mention chart rebranding alongside asset generation.

## Acceptance

1. `cd chart-engine && npm install && npm test` green (goldens regenerated with pill).
2. `cd engine && npm test` still green.
3. `node chart-engine/cli.mjs brands` lists kits from the brand-studio data dir.
4. End-to-end: with a test kit in a temp `BRAND_STUDIO_DATA`, `cli.mjs render --brand
   <slug> --spec <fixture>` produces a PNG carrying the attribution pill.
5. Leak gate (change 5) passes.
6. No modifications to `~/Hourglass-AI/strategy-breakdown-render/` or `~/Hourglass-AI/brand-render/`.
