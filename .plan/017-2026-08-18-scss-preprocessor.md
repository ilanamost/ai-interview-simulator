Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-18

# SCSS Preprocessor: Migrate `web/` Styling from Plain CSS to Sass

## Goal
Add a CSS preprocessor to `web/` and move the whole stylesheet tree onto it. Backlog
source: `.plan/000-backlog.md`: *"Add a css preprocessor and use it for styling. Instead
of regular css, use scss."*

Concretely, this plan does four things:

1. Adds `sass` as a `web/` devDependency. Vite has built-in Sass support and needs **no
   plugin and no `vite.config.ts` change** — the dependency alone activates it.
2. Renames all **21** stylesheets under `web/src/styles/` from `.css` to `.scss` and
   converts their `@import` rules to the modern Sass module system (`@use`).
3. Re-points the **three spec files that read stylesheet source off disk by hard-coded
   path**, which would otherwise fail the moment the files are renamed.
4. Rewrites `.claude/rules/ui-and-styling.md`, which today states as an always-on
   constraint that "`web/` is styled with plain CSS".

Point 4 is not housekeeping — it is the reason this plan touches a rules file at all.
`.claude/rules/` is imported by `AGENTS.md` into *every* agent session. If the rule keeps
saying "plain CSS" after this ships, every future agent is instructed to undo this task,
and the repository's stated truth contradicts its actual contents. The rule file changes
in the same commit as the migration or the migration is not finished.

This is a **pure format migration**. No selector, declaration, token value, or cascade
order changes. The compiled production CSS bundle should come out byte-identical to the
pre-migration bundle, and that equivalence is the primary validation (see `Validation`).

## Scope

**In scope** — `web/` only, plus the one rules file:

- `web/package.json` — add `sass` to `devDependencies`; `web/package-lock.json` updated.
- All 21 stylesheets under `web/src/styles/`, renamed `.css` → `.scss`:

  | Folder | Files |
  |---|---|
  | (root) | `main.css` |
  | `setup/` | `index.css`, `variables.css`, `reset.css` |
  | `basics/` | `index.css`, `base.css`, `layout.css` |
  | `cmps/` | `index.css`, `animation.css`, `card.css`, `button.css`, `form.css`, `badge.css`, `progress.css`, `voice.css`, `accordion.css`, `home.css`, `menu.css`, `auth.css`, `nav.css`, `history.css` |

  1140 lines total.
- `web/src/main.ts` — line 5, `import './styles/main.css'` → `'./styles/main.scss'`.
- Three spec files that `readFileSync` stylesheet source by path:
  - `web/src/styles/setup/variables.spec.ts` (`src/styles/setup/variables.css`)
  - `web/src/styles/ua-chrome-theming.adversarial.spec.ts` (`./setup/variables.css`,
    `./basics/base.css`, `./cmps/form.css`)
  - `web/src/views/card-animation.adversarial.spec.ts` (`src/styles/cmps/animation.css`)
- Comment references to `*.css` paths in `web/src/App.vue:51`,
  `web/src/services/animation.service.ts:3,13`, `web/src/styles/basics/base.css:12`,
  `web/src/styles/cmps/animation.css:2`.
- `.claude/rules/ui-and-styling.md` — rewritten (exact wording in Step 8).

**Out of scope:**

- `api/`. This task carries no `stack:full` marker and is a `web/` build-tooling and
  styling change. Nothing server-side is touched.
- `vite.config.ts`. Vite detects `sass` automatically; adding
  `css.preprocessorOptions.scss` config would be dead weight. Explicitly a non-change.
- **Introducing Sass language features.** No nesting, mixins, `@each`, colour functions,
  or Sass variables are added in this task. Converting the syntax and *using* the syntax
  are separate risks; bundling them makes the "compiled output is identical" validation
  impossible to run. See Open Question 3.
- Any visual, token, or behavioural change. Same pixels, same themes.
- `web/eslint.config.js` — it lints `**/*.ts` and `**/*.vue` only and never saw the CSS.
  No change needed. `npm run format` (`prettier --write src`) already handles `.scss`
  natively with no config change.

## Assumptions

