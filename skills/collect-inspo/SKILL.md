---
name: collect-inspo
description: Teach a saved brand its taste by feeding in a bag of inspiration (URLs, screenshots, files, a Notion page, descriptions), distilling them into archetypes + visual grammar + dos/don'ts, and saving the result as the brand's inspiration layer. Use when the user says "collect inspo", "feed in examples I like", "add inspiration", "teach the taste", "learn from these references", "I've got a Notion page of examples", or hands over a swipe file of posts/visuals they admire.
---

# Collect inspiration (teach the brand its taste)

A brand kit has two looks layered over it. **Examples** are the brand's *own* posts: they
say "this is what I currently put out." **Inspiration** is what the brand *admires*: posts,
graphics and frameworks they wish they could match. Inspiration is taste, not tokens, so it
rides as its own file (`inspiration.json`) and a folder of saved references
(`inspiration/`). Generation reads it alongside `brand.json` and `preferences.json` and uses
it to pick archetypes, apply visual grammar, and avoid known anti-patterns.

The trap to avoid: never pass raw URLs or screenshots at generation time. The model
averages them into mush and we can't render from a screenshot anyway. Do the analysis
**once** here and save structured signals.

**Drive this with questions.** Use `AskUserQuestion` for the directed choices below so the
user is walked through it. Skip a question when the prompt already answers it.

