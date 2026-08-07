# PROJECT — Brand Studio

**Status:** MVP rebuilt and verified end-to-end. (2026-06-16)
**What this is:** see `CLAUDE.md` for the architecture. This file tracks status, decisions,
and the rebuild plan.

## Where we are

Re-interviewed the brief on 2026-06-16, rewrote `CLAUDE.md`, connected the repo to GitHub
(then `proj-influencers`, since moved to `HourglassDigital/brand-studio`), removed the old
infographic build, and rebuilt the MVP against the recovered scope. Engine smoke tests pass (3/3) and a full brand-create → render produced a
correct on-brand PNG + PDF. Remaining: exercise the two skills on a real brand, then push.

The old build drifted: it made "layout" a fixed content structure (`breakdown` flowchart) and
generated a bespoke layout *code module* per brand. The rebuild inverts that: **shapes are
bare canvases, the brand kit drives the look, and Claude authors the asset HTML per prompt.**

## The brief (recovered 2026-06-16)

Brands install the plugin and upload their brand assets (past examples, logos, fonts). The
plugin analyses these into a per-client brand repository, then uses it to generate new on-brand
assets (social posts, and over time anything in any form). There is a set of standard **shapes**
(e.g. square for Instagram, 16:9 for YouTube) chosen by platform unless the prompt specifies
otherwise. After producing an asset, run an **edit loop** until the user is happy; at session
end, offer to **save their preferences**.

## Decisions (locked)

1. **Rename** `infographic-studio` → `brand-studio`. Scope is general brand assets, not
   infographics.
2. **Render model:** Claude authors each asset's HTML/CSS fresh, grounded by the brand's
   house-style spec + reference examples + preferences. The engine is a thin renderer
   (inject fonts/logo/colour variables, enforce shape, screenshot). No per-brand layout code.
3. **Brand repository = immutable analysed base + a separate preferences-override layer.**
   Generation reads base ⊕ preferences.
4. **Shapes are built-in config**, not user-authored. Drop `/layout-add`.
5. **Keep HTML/CSS → PNG/PDF** via Playwright. Exact brand match + text never garbled is the
   core value.
6. **Consistency:** consistent house style within a brand; a prompt can explicitly break out.
7. **MVP shape set:** ig-square, ig-portrait, ig-story, linkedin, x, youtube (16:9).
8. **Output:** PNG primary, PDF optional. Native editable design files (Figma/Canva) deferred.

## Open questions (resolved)

- **Generate skill name.** Resolved → `/create` (folder `skills/create`). Easy to rename later.
- **Repo name.** Resolved → `HourglassDigital/brand-studio`, matching the plugin name. The
  the local folder matches. The old `proj-influencers` repo is private and archived.
- **House-style spec schema.** Resolved → `houseStyle: { cards, dividers, accent, type, motifs,
  doNots }` free-text guidance fields (see `/brand-add`). Descriptive, not a fixed schema.

## Rebuild plan (done)

1. ✅ **Manifests** — `plugin.json` / `marketplace.json` / `engine/package.json` → `brand-studio`.
2. ✅ **Shapes module** — `engine/shapes.mjs` (6 presets + safe-area); `brandctl shapes`; `cli`
   resolves the shape and sizes the canvas; `--safe` CSS var exposed.
3. ✅ **Brand kit v2** — `brand.json` gains `houseStyle`; role-mapped palette; `examples/`
   retention; preferences layer (`preferences.json`) + `loadBrand` base ⊕ preferences merge.
4. ✅ **Thin render engine** — `brand.mjs` injects fonts + palette CSS vars + logo via
   `htmlDoc`; `cli.mjs` takes `{css, body}` + placeholders; `render.mjs` unchanged (HTML→PNG/PDF).
5. ✅ **`/brand-add` rewrite** — analyse → write base + house-style, copy assets, keep examples.
6. ✅ **`/create` skill** — resolve brand + shape, compose + author `{css, body}`, render,
   edit loop, save preferences at session end.
7. ✅ **Removed** `/layout-add`, per-brand `.mjs` layouts, the `breakdown` schema, infographic naming.
8. ✅ **Tests & docs** — `engine/test/smoke.test.mjs` (shapes, base ⊕ preferences, render);
   README + CLAUDE.md refreshed.

## Update — 2026-06-16 (skill rename + question-driven flows)

Skills renamed for clarity and made question-driven (each uses AskUserQuestion to walk the user
through): `brand-add` → **`create-brand`**, `create` → **`create-asset`**, plus a new
**`edit-brand`** (deliberate changes to a saved brand's base kit, vs the auto-learned
`preferences.json` overlay that `create-asset` writes).

## Update — 2026-08-07 (attribution footer, legibility fix, public-repo sweep)