- **Vite 6 compiles `.scss` with only the `sass` dependency present.** Confirmed against
  `web/package.json`: `vite ^6.0.5`. Vite's Sass support is built in and activates on
  dependency presence; no plugin, no config.
- **All styling lives in the global stylesheet tree.** Verified: `grep -rn "<style" web/src`
  returns nothing. There is not a single SFC `<style>` block in the app, so there is no
  second migration surface and no `lang="scss"` attribute to add anywhere.
- **`main.ts` is the only runtime importer of a stylesheet.** Verified: the only
  `.css` import in application code is `web/src/main.ts:5`.
- **Every current `@import` is a plain relative sibling load with no media query or
  `supports()` condition.** Verified across `main.css`, `setup/index.css`,
  `basics/index.css`, `cmps/index.css` — 19 imports, all bare relative paths. This is what
  makes the `@use` conversion mechanical.
- **SCSS is a strict superset of the CSS in this repo.** These files use only standard
  declarations, custom properties, media queries, and `/* */` comments. No `//`, no
  interpolation-hostile syntax. A rename alone compiles.
- **The three disk-reading specs assert on *source* text, not compiled output.** They stay
  valid after the rename provided the file *contents* are unchanged — which this plan
  guarantees — and provided their path constants are updated.
- **CI's `npm ci` runs on `ubuntu-latest` while the lockfile is generated on Windows.**
  Confirmed in `.github/workflows/deploy-pages.yml`. This drives the `sass` vs
  `sass-embedded` decision below.

## Open Questions

**1. `sass` or `sass-embedded`?**
*Recommended: `sass`.* `sass-embedded` is faster, but it ships per-platform native
binaries as npm `optionalDependencies`. This repo's `web/package-lock.json` is generated
on Windows and `.github/workflows/deploy-pages.yml` runs `npm ci` on `ubuntu-latest` —
exactly the configuration where npm's known optional-dependency lockfile bug omits the
Linux binary and breaks the Pages build. `sass` is pure JavaScript with no platform
binaries and cannot hit that failure. The stylesheet tree is 1140 lines; compile speed is
not a real constraint here. Swapping to `sass-embedded` later is a one-line change if it
ever matters.

**2. Underscore-prefixed partials (`_variables.scss`) or plain names (`variables.scss`)?**
*Recommended: plain names, no underscore.* The underscore's only job is to stop Sass
emitting a standalone `.css` file per partial when compiling a whole directory. Vite does
not compile directories — it compiles the module graph reachable from `main.ts`, so
nothing is emitted standalone regardless. Meanwhile the underscore would turn the three
spec files' path updates from a pure extension swap into a rename plus a path edit, and
would make the rules file's folder listing diverge from the real filenames. Consistency
with the existing `index.css` barrel convention (which has no underscore either) wins.

**3. Does this task also start *using* Sass features (nesting, mixins), or only convert
the format?**
*Recommended: format only.* The backlog asks to "use scss" for styling, and after this
plan all styling *is* SCSS — the capability is live and the next styling task gets nesting
for free. Rewriting 1140 lines of working, theme-tested CSS into nested form in the same
change would forfeit the byte-identical-output validation that proves this migration is
safe, and would put a large hand-written diff in front of QA with no way to distinguish an
intentional restructure from an accidental cascade change. Adopt features incrementally,
in the tasks that touch those files anyway.

**4. Re-point the three disk-reading specs by editing their path constants, or make them
extension-agnostic (glob for `variables.*`)?**
*Recommended: edit the constants.* A glob hides exactly the breakage those tests exist to
catch — if someone deletes `variables.scss`, a glob quietly matches nothing or matches a
stale file, whereas a hard path throws a clear `ENOENT`. The paths are four string
literals across three files.

**5. Should `main.scss` keep loading the three barrels, or flatten to load the 20 leaf
files directly?**
*Recommended: keep the barrels.* The `setup/` → `basics/` → `cmps/` ordering is
load-bearing cascade order and is documented in the rules file. Flattening would move that
ordering contract into one long list and make an accidental reorder easier, not harder.

## Steps

