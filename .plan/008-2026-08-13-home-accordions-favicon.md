Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-13

# Home Page Accordions and Favicon

## Goal
Turn the home page's three explanatory sections into collapsible accordions and
give the app a favicon. Backlog source: `.plan/000-backlog.md` item 1 (post-auth
queue): *"In home page, I want the titles: 'What it does', 'How it works' and
'Key features' to be collapsible accordions. Also, Add a favicon to the
application."*

## Scope
- Frontend-only (`web/`). No `stack:full` marker on this backlog item, and
  nothing here needs `api/`.
- In scope:
  - `web/src/views/HomeView.vue`: three collapsible sections titled "What it
    does", "How it works", "Key features".
  - A favicon, wired into `web/index.html`.
- Out of scope: any other backlog item (Pinia store refactor, reports history
  route) — separate plans.

## Assumptions
- **"What it does" is a new explicit section, not a relabeling of the hero.**
  `HomeView.vue`'s current hero (`<section class="home-hero">`) has no `<h2>` and
  carries the pitch + CTA — it should stay as a non-collapsible intro, exactly as
  a landing page's hero normally isn't itself an accordion. Its second paragraph
  ("Built for candidates from entry level to senior...", the problem/solution
  copy) is the natural content for a new "What it does" accordion, since the
  backlog explicitly names three titled sections and today there are only two
  (`How it works`, `Key features`) plus an untitled hero.
- **Default open/closed state:** all three start collapsed on first load (per
  human feedback on this plan) and each toggles independently.
- **Favicon format:** an inline SVG favicon under `web/public/favicon.svg`,
  referenced from `index.html`. No existing image asset pipeline exists in
  `web/` (`web/public/` doesn't exist yet, no raster icon anywhere in the repo)
  and generating a raster PNG/ICO isn't practical for an agent to do well —
  an SVG favicon is broadly supported by every current evergreen browser and
  needs no build step. Keep it visually consistent with the header's
  `MessagesSquare` (`lucide-vue-next`) brand icon so the browser tab and the
  in-app brand mark read as the same product.

## Open Questions
None — both open questions above are resolved: collapsed-by-default accordions
(explicit human feedback on this plan) and an SVG favicon (stated default,
unchallenged).

## Steps
1. New `web/src/cmps/Accordion.vue`: a small, reusable disclosure component
   (`title` prop, default slot for body, `defaultOpen` prop). Use a native
   `<details>`/`<summary>` pair if that satisfies `.rule/ui-rules.md`'s
   accessibility expectations (keyboard support and screen-reader semantics come
   free) — otherwise a `button` + `aria-expanded` + `v-show` pattern. Chevron
   icon from `lucide-vue-next` (`ChevronDown`, rotated via CSS when open) reused
   for all three, per `.claude/rules/ui-and-styling.md`'s "reuse the same icon
   name for the same concept" rule — check `web/src/cmps/` first in case a
   chevron/expand icon is already used somewhere for a different disclosure
   pattern.
2. `web/src/views/HomeView.vue`: wrap the "What it does" (new), "How it works",
   and "Key features" sections' bodies in `<Accordion>`, each independently
   toggleable and collapsed by default. Keep the hero section as-is (not an
   accordion). The hero's "See how it works" link (`#how-it-works`) must still
   land on an *open* section, not a collapsed one with nothing visible under
   the scrolled-to heading — since every accordion now starts closed, this is a
   live concern, not a deferred one. Have that link open the "How it works"
   accordion (e.g. a click handler that sets its `open` state before/with the
   scroll) rather than only relying on the browser's native hash-scroll.
3. New stylesheet `web/src/styles/cmps/accordion.css`, imported from
   `web/src/styles/cmps/index.css` — tokens from `variables.css`, no inline
   styles, per `.claude/rules/ui-and-styling.md`.
4. `web/public/favicon.svg`: a small inline SVG, on-brand with the header's
   `MessagesSquare` icon (same silhouette/spirit, simplified for a 16-32px
   canvas). `web/index.html`: add `<link rel="icon" type="image/svg+xml"
   href="/favicon.svg" />` in `<head>`.

## Validation
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — new/updated
  tests cover: each accordion section renders collapsed/expanded and toggles on
  click (and on Enter/Space if not using native `<details>`), all three start
  collapsed, toggling one doesn't affect the others, the "See how it works"
  hero link actually opens the "How it works" accordion (not just scrolls to a
  closed one), and the existing home-page navigation/content tests
  (`HomeView.spec.ts`, `home-navigation.spec.ts`) still pass with the new
  structure.
- Manual: `npm run dev`, confirm the browser tab shows the new favicon and the
  three home sections collapse/expand independently without layout shift in the
  surrounding page.

## Risks
- `HomeView.spec.ts` and `home-navigation.spec.ts` (added during the auth work)
  may assert on the current DOM structure/text of these sections — expect to
  update selectors, not loosen assertions.
- An SVG favicon is unsupported in a few older/niche browsers (notably older
  Safari); acceptable given `.doc/product-definition.md`'s local-dev-only,
  no-deployment-target constraints for this stage.

## Rollout Order
1. `Accordion.vue` + its styles.
2. `HomeView.vue` wired to use it, plus its tests.
3. Favicon.
4. QA pass.

## Rollback
Purely additive/presentational — revert the branch's merge commit to restore
the always-expanded sections and the missing favicon; no data or API surface
touched.
