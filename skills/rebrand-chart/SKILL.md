---
name: rebrand-chart
description: Re-skin an existing chart image into a saved brand with the exact same data, rendered from a chart-spec to deterministic PNG/PDF outputs. Use when the user says "rebrand this chart", "make this chart on-brand", "in our style", "make this graph in our brand", or drops in a chart image, graph screenshot, chart export, or chart URL and asks for a branded version.
---

# Rebrand a chart

Re-skin a source chart into a saved brand, data unchanged. The chart engine renders a
deterministic chart-spec to SVG and captures exact PNG/PDF output, so every number, label
and source note must be carried through faithfully.

**Drive this with questions.** Use `AskUserQuestion` for the directed choices below so the
user is walked through the flow. Skip a question only when the prompt already answers it.

Set up paths once at the start of your work:

```bash
ROOT="${CLAUDE_PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}"
CHART_ENGINE="$ROOT/chart-engine"
CRITIC="$ROOT/scripts/cross-critic.mjs"
BRANDCTL="$ROOT/engine/brandctl.mjs"
```

Keep these set in the same shell as each `node "$CHART_ENGINE/cli.mjs" ...` command, or
re-establish them. Do not set `BRAND_STUDIO_DATA="$ROOT"`: brand kits live in the plugin
data dir (`${CLAUDE_PLUGIN_DATA}`, `BRAND_STUDIO_DATA`, then `~/.brand-studio`), not in
this repo.

## Hard Rules

1. Never render past the data gate. If any extracted number or label is uncertain, list it
   in `provenance.uncertain`, show the spec for confirmation/correction, and set
   `confirmedByUser: true` only after the user confirms. The validator blocks rendering
   until that happens.
2. The critique loop edits the CHART-SPEC only. Brand token or kit changes are proposals
   for the human, never applied mid-loop.
3. Never add a `SessionStart` hook from this skill.

## Flow

0. **Preflight.** Run:
   ```bash
   node "$CHART_ENGINE/cli.mjs" doctor
   ```
   A `fail` blocks rendering; walk the user through the fix. A warning on the cross-model
   critic means degraded mode, so continue rubric-only and note it once.

1. **Resolve the brand.** Follow `/create-asset`'s privacy-preserving resolution:
   - If the user named a brand slug, use that slug and validate it. Do not list other
     brands.
   - Otherwise check the active brand and saved brand list:
     ```bash
     node "$BRANDCTL" list
     ```
   - No brands saved -> route to `/create-brand` and stop.
   - One brand or an active brand -> use it.
   - Several brands and no active brand -> ask with `AskUserQuestion` (header `Brand`,
     one option per saved brand). These are the user's own brands; never expose brands to
     anyone who is not their owner.
   Then run the brand-specific preflight:
   ```bash
   node "$CHART_ENGINE/cli.mjs" doctor --brand <slug>
   ```

2. **Load the brand context.** Get the paths:
   ```bash
   node "$BRANDCTL" path <slug>
   ```
   Read `brandJson` (`colors`, `fonts`, `logo`, `houseStyle`, `voice`, `about`,
   `audience`, `handle`, `cta`) and `preferences` if present. Look at 1-2 images from
   `examples/` for calibration. If `inspiration` exists, read any `dataViz` and visual
   grammar notes, but never treat inspiration as new brand tokens.

   Determine human-gate mode now. If the user asks to supervise, enable it. Otherwise use
   it for the brand's first three rebrands: read `preferences.rebrandChart.completedCount`
   if present; missing or `< 3` means human-gate mode.

3. **Ingest the source.** Accept a pasted or dragged image, a local file path, or a URL. If
   a URL points to a page, fetch it and identify the chart image or screenshot the chart
   region before extraction. Read the image carefully; the source chart is the data source
   unless the user supplies a cleaner table or CSV.

4. **Classify honestly.** Supported chart families are area, line, bar
   (`grouped` or `stacked`), pie and donut. Encode a donut as:
   ```json
   { "type": "pie", "donut": true }
   ```
   If the source is a table, funnel, dashboard, multi-section graphic, map, scatterplot,
   freeform diagram, or otherwise unsupported, say so plainly. Offer the nearest faithful
   supported option when one exists. For a multi-section source, route to
   `/create-infographic` if installed, otherwise `/create-asset`. Never force-fit a visual
   into the wrong chart type.

