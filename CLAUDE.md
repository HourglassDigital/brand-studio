# Brand Studio (Claude Code plugin)

A Claude Code plugin that brands install, upload their assets to, and which learns their
look into a per-client **brand repository**. After that, a prompt plus a target **shape**
generates a new on-brand asset (social post, etc.), rendered from real HTML/CSS so the
brand match is exact and text/numbers are never garbled.

> This file is the source of truth for how the project is built. Read it before editing.
> Status, open tasks and the rebuild plan live in `PROJECT.md`.

## The one-paragraph mental model

A **shape** is just a canvas (size + safe area); it says nothing about content. The
**brand repository** holds a client's visual DNA as data: its **base look** (palette, fonts,
logo, house style) and its **taste** (archetypes and visual grammar distilled from references
they admire). To generate, Claude composes the content in the brand's voice and authors the
HTML/CSS for it, grounded by the house-style spec, the reference examples, the inspiration
distillation and any saved preferences, sized to the chosen shape. The **engine** is thin: it
injects the brand's fonts, logo and colour variables, enforces the shape, and renders the
HTML to PNG/PDF. The look comes from the brand, the taste from inspiration, the structure
from Claude per asset; the engine carries none of them.

## Architecture

Four data concepts, all persisted in the plugin data dir (`${CLAUDE_PLUGIN_DATA}`, with a
`BRAND_STUDIO_DATA` override and a `~/.brand-studio` fallback). Nothing brand-specific lives
in plugin code; every install starts with a clean slate.

### 1. Brand repository (immutable analysed base)
Per client, under `brands/<slug>/`:
- `brand.json` — the profile:
  - **Identity:** `name`, `handle`, `cta`, `about`, `audience`, `voice`, `categories`.
  - **Tokens:** `colors` (role-mapped palette) and `fonts` (families + the `files` to load).
  - **Logo:** which asset file + sizing.
  - **House-style spec:** a structured, *descriptive* account of the brand's visual DNA:
    card/border/shadow treatment, dividers and connectors, accent usage (loud vs sparing),
    type hierarchy, spacing density, signature motifs, and explicit do/don'ts. This is
    guidance Claude reads when authoring HTML; it is NOT code and NOT a content schema.
- `assets/` — logo (SVG preferred, else PNG) and brand font files (woff2/ttf).
- `examples/` — the brand's own reference graphics (their *current* look), kept so generation
  can ground on the real thing, not just the written spec.

The base is written once by `/create-brand` (and changed deliberately by `/edit-brand`).

### 2. Preferences layer (separate, mutable override)
Per client, `brands/<slug>/preferences.json`. Captures refinements the user confirmed at the
end of a session (from the edit loop). Generation reads **base ⊕ preferences**, with
preferences winning on conflict. Kept separate from the base so it can be reset without
re-analysing the brand. Never mutate `brand.json` to record a preference; write it here.

### 3. Inspiration layer (separate, additive: taste, not tokens)
Per client, `brands/<slug>/inspiration.json` plus a folder `brands/<slug>/inspiration/` for
saved screenshots and files. Captures references the brand **admires** (LinkedIn posts they
love, a Notion swipe file, named accounts to emulate) and the distillation of them into
structured taste signals: `archetypes` (layout shapes they reach for), `visualGrammar`
(connectors, dividers, badges, density), `typographyHierarchy`, `paletteUsage`,
`dataViz` (when relevant), and `dos` / `donts`. Distinct from `examples/` because examples
are the brand's *current* output; inspiration is what they *aspire to*. Written by
`/collect-inspo` and re-run additively. Generation reads it alongside the base + preferences
and uses it to pick the closest-fit archetype, apply the visual grammar, and honour
dos/don'ts on top of `houseStyle`. Inspiration is taste, not tokens, so it is never merged
into `colors`, `fonts` or `logo`: changes to those go through `/edit-brand`.

### 4. Shapes (built-in, global, shared)
Canvas presets in the engine, NOT per-brand and NOT user-authored in the MVP. Each shape is
`{ name, platform, width, height, safeArea, notes }` and carries **no content assumptions**.
MVP set:

| Shape | Platform | Size |
|---|---|---|
| `ig-square` | Instagram post | 1080×1080 |
| `ig-portrait` | Instagram / LinkedIn portrait | 1080×1350 |
| `ig-story` | Instagram / Reels story | 1080×1920 |
| `linkedin` | LinkedIn post | 1200×1200 |
| `x` | X / Twitter | 1600×900 |
| `youtube` | YouTube thumbnail / cover | 1920×1080 |

The shape is inferred from the prompt (platform mention) when possible, otherwise asked or
defaulted. A prompt may override the shape explicitly.

## Generation pipeline (`/create-asset`)

1. **Resolve the brand** (named slug, else the active brand; if several, ask which). No brand →
   tell the user to run `/create-brand` and stop. Work only with the chosen brand; never expose
   a brand to anyone who isn't its owner.
2. **Resolve the shape:** infer from the prompt/platform; else default to `ig-portrait` or
   ask. A prompt can override.
3. **Load** the brand base ⊕ preferences, the reference examples, and the inspiration
   distillation (if present).
4. **Compose:** Claude writes the content in the brand voice AND authors the HTML/CSS for the
   asset, following the house-style spec, examples and preferences, structured around the
   closest-fit **inspiration archetype** when one is saved, at the shape's size and safe area.
   Order of authority on a conflict: prompt > preferences > inspiration > base `houseStyle`.
   A prompt can explicitly break out for a one-off.