1. **Capture the baseline.** Before changing anything, on the current commit run
   `cd web && npm ci && npm run build`, and copy the emitted CSS bundle out of
   `web/dist/assets/` to a scratch location. This is a production (minified) build, so
   comments and whitespace are already normalised away — it is the artifact Step 12 diffs
   against. Also record the passing test count from `npm test`.

2. **Add the dependency.** `cd web && npm install --save-dev sass`. Confirm `sass` lands
   in `devDependencies` and that `web/package-lock.json` is updated. Make **no** change to
   `web/vite.config.ts` — its built-in Sass handling needs no configuration, and the file
   has hand-written comments about the Pages `base` and the 404 entry that must not be
   disturbed.

3. **Rename all 21 stylesheets** under `web/src/styles/` from `.css` to `.scss` using
   `git mv`, so history follows each file. Do not edit any file contents in this step —
   keeping the rename and the edits as separable operations is what makes a bad diff
   reviewable.

4. **Convert the four barrel/entry files from `@import` to `@use`.** Sass has deprecated
   `@import`; `@use` is the module system that replaces it. URLs are relative and
   extensionless, and `@use` rules must sit at the top of the file (the leading comment in
   `main.scss` is fine — comments are not rules).

   `web/src/styles/main.scss`:
   ```scss
   /* Entry point. Order matters: tokens and reset, then base elements, then components. */
   @use './setup/index';
   @use './basics/index';
   @use './cmps/index';
   ```

   `web/src/styles/setup/index.scss` → `@use './variables'`, `@use './reset'`.
   `web/src/styles/basics/index.scss` → `@use './base'`, `@use './layout'`.
   `web/src/styles/cmps/index.scss` → the same 13 entries, same order:
   `animation, card, button, form, badge, progress, voice, accordion, home, menu, auth,
   nav, history`.

   **Order is cascade order** — a module's CSS is emitted where it is first loaded. Preserve
   the existing sequence exactly in all four files.

   Note on `@use` vs `@forward`: `@forward` exists to re-export *Sass members* (variables,
   mixins, functions) through a barrel. These files define none — every design token is a
   CSS custom property, which is a runtime cascade value, not a compile-time Sass symbol.
   So `@use` is sufficient and correct here, and `@forward` would add ceremony with no
   effect. This is also why the `@import` → `@use` switch requires **zero changes to token
   references**: `var(--clr-accent)` in `card.scss` resolves through the CSS cascade at
   runtime and never went through Sass's module resolution at all.

   One behavioural difference worth knowing: `@use` loads a module **once** even if
   several files load it, whereas `@import` would re-emit it. No file here is loaded twice,
   so the output is unaffected — but it is why adding a duplicate `@use` later is safe.

5. **Update the runtime import.** `web/src/main.ts` line 5:
   `import './styles/main.css'` → `import './styles/main.scss'`.

6. **Re-point the three disk-reading spec files.** These read stylesheet *source* text and
   will throw `ENOENT` the moment Step 3 lands:
   - `web/src/styles/setup/variables.spec.ts` — the `CSS_PATH` constant, to
     `src/styles/setup/variables.scss`. Its surrounding comment explains it reads from disk
     because "vitest stubs CSS modules to an empty string"; that reasoning is unchanged by
     the rename, so keep the comment.
   - `web/src/styles/ua-chrome-theming.adversarial.spec.ts` — the three `read(...)` calls,
     to `./setup/variables.scss`, `./basics/base.scss`, `./cmps/form.scss`.
   - `web/src/views/card-animation.adversarial.spec.ts` line 214 — to
     `src/styles/cmps/animation.scss`.

   Rename paths only. Do not touch the assertions: they guard plan 011's and plan 015's
   theming work, and this plan changes none of it.

7. **Update stale `.css` path references in comments** so the codebase does not document
   filenames that no longer exist: `web/src/App.vue:51`,
   `web/src/services/animation.service.ts:3` and `:13`, `web/src/styles/basics/base.scss:12`,
   `web/src/styles/cmps/animation.scss:2`.

