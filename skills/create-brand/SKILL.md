---
name: create-brand
description: Onboard a new brand by learning it from its own assets and saving it as a reusable brand kit. Walks the user through it with questions, then drops in 1-3 example graphics, a logo, fonts and a palette and analyses the look into a saved brand.json (palette, fonts, logo, voice, house-style spec). Use when the user says "create a brand", "add my brand", "set up a brand", "learn my style", "onboard a new client/creator/influencer", or provides brand assets.
---

# Create a brand (learn it once, reuse it forever)

Onboard a brand into a saved **brand kit** that every future asset is generated from. The kit is **data**, not code: a `brand.json` (identity, role-mapped palette, fonts, logo, voice, and a **house-style spec**), plus `assets/` (logo + fonts) and `examples/` (their reference graphics, kept to ground generation). The house style is what makes a brand's assets recognisably theirs across every prompt and shape: capture it carefully.

**Drive this with questions.** Use `AskUserQuestion` at each decision below rather than asking in free text, so the user is walked through onboarding. Skip a question only when its answer is already obvious from what they gave you.

`ENGINE="${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

1. **Find out what they have to teach the brand** (`AskUserQuestion`, `multiSelect: true`):
   - Header `Inputs`, question "What do you have to teach me this brand?", options: `Example graphics` (their existing posts: best signal), `Logo file`, `Brand fonts`, `Palette / hex codes`, plus they can type "just a description" or name a brand to emulate.
   Then ask, in normal conversation, for the actual files or folder paths for whatever they selected. If they give a folder, list it to find the assets. If they have no examples, ask them to describe the aesthetic or name a brand to emulate.

2. **Capture identity** (`AskUserQuestion` where it helps; free text for specifics):
   - Get the brand/creator **name**, **handle** (e.g. `@jane`), and **CTA** (e.g. "Book a call").
   - Ask the **voice** with a question, header `Voice`: e.g. `Punchy & plain-spoken`, `Warm & encouraging`, `Authoritative & technical`, `Playful & bold` (they can type their own). Refine in their words.
   - Ask their **post categories** (the kinds of posts they make: used as the eyebrow/kicker).

3. **Analyse the examples — look, structure AND voice.** From the reference graphics extract:
   - **Palette → roles.** Map the brand's real colours onto these neutral slots (fill the actual hexes):
     `bg` (page background), `surface` (cards/panels), `ink` (primary text/lines), `muted` (secondary text), `accent` (primary accent), `accentSoft` (a tint/highlight of the accent), `accent2` (secondary emphasis), `line` (hairlines), `white`. A flat single-accent brand just sets `accent` and leaves the rest quiet. Any slot omitted falls back to a default. Sample colours from the examples; never invent them. When unsure, ask.
   - **Fonts.** Headline and body family. If they are Google Fonts, set `googleFamily` (chain weights with `:` or two families with `&family=`).
   - **House style** (the important part: be specific and concrete):
     - `cards`: flat hairline rows? outlined cards? filled panels? offset/drop shadows? rounded or square? or no cards?
     - `dividers`: rules, spines, dots, arrows, numbered steps, none?
     - `accent`: loud (fills, badges) or sparing (one rule, one number)?
     - `type`: serif display vs sans? big size jumps? tight or airy?
     - `motifs`: any signature device (a corner mark, a highlighter, an underline, a tag)?
     - `doNots`: things that would look off-brand.

4. **Choose a slug** (kebab-case, e.g. `jane-smith`) and get its paths:
   ```bash
   node "$ENGINE/brandctl.mjs" path <slug>
   ```
   Prints `brandJson`, `assets`, `examples`, `preferences`.

5. **Copy assets and keep the examples.**
   ```bash
   cp "<their-logo>"  "<assets>/logo.svg"        # if provided
   cp "<their-font>"  "<assets>/headline.woff2"  # if provided
   cp "<example1>"    "<examples>/"              # keep references for grounding
   ```

6. **Write the profile** to the `brandJson` path (Write tool). Schema:
   ```json
   {
     "slug": "<slug>",
     "name": "<Brand / creator name>",
     "handle": "@<handle>",
     "cta": "<call to action>",
     "about": "<one paragraph: what they post and for whom>",
     "audience": "<who it's for>",
     "voice": "<tone + rules: sentence length, do/don't, framing>",
     "categories": ["<post type>", "<post type>"],
     "colors": { "bg": "#...", "surface": "#...", "ink": "#...", "muted": "#...", "accent": "#...", "accentSoft": "#...", "accent2": "#...", "line": "#..." },
     "fonts": { "headlineFamily": "<name>", "bodyFamily": "<name>", "googleFamily": "<Google+spec or omit>", "files": [ { "family": "<name>", "file": "headline.woff2", "weight": 800 } ] },
     "logo": { "file": "logo.svg", "height": 30 },
     "houseStyle": { "cards": "...", "dividers": "...", "accent": "...", "type": "...", "motifs": "...", "doNots": "..." },
     "background": { "grid": false }
   }
   ```
   Notes: omit `logo.file` to use a generated wordmark (set `logo.text` to override the name). Omit `fonts.files` for a Google font by name. Set `background.grid:true` only if the brand genuinely uses a grid. Any colour omitted falls back to a default.

7. **Validate and activate:**
   ```bash
   node "$ENGINE/brandctl.mjs" validate <slug>   # warns on missing voice / houseStyle
   node "$ENGINE/brandctl.mjs" use <slug>
   ```

8. **Prove it.** Ask whether to generate a test asset now (`AskUserQuestion`: `Yes, on a topic I'll give you` / `Yes, pick a topic from my categories` / `No, just save it`). If yes, hand off to the `create-asset` skill (or render one directly, below). Show the PNG, ask if the look, colours, fonts and voice are right, and tweak `brand.json` (especially `houseStyle`) until they're genuinely impressed. The kit is the single source of truth, so a tweak here improves every future asset.

   Direct one-off render (the `create-asset` skill automates this):
   ```bash
   echo '{"css":"...","body":"..."}' | node "$ENGINE/cli.mjs" --brand <slug> --shape ig-portrait --data - --out "$HOME/Desktop/<slug>-test.png"
   ```