5. **Render:** the engine injects the brand's `@font-face` declarations, the logo (as a
   known element / data URI), and the palette as CSS custom properties; sets the viewport to
   the shape; and screenshots to PNG (optional PDF). The engine carries no look of its own.
6. **Adversarial self-review (QA gate):** Claude reads the rendered PNG and critiques it as a
   sceptical client would (clipping/overflow, collisions, contrast, brand fidelity, hierarchy,
   house-style match, leftover placeholders, copy quality, distortion), then fixes every
   blocking/major issue and re-renders until it passes. The rough first pass is never shown.
7. **Edit loop:** show the polished PNG (with a note of what the review fixed), ask for edits,
   Claude edits the HTML, re-render. Repeat until the user is happy.
8. **Session end:** offer to save refinements to the preferences layer.

## Engine contract (keep it thin)

The engine does four jobs and no design:
- **render** — HTML + brand + shape → PNG/PDF (Playwright/Chromium). Injects brand fonts,
  logo, and palette CSS variables; sizes the canvas to the shape; honours the safe area.
- **brandctl** — manage brand repos: add, list, active/use, path, validate, inspiration;
  manage assets, the preferences layer and the inspiration layer.
- **shapes** — list and resolve the built-in canvas presets.
- **brand-style preamble** — the documented CSS contract the engine injects so Claude's
  authored HTML stays portable: palette as `--token` custom properties, `@font-face` for the
  brand fonts, and a logo handle. Claude's HTML *uses* these; the engine *fills* them.
- **attribution** — every render carries a small "Powered by Hourglass AI" mark (hourglass
  glyph + deep-teal text on a light frosted pill with a soft teal glow), pinned
  bottom-centre by `htmlDoc()` (the one deliberate exception to the engine carrying no
  look). The pill sits at 85% white so the backdrop stays light on any page, keeping the
  teal above the contrast floor on both light and dark brands; authored content must keep
  that bottom-centre strip clear or the legibility gate flags the collision.

Chromium is auto-detected (Google Chrome or a cached Playwright Chromium); a `SessionStart`
hook installs the Node dependency on first run.

## Skills (MVP)

| Skill | What it does |
|---|---|
| `/create-brand` | Walk the user (via AskUserQuestion) through onboarding: upload assets (examples, logo, fonts) → analyse → build the brand kit, capturing the house-style spec carefully. |
| `/collect-inspo` | Teach a saved brand its taste: ingest URLs / files / a Notion swipe file / named accounts, then distil into archetypes + visual grammar + dos/don'ts saved as `inspiration.json`. Additive: re-run to extend. |
| `/create-asset` | Generate an on-brand asset: ask brand/shape/post-type → compose copy + author `{css, body}` (around the closest-fit inspiration archetype when one exists) → render → adversarial self-review → edit loop → offer to save preferences. |
| `/edit-brand` | Deliberately change a saved brand's base kit (palette, fonts, logo, voice, house style, handle/CTA) and re-render a test. |

Each skill is question-driven (AskUserQuestion) so the user is directed through the flow.
`/layout-add` and per-brand layout code modules are **removed** in the rebuild (see below).

## What the rebuild changes vs the old `infographic-studio` build

**Removed:**
- Per-brand `.mjs` layout *code* modules and the "every brand gets bespoke layout code"
  contract. Replaced by the data-driven house-style spec + Claude-authored HTML.
- The `/layout-add` skill.
- The fixed `breakdown` content schema as the central concept.
- The "infographic" framing and the old plugin name.

**Kept:**
- HTML/CSS → PNG/PDF via the Playwright render pipeline (exact brand match, text never
  garbled: this is the whole point).
- Brand-as-data philosophy, persistent data-dir storage, the `brandctl` CLI shape.
- Clean slate (no preloaded brands), `SessionStart` dependency install hook.

## Conventions

- **Australian English** (colour, analyse, organisation, prioritise). Never use em dashes.
- **Brand assets are private** to their owner; skills must never enumerate or leak other
  brands.
- **Brand is data, not code.** A new brand or a tweaked look is a data change, never an engine
  change. The engine stays look-neutral.
- **Never hand-edit a rendered PNG.** To change content, re-compose and re-render. To restyle,
  update the house-style spec / preferences and re-render.
- Match the existing module style in `engine/` (ES modules, `.mjs`).

## Repo layout

```
.claude-plugin/        plugin.json + marketplace.json (name: brand-studio)
hooks/                 SessionStart dependency-install hook
engine/                thin renderer + brandctl + shapes (ES modules)
  render.mjs           HTML + brand + shape → PNG/PDF
  cli.mjs              brand + shape + {css,body} → render
  brandctl.mjs         brand kit + preferences + inspiration management CLI
  brand.mjs            brand tokens + logo + htmlDoc() preamble
  shapes.mjs           built-in canvas presets
  store.mjs            data-dir resolution + base ⊕ preferences + inspiration attach
  test/smoke.test.mjs  shapes, merge, inspiration, render
skills/
  create-brand/        onboard a brand from its assets (question-driven)
  collect-inspo/       ingest references the brand admires; distil taste signals
  create-asset/        generate an asset → edit loop → save preferences
  edit-brand/          deliberately change a saved brand's kit
```