8. **Rewrite `.claude/rules/ui-and-styling.md`.** The `Libraries` section is unaffected and
   stays verbatim. Replace the `Styling engine` and `Design tokens` sections with:

   ```md
   ## Styling engine
   `web/` is styled with SCSS, compiled by Vite's built-in Sass support (no Tailwind, no
   CSS-in-JS). `web/src/styles/main.scss` is the entry point and loads, in order:
   - `setup/` — `variables.scss` (design tokens), `reset.scss`, `index.scss`
   - `basics/` — `base.scss`, `layout.scss`, `index.scss`
   - `cmps/` — one file per component family (`button.scss`, `card.scss`, `form.scss`,
     `badge.scss`, `progress.scss`, `voice.scss`, …), plus `index.scss`

   Load a stylesheet with `@use`, never `@import` — Sass has deprecated `@import`. `@use`
   rules go at the top of the file and take a relative, extensionless URL:
   `@use './variables'`. Load order is emit order, and emit order is cascade order, so
   never reorder a barrel casually.

   Add new component styles under `web/src/styles/cmps/` and load them from that folder's
   `index.scss`. Do not add inline styles, a `<style>` block in a `.vue` file, or a
   CSS-in-JS/Tailwind dependency.

   ## Design tokens
   - Prefer CSS custom properties for colors, spacing, sizing, and other shared tokens.
     They resolve at runtime, which is what lets one token set drive both themes. Sass
     variables are compile-time and cannot do that — reach for them only for values that
     never vary per theme.
   - Declare tokens in `:root` in `web/src/styles/setup/variables.scss`.
   - Use nesting where it improves scoping and readability, but keep the `:root` and
     `[data-theme]` token blocks in `variables.scss` flat: `variables.spec.ts` parses each
     theme block by slicing to its first closing brace, so a nested rule inside one would
     truncate what the test reads.
   ```

9. **Check for a `docs/` directory.** There must not be one, and this plan creates none.

10. Run `npm run format` and `npm run lint` in `web/`, then fix anything they flag.

11. Run the full suite: `cd web && npm test`.

12. **Prove the migration is a no-op.** `cd web && npm run build`, then diff the emitted
    CSS bundle against the Step 1 baseline. Expect no difference. If there is one, the
    cause is almost certainly a load-order slip in Step 4 — fix the order rather than
    accepting the diff.

13. Manual visual pass in `npm run dev`, in **both** light and dark themes, covering the
    areas the existing adversarial specs care about: the `input[type="date"]` calendar
    glyph (plan 015), custom scrollbars (plan 010), card entry animations on `/reports/:id`
    (plan 015), nav active-link indication (plan 013), and the home accordions (plan 008).

## Validation

QA's checklist. Each item is provable by a command or a stated observation.

1. `cd web && npm ci` completes with `sass` present in `devDependencies`.
2. `cd web && npm run build` exits 0 — this runs `vue-tsc --noEmit && vite build`, so it
   covers both type-checking and Sass compilation.
3. `cd web && npm test` — every spec passes, and the total count is **at or above** the
   Step 1 baseline. No spec was deleted or skipped to make the rename pass.
4. **The three disk-reading specs pass against `.scss` sources**, specifically
   `variables.spec.ts`, `ua-chrome-theming.adversarial.spec.ts`, and
   `card-animation.adversarial.spec.ts`. These are the ones the rename would silently
   break; they must be green, not merely present.
5. `cd web && npm run lint` exits 0 with `--max-warnings 0`.
6. `cd web && npx prettier --check src` exits 0.
7. **No `.css` file remains in the styles tree**: `find web/src/styles -name '*.css'`
   returns nothing.
8. **No `@import` remains**: `grep -rn "@import" web/src/styles/` returns nothing. Every
   load is `@use`.
9. **No stale `.css` reference remains in `web/src`**: `grep -rn "\.css" web/src/` returns
   nothing (comments included).
10. **The production CSS bundle is unchanged** versus the Step 1 baseline. This is the
    single strongest signal that no cascade order or declaration changed.
11. `.claude/rules/ui-and-styling.md` no longer contains the string "plain CSS", names
    `main.scss` as the entry point, and prescribes `@use` over `@import`. Reading the rule
    file cold must describe the repository as it now actually is.
