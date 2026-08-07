---
name: edit-brand
description: Change a saved brand kit deliberately and permanently. Walks the user through what to change (palette, fonts, logo, voice, house-style, handle/CTA, name), updates brand.json, and re-renders a test asset so they can see the effect. Use when the user says "edit my brand", "update the brand", "change the palette/font/logo/voice", "tweak the brand kit", or "the brand should look more like X".
---

# Edit a brand (deliberate, permanent changes to the kit)

Update a saved brand's base kit (`brand.json`). This is for intentional changes the user wants to stick: a new accent colour, a different headline font, a refined voice, a logo swap, a house-style adjustment. It edits the **base**, not the preferences overlay.

Two layers, don't confuse them:
- **`brand.json` (base)** — the deliberate definition of the brand. This skill edits it.
- **`preferences.json` (overlay)** — tweaks *learned automatically* during a `create-asset` session. Those are saved by `create-asset`, not here.

**Drive this with questions.** Use `AskUserQuestion` to direct the user through what they want to change.

`ENGINE="${CLAUDE_PLUGIN_ROOT}/engine"`.

## Steps

1. **Resolve the brand.** If named, use that slug; else:
   ```bash
   node "$ENGINE/brandctl.mjs" list
   ```
   No brands → tell them to run `create-brand` first and stop. One → use it. More than one → ask which (`AskUserQuestion`, header `Brand`, one option per saved brand).

2. **Read the current kit.**
   ```bash
   node "$ENGINE/brandctl.mjs" path <slug>
   ```
   Read `brandJson` so you're editing from the real current state, and note whether a `preferences` file exists (an overlay may be masking a base value: if so, tell the user).

3. **Ask what to change** (`AskUserQuestion`, `multiSelect: true`, header `Change`): `Palette / colours`, `Fonts`, `Logo`, `Voice`, `House style`, `Handle / CTA`, `Name / about`. Then, for each area they picked, gather the specifics:
   - **Palette**: which role(s) and the new hex(es). Roles: `bg`, `surface`, `ink`, `muted`, `accent`, `accentSoft`, `accent2`, `line`. Sample from any reference they give; don't invent.
   - **Fonts**: new `headlineFamily`/`bodyFamily`; a Google font name (set `googleFamily`) or an uploaded file (copy into `assets/`, add to `fonts.files`).
   - **Logo**: a new file (copy into `assets/`, set `logo.file` + `height`), or switch to a generated wordmark (remove `logo.file`, set `logo.text`).
   - **Voice**: capture the refined tone in their words.
   - **House style**: which of `cards`/`dividers`/`accent`/`type`/`motifs`/`doNots` changes, and how.
   - **Handle / CTA / Name / about**: the new values.

4. **Apply the change.** Edit `brand.json` at the `brandJson` path (Edit tool for targeted changes; Write only if rewriting wholesale). Copy any new asset files into the `assets` dir first. Change only what they asked for; leave the rest intact.

5. **Validate.**
   ```bash
   node "$ENGINE/brandctl.mjs" validate <slug>
   ```

6. **Show the effect.** Re-render a quick test asset so they see the change (reuse a recent topic, or a simple one from their categories):
   ```bash
   echo '{"css":"...","body":"..."}' | node "$ENGINE/cli.mjs" --brand <slug> --shape ig-portrait --data - --out "$HOME/Desktop/<slug>-edit-test.png"
   ```
   Read the PNG. Ask (`AskUserQuestion`, header `Result`): `Keep it`, `Adjust more`, `Revert`. Iterate until they're happy. The change is now permanent for every future asset.

## Notes
- If a `preferences.json` value is overriding the base field they're editing, the change won't show until the preference is updated or removed. Surface this and ask whether to clear the relevant preference.
- For a one-off look that shouldn't change the brand, don't edit here: just ask for it inside `create-asset`.
- Never distort the logo or any image to fit; maintain aspect ratio.
