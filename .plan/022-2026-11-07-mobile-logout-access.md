Status: done
Owner: Ilana
Last updated: 2026-11-08

# Make Logout reachable on mobile

## Goal
A signed-in user on a phone-width screen can see and use Logout without scrolling
sideways or guessing. Today the only path to Logout is the header gear menu
(`web/src/cmps/SettingsMenu.vue`), and on a narrow viewport that gear is not
visibly reachable.

## Scope
- In scope (frontend only, `web/`):
  - `web/src/App.vue` — header markup, only if Option B below is chosen.
  - `web/src/styles/basics/layout.scss` and `web/src/styles/cmps/nav.scss` /
    `menu.scss` — responsive header layout.
  - `web/src/cmps/SettingsMenu.vue` and its spec — only if the menu needs a
    mobile-specific change.
  - Tests for the above.
- Out of scope: `api/`, auth logic (`auth.store.ts` logout flow is unchanged),
  desktop header appearance, any new route or page.

## Assumptions
- **Root cause (read from code, not yet reproduced on a device).**
  `.app-header` is one non-wrapping `display: flex` row holding the brand text,
  a three-link nav, the theme toggle, the avatar and the gear. Nothing in
  `web/src/styles/` has a media query, so below roughly 480px the items cannot
  fit. The `.app-nav` has `flex-wrap`, but the header itself does not, so the
  right-hand controls (including the gear) are pushed past the viewport edge.
- `index.html` already sets `width=device-width`, so the viewport itself is fine.
- `.menu-panel` is `right: 0` anchored to the gear; once the gear is on screen
  the panel opens inside the viewport.
- Rules respected: SCSS only under `web/src/styles/`, no `<style>` blocks, CSS
  custom properties for tokens, no trailing semicolons in JS/TS.

## Open Questions
1. **How should Logout be exposed on mobile?**
   - Option A (**recommended**): keep the existing gear menu, make the header
     wrap on small screens (brand on row one; nav, theme toggle, avatar and gear
     on row two). One Logout path, no markup change, no duplicated control.
   - Option B: add a dedicated icon-only Logout button (`LogOut` icon, same icon
     as the menu item) in the header at small widths, next to the avatar. Faster
     (one tap) but a second Logout control to maintain.
2. **Breakpoint.** Recommended: `40rem` (640px) as a Sass variable, because media
   queries cannot read CSS custom properties. Alternative: `30rem`.
3. **Brand text on phones.** Recommended: keep the full text (it wraps to its own
   row under A). Alternative: show only the icon below the breakpoint.

## Steps
1. Reproduce: run `web/` at 360px and 390px widths and confirm the gear is
   clipped or off-screen (record the finding in the QA report).
2. Add a `$bp-sm` Sass variable in `web/src/styles/setup/variables.scss`
   (outside the `:root` / `[data-theme]` blocks so `variables.spec.ts` is
   unaffected) and use it in the header styles.
3. Option A: in `layout.scss`, below `$bp-sm`, let `.app-header` wrap and give
   the brand full width; keep `.theme-toggle` auto-margin so controls stay
   right-aligned. In `nav.scss`, let `.app-nav` take its own row with no left
   indent.
   Option B (if chosen): add the Logout button to `App.vue`, show it only below
   `$bp-sm`, and reuse the logout handler (move it to a shared helper or the
   store, no duplicated logic).
4. Make sure every header control has a tap target of at least 2.75rem on small
   screens (`.menu-trigger`, `.theme-toggle`, `.avatar`, `.nav-link`).
5. Add tests (see Validation).
6. Run `cd web && npm test`, `npx vue-tsc --noEmit`, `npm run lint`.

## Validation
QA checklist, each item provable:
- [ ] At 360px and 390px viewport width, the settings gear button is fully inside
      the viewport and the page has no horizontal scroll (manual check plus a
      note in `.orchestrate/qa-report.md`).
- [ ] Opening the gear menu on a narrow viewport shows "User settings" and
      "Logout" fully inside the viewport.
- [ ] Clicking Logout on mobile still clears the user, calls the backend logout,
      and lands on `/login` (existing `SettingsMenu.spec.ts` logout test passes
      unchanged).
- [ ] A signed-out visitor on `/login` still sees only brand and theme toggle.
- [ ] Desktop header layout above the breakpoint is unchanged (visual check at
      1024px).
- [ ] If Option B: a component test asserts the mobile Logout button calls the
      same logout flow and is absent for signed-out users.
- [ ] `npm test`, `npx vue-tsc --noEmit`, `npm run lint` all pass in `web/`.

## Risks
- The root cause is inferred from code; a device check in Step 1 may show a
  different cause (for example the menu panel clipping, not the gear). Step 1
  gates the rest.
- Wrapping the header adds height on phones and may shift page content; check the
  Interview and Report views.
- Option B duplicates a control and can drift from the menu behaviour.

## Rollout Order
1. Branch `feat/mobile-logout-access` (this branch).
2. Frontend implementation and tests.
3. QA pass against the Validation list.
4. Human review, then merge approval (no commit or merge without approval).

## Rollback
Revert the branch commit(s). The change is CSS plus, at most, one header button,
with no data, API, or schema impact.