`ENGINE="${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

1. **Resolve the brand.** If named, use that slug. Else:
   ```bash
   node "$ENGINE/brandctl.mjs" list
   ```
   - No brands → tell them to run `/create-brand` first and stop.
   - One brand → use it.
   - More than one → ask which (`AskUserQuestion`, header `Brand`, one option per saved brand). Brands are private to their owner; don't enumerate someone else's.

2. **Find out what they have to teach taste** (`AskUserQuestion`, `multiSelect: true`, header `Inputs`):
   - `URLs / links` (LinkedIn posts, X threads, blog images, etc.)
   - `Screenshots / files` (a folder of images they've saved)
   - `A Notion / Google Doc page` of references
   - `Brands or accounts to emulate` (named only, no asset)
   - `Just a description of the taste`

   Then ask in conversation for the actual links / file paths / Notion URL / names. If they give a folder, list it.

3. **Ingest each item.** Get the brand's paths first:
   ```bash
   node "$ENGINE/brandctl.mjs" path <slug>
   ```
   Read the printed `inspiration` (JSON path) and `inspirationDir` (folder path). Start with whatever already exists in `inspiration.json` (an array of `items` plus the distilled signals) so this is additive, never destructive.

   For each input, build an item record:
   ```json
   {
     "id": "ins-001",
     "source": "linkedin | x | swipefile | url | file | notion | description | account",
     "url": "<original URL if any>",
     "localCopy": "<filename inside inspiration/ if saved, else omit>",
     "addedAt": "<YYYY-MM-DD>",
     "note": "<one line: why they like it, or what they want from it>",
     "tags": ["before-after", "single-stat", "mindmap", "..."]
   }
   ```

   Per-source handling:
   - **Local files / folders:** copy the file into `inspirationDir` (preserve filename, prefix with the id if there's a collision). Set `localCopy` to the filename. Files are the strongest signal: read the image and note what's visually distinctive.
   - **URLs:** use `WebFetch` to pull the page. If you get readable content, summarise it in `note` in 1-2 lines (what's actually in the visual, not the article wrapping). LinkedIn / X often gate the image: when fetch is thin, set `note` to a short label from context and tag conservatively. Don't claim to have seen something you didn't.
   - **Notion / Google Doc page** of links: fetch the page (`notion-fetch` for Notion, `WebFetch` otherwise), then walk each link inside it as its own item. Capture the user's annotation next to each link (e.g. "before vs after format") into the item's `note` and `tags`.
   - **Named brand or account:** record as an item with `source: "account"`, no `localCopy`. Capture what specifically they admire about it (don't just save the name).
   - **Description only:** one item with `source: "description"` and the description in `note`.

   Keep going through every input the user gave. If something can't be fetched, say so honestly in the running update rather than inventing detail.

4. **(Optional) Capture light per-item notes.** If the user clearly cares about *why* they picked each one, ask once for a short note per item in conversation (not a question per link: that's exhausting). Otherwise skip and let the distillation pass infer taste from the corpus.

5. **Distillation pass — the actual work.** Read all items as one corpus (the saved files in `inspirationDir`, the per-item notes, the tags) and produce structured taste signals. Be specific and concrete, the way `houseStyle` is in `brand.json`. Aim for:

   - **`archetypes`** (3-6, no more): the layout shapes they keep reaching for. Each is `{ name, summary, whenToUse, visualNotes, exampleIds }`. Name them in human terms (`"before-after"`, `"single-stat-hero"`, `"numbered-framework"`, `"mindmap"`, `"news-summary-card"`, `"quote-card"`). `whenToUse` says what post types or topics this layout fits. `visualNotes` describes the actual structure: column count, divider style, where the accent lands, badge geometry. `exampleIds` references the items it was learned from.
   - **`visualGrammar`** (free-text fields, descriptive):
     - `connectors` — arrow style, line weight, when they appear
     - `dividers` — rules, spines, dots, numbered steps, none
     - `badges` — pill/square/none, single-word labels?
     - `density` — generous whitespace? heavily packed? both depending on archetype?
   - **`typographyHierarchy`** — relative sizes, whether the hook is always one line, serif vs sans use
   - **`paletteUsage`** — where the accent lands; whether colour is loud or sparing
   - **`dataViz`** (only if data-viz items are in the corpus) — chart types, axis treatment, label density, source citation style. Leave it empty if the inspo is all text-frameworks.
   - **`dos`** and **`donts`** — short imperative lines. Honest. "No emoji.", "Lead with a number when there is one.", "Never gradient backgrounds." These directly steer `create-asset`.

   The job is *summarising* concrete patterns, not inventing aspirations. If three items are mindmaps and one is a chart, say so. If the user's stated goal differs from the items (e.g. they want data viz but the inspo is mostly text frameworks), call that out in a `taste_gap` field so future generation knows.

6. **Write `inspiration.json`** to the path from step 3 (Write tool). Schema:
   ```json
   {
     "updatedAt": "<YYYY-MM-DD>",
     "items": [ /* every item, including any pre-existing ones, with stable ids */ ],
     "distilled": {
       "archetypes": [
         {
           "name": "before-after",
           "summary": "Two-column comparison: 'before' state vs 'after' state.",
           "whenToUse": "Transformation, decision frameworks, comparisons.",
           "visualNotes": "Equal columns, vertical hairline divider, single-word kicker labels.",
           "exampleIds": ["ins-003", "ins-007"]
         }
       ],
       "visualGrammar": {
         "connectors": "Thin arrows between numbered steps; never thick.",
         "dividers": "Hairline rules. No bold borders.",
         "badges": "Square pill labels, one-word kicker.",
         "density": "Generous whitespace; ~30% of the canvas is breathing room."
       },
       "typographyHierarchy": "Hook 2-3x body; one line only. Subhead 1.3x.",
       "paletteUsage": "Accent reserved for the single most important element per post.",
       "dataViz": {
         "chartTypes": ["bar", "line", "small-multiple"],
         "axisTreatment": "Minimal: short labels, no chart titles, source line at the bottom.",
         "labelDensity": "Annotate the one number that matters; leave the rest unlabelled."
       },
       "dos": ["Lead with a number when there is one.", "Single focal point per post."],
       "donts": ["No emoji.", "No gradient backgrounds.", "Never more than one accent per asset."],
       "taste_gap": "<optional: difference between what they save and what they want to ship>"
     }
   }
   ```

7. **Validate.**
   ```bash
   node "$ENGINE/brandctl.mjs" validate <slug>
   node "$ENGINE/brandctl.mjs" inspiration <slug>
   ```
   `validate` now reports `inspirationItems` and `inspirationDistilled`. `inspiration` prints the saved JSON.

8. **Show the user what was learned.** In a short message: the count of items ingested, the archetype names you extracted, and the top 3 dos/don'ts. Be honest about anything you couldn't read.

9. **Prove it.** Ask whether to render a test asset that uses the new taste (`AskUserQuestion`, header `Test`):
   - `Yes, pick the strongest archetype and a topic from my categories`
   - `Yes, on a topic I'll give you`
   - `No, just save it`

   If yes, hand off to `/create-asset` (or render directly): pick a representative archetype, generate a post on a real topic, and show it. The point is to see the taste *show up* in the rendered output.

## Notes

- Inspiration is **additive**. Re-running `/collect-inspo` extends `items` and re-distills `distilled`. It doesn't wipe what's there unless the user explicitly asks.
- Inspiration is **taste, not tokens.** Don't try to recolour the palette from inspo: that's a deliberate change and belongs in `/edit-brand`. Inspiration influences *how* a post is laid out, not the brand's identity colours.
- The brand kit (`brand.json`) carries the look; **inspiration carries the taste**; **shape + prompt** carry the content. Three different jobs, three different files.
- If the user's stated ambition is data-driven visualisation (charts, maps, trends) but the corpus is mostly text-frameworks, write the `taste_gap` field and tell them what's missing from the inspo. Data-viz output needs real data inputs and chart-type templates: this skill captures the *taste* for it, not the data pipeline.