12. No file under `api/` is modified: `git diff --name-only master... -- api/` is empty.
13. No `docs/` directory exists.
14. Manual, in both themes: date-picker glyph follows the theme, scrollbars are themed and
    thin, `/reports/:id` cards animate in, the active nav link is indicated, and the home
    accordions open and close. No new console errors or warnings.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Cascade order changes during the `@import` → `@use` rewrite.** Emit order is cascade order; a reordered barrel silently changes which rule wins, and the result is a subtle visual regression no unit test catches. | Medium | High | Validation 10 diffs the compiled production bundle against the pre-migration baseline. This is the specific failure that check exists to catch. |
| **The three disk-reading specs fail with `ENOENT` after the rename.** Certain, not hypothetical — the paths are hard-coded string literals. | Certain if missed | High | Step 6 handles all four literals explicitly; Validation 4 names those specs individually rather than trusting an aggregate pass. |
| **Someone later adds Sass nesting inside a `:root`/`[data-theme]` block in `variables.scss`**, breaking `variables.spec.ts`'s `block()` helper, which slices to the first `}` and would silently truncate. | Medium (post-merge) | Medium | The rewritten rules file (Step 8) states the flat-block constraint explicitly, so it is in every future agent session's always-on context. |
| **`sass-embedded`'s platform binaries break the Pages CI build** if chosen over `sass` — lockfile generated on Windows, `npm ci` run on `ubuntu-latest`. | Medium if chosen | High | Open Question 1 recommends `sass`, which has no native binaries and cannot hit this. |
| **The rules file is not updated**, leaving `.claude/rules/` telling every future session that `web/` is plain CSS — agents would then "fix" this migration back. | Low, given Step 8 | High | Step 8 is a required step and Validation 11 is a blocking check. Rule change ships in the same commit as the migration. |
| **`git mv` history is lost** if files are copied-and-deleted instead of moved, making `git log --follow` useless on 21 files. | Low | Low | Step 3 specifies `git mv`. |
| **Scope creep into nesting/mixins**, producing a large hand-written diff that defeats the byte-identical validation. | Medium | Medium | Open Question 3 and `Scope` both exclude it. If the diff shows restructured declarations, the plan was not followed. |

## Rollout Order

Single branch, single reviewable commit — the rename and the rule change must not be
separable, or a checkout between them describes itself wrongly.

1. Branch `feat/scss-preprocessor` off `master` (per `.claude/rules/git-workflow.md`;
   never work on `master`).
2. Baseline capture — Step 1. Must happen before any change.
3. Dependency — Step 2.
4. Mechanical rename — Step 3 (`git mv`, no content edits).
5. Barrel conversion and import updates — Steps 4–5.
6. Test and comment path updates — Steps 6–7.
7. Rules file rewrite — Step 8.
8. Housekeeping check — Step 9.
9. Format, lint, test, build, diff — Steps 10–12.
10. Manual visual pass in both themes — Step 13.
11. Commit only after explicit approval, per `.claude/rules/git-workflow.md`. Suggested
    subject: `migrate web styling to scss`.

Steps 4–8 are one logical unit; do not stop between them. Nothing here depends on `api/`
and no deployment change is required — `.github/workflows/deploy-pages.yml` runs `npm ci`
and `npm run build`, both of which pick up Sass with no workflow edit.

## Rollback

Cheap and complete at every stage.

- **Before merge:** delete the branch. `master` is untouched.
- **After merge:** `git revert` the migration commit. It restores the 21 `.css` files, the
  `main.ts` import, the spec paths, the comment references, and the rules file wording in
  one move — which is precisely why they ship together. `npm ci` afterwards drops `sass`
  again.
- **Partial rollback is not supported and must not be attempted.** Reverting the rename
  while keeping the rules file (or vice versa) leaves the repository describing itself
  incorrectly, which is the failure mode this plan exists to prevent.
- **No data, schema, or API surface is involved**, so there is nothing to migrate back and
  no deployed state to reconcile. The worst case is a visual regression, caught by the
  Step 1 baseline diff before merge, and reversible by revert after.
