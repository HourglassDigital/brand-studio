# debug.md — Brand Studio plugin

Accumulated debugging context and non-obvious gotchas for this plugin.

## Patterns

### Plugin shows "✘ failed to load" — duplicate hooks declaration (2026-06-16)

**Symptom:** After `claude plugin install brand-studio@hourglass`, `claude plugin list`
shows `Status: ✘ failed to load`, even though `claude plugin details` parses the manifest
and lists all skills/hooks correctly.

**Root cause:** `.claude-plugin/plugin.json` declared `"hooks": "./hooks/hooks.json"`.
Claude Code **auto-loads** `hooks/hooks.json` from the plugin root, so declaring it in the
manifest loads it a second time. The real error (only visible via
`claude plugin list --json` → `errors[]`, not in `details`) is:
"Hook load failed: Duplicate hooks file detected: ./hooks/hooks.json resolves to
already-loaded file ... The standard hooks/hooks.json is loaded automatically, so
manifest.hooks should only reference additional hook files."

**Fix:** Remove the `"hooks"` field from `plugin.json`. The hook at `hooks/hooks.json`
still loads automatically. Bump the version so a reinstall takes a fresh cache copy
(installs are cached at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`).

**Lesson:** The standard `hooks/hooks.json`, `skills/`, `agents/`, `commands/` are
auto-discovered. Only put a path in `plugin.json` for files OUTSIDE those standard
locations. To see a load error, use `claude plugin list --json` (the `errors` array),
not `claude plugin details` (which only validates the manifest, not the load).

### marketplace.json in .claude-plugin is fine (2026-06-16)

A single repo can be both the marketplace and the plugin: `.claude-plugin/` may hold both
`marketplace.json` and `plugin.json`. This does NOT cause a load failure (verified: the
official `vercel` plugin ships both in its installed cache copy and loads cleanly). Don't
chase marketplace.json when debugging a load error; check the `errors[]` array first.

### Legibility gate: translucent backdrop measured as white-on-white (2026-08-04)

**Symptom:** White text on a translucent dark chip (the attribution pill,
`rgba(17,17,17,0.6)`) over a light page failed the contrast check at exactly `1.00:1`,
though it renders perfectly legible.

**Root cause:** In `legibility.mjs`, the backdrop walk iterated the element stack
top-down but composited backwards: a translucent layer was blended over the accumulated
backdrop, then an opaque layer deeper in the stack *replaced* the accumulation (`backdrop
= p.a >= 1 ? p : over(p, backdrop)`), discarding every translucent layer above it. The
pill vanished from the calculation and white text was measured against the white frame.

**Fix:** Accumulate front-to-back (`acc = over(acc, p)` so each deeper layer slides
*under* what is already gathered), stop after the first opaque layer, then flatten over
page white. Regression tests: "translucent dark chip over a white page passes" and "a
chip too faint to help still fails" in `test/legibility.test.mjs`.

**Lesson:** When compositing a hit-test stack, direction matters twice: iteration order
AND blend order. An opaque layer ends the walk but must not replace what is above it. The
exact `1.00:1` ratio was the tell that both colours came out identical.

### Mono logo variant flattened a multi-colour lockup into a blob (2026-08-07)

**Symptom:** `{{logo-light}}` on a badge-style kit rendered a featureless white oval
instead of the logo. The render *succeeded*: no error, no gate finding, and the asset
looked finished apart from the logo.

**Root cause:** `monoStyle()` in `brand.mjs` emits
`.cls svg *:not([fill="none"]){fill:<colour>}`, painting every filled shape one colour.
That is correct for a single-colour wordmark and destructive for a lockup whose meaning
lives in the contrast between stacked fills. The mark in question is an outer ring around
a band around a filled field with the letters knocked out of it, so flattening welded all
four into one silhouette. Not a format problem: a transparent PNG under
`filter: brightness(0) invert(1)` produces the identical blob, which is worth knowing
before reaching for a different logo source.

**Fix:** `logo()` now counts distinct non-`none` fills before flattening and throws when
there is more than one, naming both remedies (`logo.light` in brand.json, or `{{logo}}`).
Strokes are ignored: an outline flattened to one colour is still an outline; it is
stacked *fills* that merge. Regression tests in `test/logo.test.mjs`.

**Lesson:** Follow the repo's own rule that a variant which cannot be honoured must fail
loudly (see the header of `test/logo.test.mjs`). A silent wrong-looking render is worse
than a hard error, because the gate only measures text and nothing else was watching.

### The `==highlight==` contract was documented but never wired (2026-08-07)

**Symptom:** `==TIGHT LINES.==` reached the PNG as literal text, equals signs and all.

**Root cause:** `util.mjs` exported `inline()`, which does the conversion, and nothing
imported it: `grep -rn "from.*util"` across `engine/` returned no hits. The skill
documented the syntax, so every authored asset used it and every render baked it in.

**Fix:** Added `marks()` (converts without escaping, since the asset body is authored
HTML and `inline()` would print the tags) and called it in `cli.mjs` on the body *before*
placeholder substitution, so engine-injected logo SVG is never scanned. Regression test
in `test/markup.test.mjs` renders the shorthand and the `<mark>` tag and asserts the two
PNGs are byte-identical.

**Lesson:** A documented contract with no importer is not a feature. When a helper exists
for a documented behaviour, check it is actually called before assuming the behaviour
works; the unit test on the helper would have passed the whole time.

## Environment notes

- Render needs a Chromium/Chrome. `engine/render.mjs` auto-detects Google Chrome or a cached
  Playwright Chromium; no browser download is forced. The `SessionStart` hook (`engine/setup.sh`)
  only installs the `playwright-core` npm dep.
- When run as an installed plugin, brands save under the plugin's data dir
  (`${CLAUDE_PLUGIN_DATA}`, e.g. `~/.claude/plugins/data/brand-studio-<marketplace>/`). When
  the engine is run directly (tests, ad-hoc), it falls back to `~/.brand-studio`. These are
  separate stores: a brand made one way won't appear in the other.