5. **Extract the chart-spec with provenance.** Use the source's exact numbers and labels.
   Write `work/spec.json` with at least:
   ```json
   {
     "type": "<bar|line|area|pie>",
     "title": "<title>",
     "subtitle": "<optional>",
     "series": [],
     "source": "<source note if present>",
     "provenance": {
       "sourceImage": "<path-or-url>",
       "uncertain": []
     }
   }
   ```
   Put every unsure value, label, unit, axis scale, date, grouping or source note in
   `provenance.uncertain` with a short reason. If that array is non-empty, show the spec
   and ask the user to confirm or correct it with `AskUserQuestion` (header `Data gate`).
   Only after confirmation/correction set:
   ```json
   { "confirmedByUser": true }
   ```
   **Brand mark (optional client branding).** Ask with `AskUserQuestion` (header
   `Brand mark`): `Yes, mark it as ours` / `No mark`. Default to the brand's saved
   `preferences.rebrandChart.brandMark` when present and skip the question. If yes, set:
   ```json
   { "watermark": "<the brand's handle if set, else its name>" }
   ```
   The engine draws the mark bottom-left; when the kit declares an icon-only logo
   (`logo.icon` in `brand.json`), the icon is inlined before the text automatically. If
   the user wanted their logo on the chart but the kit has no `logo.icon`, say the mark
   will be text-only for now and name `/edit-brand` as the way to add an icon variant
   (an icon-only SVG with no `<text>` elements). Never point `logo.icon` at the full
   wordmark: the engine inlines it before the name and the brand would read twice.

   Validate before rendering:
   ```bash
   node "$CHART_ENGINE/cli.mjs" validate --spec work/spec.json
   ```

6. **Render round 1.**
   ```bash
   node "$CHART_ENGINE/cli.mjs" render --brand <slug> --spec work/spec.json --out work/r1.png
   ```
   Add `--out-pdf work/final.pdf` only when the user asks for PDF or editable import.

7. **Critique loop, cap 4.** Each round:
   - Read the rendered PNG, not just the spec.
   - Score it against the engine rubric:
     ```bash
     node -e "import('$CHART_ENGINE/rubric.mjs').then(m=>console.log(m.rubricPrompt()))"
     ```
   - Compare against the source image and 1-2 brand example images. Check data fidelity,
     chart grammar, label precision, clipping, overlap, contrast, hierarchy, house-style
     fidelity, source-note placement, attribution-pill clearance, and anything that feels
     machine-rendered.
   - Run the cross-model critic:
     ```bash
     node "$CRITIC" --render work/rN.png --reference <brand-example.png> --notes work/notes.txt
     ```
     Exit `2` means degraded mode: continue rubric-only and warn once. Exit `1` means the
     critic errored: note it in `work/trail.md` and retry next round if useful.
   - Discard vague critique that lacks a concrete `where` and `suggestedFix`.
   - Apply fixes to `work/spec.json` only, re-validate, then re-render as `work/r<N+1>.png`.
   - Stop when the data gate passed and every rubric bar passes. At round 4, deliver the
     best-scoring round and say plainly what remains if anything is still outstanding.

   In human-gate mode, pause after each critique: show the render, proposed spec edits and
   rationale, then wait for approval before re-rendering.

8. **Deliver.** Save the final PNG, and PDF when requested. Write `work/trail.md` with:
   - source image path/URL and brand slug
   - confirmed spec summary and any data-gate corrections
   - per-round scores and critique sources
   - exact spec fields changed each round
   - discarded vague critique
   - any proposed brand-kit or preference changes not applied mid-loop
   - whether the cross-model critic ran or degraded

9. **Edit loop.** Show the polished PNG and ask with `AskUserQuestion` (header `Next`):
   `Tweak labels / data`, `Adjust visual balance`, `Export PDF`, `Looks good, done`.
   They can type a specific edit. Apply edits through the chart-spec, re-validate,
   re-render and re-QA. If they change a value, treat it as data-gate input and preserve
   the correction in provenance.

10. **Record the rebrand, offer to save preferences.** First, unconditionally increment
    `rebrandChart.completedCount` in the brand's `preferences.json` (bookkeeping for
    human-gate mode, not a preference; preserve existing keys):
    ```json
    { "rebrandChart": { "completedCount": 1 } }
    ```
    Then ask with `AskUserQuestion` (header `Save?`): `Yes, remember these tweaks` /
    `No, one-off`. If yes, additionally write the durable preferences the user confirmed,
    including their brand-mark choice so future rebrands stop asking, e.g.:
    ```json
    {
      "rebrandChart": {
        "brandMark": true,
        "notes": "Prefers direct value labels and compact source notes."
      }
    }
    ```
    Do not mutate `brand.json`; deliberate base-kit changes go through `/edit-brand`.

11. **Close out.** Say where the PNG/PDF and `work/trail.md` were saved. If the brand's
    actual tokens, fonts, logo, voice or house style seemed wrong, name `/edit-brand` as
    the route to fix the base kit.

## Learned conventions