- **Attribution:** every render now carries a small "Powered by Hourglass AI" mark
  (hourglass glyph + deep-teal text on a light frosted pill with a soft teal glow),
  pinned bottom-centre by the engine (`brand.mjs` `htmlDoc()`). Self-contained (system
  font stack, inline SVG) and sized so the teal clears the legibility gate's contrast
  floor over both white and near-black pages. Tests + docs (README, CLAUDE.md,
  create-asset skill) updated.
- **Legibility gate bug fixed:** the contrast check's backdrop walk discarded translucent
  layers above an opaque one (white text on a translucent dark chip measured 1.00:1).
  Compositing is now front-to-back; regression tests added. See debug.md.
- **Public-repo sweep:** no image/font/brand assets were ever committed (verified across
  full history) and no secrets in history. Client-named test fixtures and debug.md
  entries were renamed to neutral placeholders, and the history was squashed to a single
  initial commit so no earlier revision names a client. `.gitignore` now blocks brand
  kits, licensed fonts and client artwork from being committed by accident.
- **Merged the two lineages.** `main` held the inspiration layer (`/collect-inspo`,
  `store.mjs` accessors, `brandctl inspiration`); this branch held the legibility gate,
  logo variant guards, the `==highlight==` fix, the installer and the attribution mark.
  Both survive. `welcome.mjs` is gone: `/create-brand` does the handoff instead, leading
  with `/collect-inspo` as the recommended next step.
- **Dropped `/create-infographic`.** It imported a `connectors.mjs` / `charts.mjs`
  toolkit that lived in one client's kit rather than in the engine, so it could never
  work on a fresh install. If it comes back, the toolkit belongs in `engine/`, themed
  from the palette like everything else. `/create-asset` covers the ordinary cases.
- Verified end-to-end: brandctl (path/validate/list/shapes) + CLI render to PNG and PDF
  on a temp brand, badge confirmed at pixel level on light and dark backgrounds.
  Engine tests 29/29, run repeatedly after a byte-comparison flake was removed.

## Update — 2026-06-19 (taste layer + `/collect-inspo`)

Added a fourth data concept to the brand repository: **inspiration**, captured by a new
`/collect-inspo` skill. Distinct from `examples/` (the brand's *own* posts: their current
look) — inspiration is what they *admire* (a Notion swipe file, LinkedIn posts they love,
named accounts to emulate). The skill ingests URLs, files, folders, Notion / Google Doc
pages and named accounts, runs a single distillation pass over the whole corpus, and writes
`inspiration.json` with structured signals: `archetypes` (3-6 layout shapes they reach for),
`visualGrammar` (connectors, dividers, badges, density), `typographyHierarchy`,
`paletteUsage`, `dataViz` (when relevant), and `dos` / `donts`. Re-runs are additive.

Generation now reads inspiration alongside base ⊕ preferences. Order of authority on a
conflict: prompt > preferences > inspiration > base `houseStyle`. The adversarial self-review
in `/create-asset` includes an inspiration-fidelity check.

Why: feeding raw references in at generation time scales badly (cost, noise, can't render
from screenshots). Distilling once into structured signals is the durable fix. The trigger
was a real swipe file: a Notion page of admired posts with a stated goal of data-driven
visualisation, motivating both the taste layer and a `taste_gap` field on the distillation
that flags when stated ambition diverges from the saved corpus.

Engine changes: `store.mjs` exports `inspirationDir`, `inspirationPath`, `loadInspiration`;
`ensureDirs` mkdir's `inspiration/`; `loadBrand` attaches inspiration as a top-level field
(never merged into colours/fonts). `brandctl.mjs` extends `path` output, reports inspiration
on `validate`, and adds `inspiration <slug>` to print the distillation. Smoke test covers
absent-vs-present inspiration without breaking the merge. Plugin bumped to `0.3.0`.

Tier 2 (real data-viz: charts, maps, trends) is deliberately *not* shipped by this update.
Inspiration captures the taste for it (in the `dataViz` block) but the data-input pipeline
and chart-type templates are a separate piece of work — see Next.

## Next

- Exercise `/create-brand` → `/collect-inspo` → `/create-asset` on a real swipe file end-to-end.
- Push `feat/collect-inspo` to `origin` and open a PR once Anna approves.
- **Tier 2 — data-driven visualisation.** Architect a data input layer (`data:` block in the asset brief, supporting `inline | csv-path | url | sql`), a small set of native-SVG chart-type templates (bar, line, small-multiple, choropleth, scatter) styled by the brand kit and inspiration `dataViz` signals, and an `archetype: chart-card` that `create-asset` picks when the brief carries data. Out of scope for the inspiration update.
- Later phases: editable design-file export (Figma/Canva), more shapes, non-image media.

## Cleanup notes

- `~/.infographic-studio/brands/{anthropic,hourglass-digital}` is the OLD data dir (orphaned by
  the move to `~/.brand-studio`). Left in place; delete it yourself if you want it gone.
