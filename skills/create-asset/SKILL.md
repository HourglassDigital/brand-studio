---
name: create-asset
description: Generate a new on-brand graphic from a prompt, using a saved brand kit, at a standard social shape. Walks the user through it with questions (which brand, which platform/shape, what kind of post), composes the copy in the brand's voice, authors the visual in the brand's house style, renders a PNG (and optional PDF), adversarially reviews its own output and fixes any issues before showing it, then runs an edit loop. Use when the user asks to "create an asset", "make a post", "make a graphic", "make an Instagram/LinkedIn/story/YouTube post", or gives a topic to put on-brand.
---

# Create an on-brand asset

Turn a topic, tweet, paragraph or idea into a finished on-brand graphic. The copy is written in the brand's saved voice; the visual is authored fresh in the brand's house style and rendered from real HTML/CSS, so text and numbers are always exact. After it renders, refine it in an edit loop, and at the end of the session offer to save what you learned back to the brand.

**Drive this with questions.** Use `AskUserQuestion` for the directed choices below so the user is walked through it. Skip a question when the prompt already answers it (e.g. they said "an Instagram story about X" → shape is `ig-story`, topic is X).

`ENGINE="${CLAUDE_PLUGIN_ROOT}/engine"` — run all commands with that path.

## Steps

1. **Resolve the brand.** If the user named one, use that slug. Otherwise:
   ```bash
   node "$ENGINE/brandctl.mjs" list
   ```
   - No brands saved → tell them to run `create-brand` first and stop.
   - One brand → use it.
   - More than one → ask which (`AskUserQuestion`, header `Brand`, one option per saved brand). These are the user's own brands; picking among them is fine, but never expose brands to someone who isn't their owner.

2. **Resolve the shape** (`AskUserQuestion`, header `Shape`, unless the prompt names a platform). A shape is just the canvas:
   `ig-square` (1080×1080, IG post), `ig-portrait` (1080×1350, IG/LinkedIn portrait), `ig-story` (1080×1920, story/Reel), `linkedin` (1200×1200), `x` (1600×900), `youtube` (1920×1080 thumbnail). Infer from the prompt where you can ("a story" → `ig-story`, "a thumbnail" → `youtube`); else ask, default `ig-portrait`. The prompt always wins.
   ```bash
   node "$ENGINE/brandctl.mjs" shapes
   ```

3. **Get the brief** (`AskUserQuestion` where the prompt is thin):
   - **Topic / angle**: if not given, ask what the post is about (free text).
   - **Post type** (header `Post type`): `Hook / single statement`, `Stat or metric`, `Step-by-step / how-to`, `Myth vs fact` (they can type another: quote, comparison, announcement, listicle). This steers composition, not a fixed template.
   - **Density** (header `Density`): `Minimal (one big idea)`, `Balanced`, `Dense (more detail)`. Tunes type scale and how much copy.
   Only ask what you can't safely infer.

4. **Load the brand.** Get its paths and read the kit:
   ```bash
   node "$ENGINE/brandctl.mjs" path <slug>
   ```
   Read `brandJson` (`voice`, `about`, `audience`, `categories`, `cta`, `handle`, `colors`, `fonts`, and especially **`houseStyle`**). Read `preferences` if present (learned tweaks that overlay the base: honour them). Look at the graphics in the `examples` dir to ground the look in the real thing.

   If the brand has an `inspiration` file (from `/collect-inspo`), read it too. It carries **taste**, not tokens. Use `distilled.archetypes` to pick the closest-fit layout for this brief, apply `distilled.visualGrammar` (connectors, dividers, badges, density), honour `distilled.typographyHierarchy` and `paletteUsage`, and respect `dos` / `donts` on top of `houseStyle`. Order of authority on a conflict: prompt > preferences > inspiration > base `houseStyle`. Inspiration steers *how* the asset is laid out; the brand kit still owns the colours, fonts and logo.