9. **Hand them off. Never end this skill without doing this.** Onboarding is the only
   moment you can count on having the user's attention, and most will not read a README
   or remember a command they were shown once. So finish by telling them, in plain words,
   that the kit is saved and they never have to do this part again, then put the next
   step in front of them as a choice (`AskUserQuestion`, header `Next`):
   - `Teach it your taste (recommended)` — run `/collect-inspo` for them now. The kit you
     just built captures the brand's *current* look; inspiration captures what they
     *admire* (a Notion swipe file, posts they love, accounts to emulate), and
     `create-asset` reads both. This is the single biggest lift in output quality, so
     lead with it. Skip it only if they have nothing to feed in.
   - `Make my first post` — run `create-asset` right now; ask for the topic if they have
     not already said one. Do not just tell them the command exists, invoke it.
   - `Change something about the brand` — run `edit-brand`.
   - `I'm done for now` — close out, and in that case tell them the commands they will
     need later, once, in one line each: `/collect-inspo` to teach it the look they're
     going for, `/create-asset <topic>` to make a post, and `/edit-brand` to change the
     look, colours, fonts, voice, handle or CTA.

   Whichever they pick, make sure they leave knowing those commands and that
   `/create-brand` is finished with: it is a one-off, not something to re-run per post.
   Assume no technical background: name the commands exactly, and never say "the CLI",
   "the engine", "brand.json" or "the kit schema" to the user.

## Notes
- The brand kit carries the look; **inspiration** (via `/collect-inspo`) carries the taste; the **shape** and the **prompt** decide the content. Don't bake content structure into the kit.
- `examples/` are the brand's *own* posts. `inspiration/` is what they *admire*. Don't conflate them.
- To deliberately change a saved brand later, use `edit-brand` (edits the base kit). Tweaks *learned* automatically during a generate session are saved as `preferences.json` by `create-asset`.