5. **Compose the asset.** Two parts, both in the brand's character:
   - **Copy** in the brand's voice (hook, supporting line(s), any stat, CTA). Accurate; don't invent precise figures. Tight for the shape and density.
   - **Visual**, authored as a JSON object `{ "css": "...", "body": "..." }` that reproduces the brand's **house style** at the chosen shape, structured around the closest-fit **inspiration archetype** when one is saved. You draw the asset; the engine renders it on-brand.

   **Authoring contract** (the engine wraps your `css`+`body` with the brand's fonts, palette and logo):
   - Use the brand palette via CSS variables: `--bg --surface --ink --muted --accent --accent-soft --accent2 --line --white`. Pad to the safe area with `var(--safe)`.
   - Headlines use the brand headline font automatically (`h1,h2,h3`); body uses the body font. Wrap the single most important phrase in `==double equals==` and style `mark` in your css (e.g. `mark{color:var(--accent);background:transparent}`).
   - Drop in brand assets with placeholders: `{{logo}}` (the lockup as authored), `{{logo-light}}` (white, for dark backgrounds), `{{handle}}`, `{{cta}}`, `{{name}}`.
   - **Reach for `{{logo}}` first.** `{{logo-light}}` recolours the mark to a single flat colour, which only works for a logo that is already one colour. A lockup that paints several fills (a coloured field with knocked-out letters, a ring around a body) would flatten to a solid silhouette, so the engine refuses it and tells you so. Many such lockups carry their own background and read fine on dark and light alike: use `{{logo}}` and check the render.
   - The root element is `#frame` at the shape's size; your `body` fills it. Match `houseStyle` (cards, accent usage, type hierarchy, motifs, doNots), consistent with the examples. A prompt can explicitly ask to break from the house style for a one-off.
   - The engine pins a small `Powered by Hourglass AI` pill (deep teal on light frosted glass, softly glowing) centred at the very bottom of every render (between the frame edge and the safe area). Keep that bottom-centre strip clear: content that strays under it fails the legibility gate as covered text. Don't author your own attribution, and don't try to remove it.
   - Write the object to a temp file, e.g. `/tmp/asset.json`.

6. **Render.**
   ```bash
   node "$ENGINE/cli.mjs" --brand <slug> --shape <shape> --data /tmp/asset.json --out "$HOME/Desktop/<slug>-<shape>-<topic>.png" --pdf
   ```
   `--pdf` is optional: include it when they want to edit in Canva (the PDF imports with a real text layer).

7. **Adversarial self-review (do this BEFORE showing the user/client).** You just rendered the asset; now be its harshest critic. Read the output PNG and review it as if a sceptical client is about to reject it and you get one chance to catch the problems first. Do **not** present the asset until it passes this gate.

   Look hard at the rendered image (not the HTML, the actual pixels) and check, concretely:
   - **Clipping / overflow:** is any text or element cut off at the canvas edge or its container? The frame is `overflow:hidden`, so anything too big is silently chopped. Is content crashing into or past the safe area (`var(--safe)`)?
   - **Collisions:** text overlapping other text, the logo, a badge or a shape? Decorative lines/nodes running through the copy?
   - **Legibility / contrast:** is every line readable against what's behind it? Muted text too faint? Is the `==highlight==` (`mark`) actually styled in-brand, not the default browser yellow?
   - **Brand fidelity:** do the colours, fonts and logo match the kit and the examples? Right logo variant for the background (e.g. a light logo on a dark bg)? Logo undistorted, aspect ratio intact?
   - **Hierarchy & balance:** is the hook the clear focal point? Awkward empty gaps, or cramped crowding? Is the composition balanced for this specific shape?
   - **House-style match:** does it use this brand's devices (cards, accents, motifs) and avoid its `doNots`? Would it read as unmistakably *them*?
   - **Inspiration match (if `inspiration` exists):** does the layout actually use the chosen archetype's structure (right column count, divider style, accent placement)? Does it honour `dos` / `donts`? If it drifted from the taste signal, that's a blocking issue.
   - **Placeholders:** any literal `{{...}}` left unsubstituted, or leftover lorem/placeholder text?
   - **Copy quality:** typos, awkward line breaks, off-voice phrasing, too much text for the shape? Any invented precise stat or claim you can't stand behind? Never ship a fabricated number.
   - **Distortion:** nothing stretched; all aspect ratios intact.

   Write a brief, honest critique listing each issue found with a severity: **blocking** (would embarrass us), **major** (clearly hurts it), **minor** (nice-to-fix). Then **fix every blocking and major issue**: edit `/tmp/asset.json` (the `{css, body}`) or the copy and re-render, then re-review the new render. Loop until no blocking or major issues remain. Hold the bar at "I'd happily put this in front of the client", not "good enough". This is internal QA: the user should see the polished result, not the rough first pass.

8. **Show it and run the edit loop.** Present the polished PNG (Read it so the user sees it), with a one-line note of what the self-review caught and fixed (so they know it was checked). Then ask what they'd change (`AskUserQuestion`, header `Next`, options like `Tweak the copy`, `Adjust colours / size`, `Different shape`, `Looks great, done`; they can type a specific edit). Apply by editing `/tmp/asset.json` (or the copy) and re-render. Repeat until they pick "done". Keep a short note of the kind of edits they ask for: those become preferences.

9. **Offer to save preferences (session end).** When they're done, ask (`AskUserQuestion`, header `Save?`): `Yes, remember these tweaks` / `No, one-off`. If yes, write the brand's `preferences` file (path from step 4) as a JSON object overlaying `brand.json`, with only what genuinely recurred:
   ```json
   {
     "colors": { "accent": "#<the accent they preferred>" },
     "houseStyle": { "type": "they kept wanting bigger headlines and less body copy" },
     "voice": "<any tone refinement they kept asking for>",
     "notes": "Prefers one stat per post; avoid emoji."
   }
   ```
   Preferences overlay the base on every future generation (winning on conflict) without mutating `brand.json`, so they can be reset by deleting the file. For a deliberate, permanent change to the brand, use `edit-brand` instead.

10. **Close out.** Say where the file was saved, and that they can run `/create-asset <topic>` any time for the next one. If anything about the *brand itself* came up during the session (the palette, fonts, logo, voice, handle or CTA being wrong, rather than this one post), point them at `/edit-brand` by name and offer to run it now: that is the only way a fix carries across every future post rather than being re-done each time.

## Notes
- Never hand-edit the rendered PNG. To change content or look, edit the `{css, body}` (or copy) and re-render.
- The shape carries no content: the same prompt at `ig-square` vs `ig-story` is re-composed for the canvas, never stretched. Never distort to fit a shape.
- Consistency within a brand comes from following its `houseStyle` and examples every time; different brands must look genuinely different.
