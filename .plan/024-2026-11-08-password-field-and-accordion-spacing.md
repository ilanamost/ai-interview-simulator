Status: done
Owner: Ilana
Last updated: 2026-11-08

# Empty password field on load and accordion content spacing

## Goal
1. On the Login and Signup screens the password field is empty until the user types.
2. On the Home page, an open accordion shows a visible gap between its header and
   its content.

## Scope
- In scope (frontend only, `web/`):
  - `web/src/views/LoginView.vue` — password input attributes, only if the cause is
    browser autofill (see Assumptions).
  - `web/src/styles/cmps/accordion.scss` — spacing between header and panel.
  - Tests: `LoginView` spec and a style spec for the accordion.
- Out of scope: `api/`, auth logic and stores, the User settings password fields,
  any other accordion behaviour, desktop/mobile header work (task 022).

## Assumptions
- **Password cause (read from code, not yet reproduced).** `LoginView.vue` starts
  with `form.password = ''` and the input is bound with `v-model`, so the app does
  not put a value in the field. The most likely source is the browser autofilling a
  saved credential, triggered by `autocomplete="current-password"` (sign in) and
  `new-password` (sign up). Chrome also fills `new-password` fields with a
  suggested or saved password in some cases.
- A password manager filling the field is a browser feature, and the app cannot
  fully disable it. The app can only stop inviting it.
- **Accordion cause (read from code).** `.accordion-panel` has
  `padding: 0 var(--sp-5) var(--sp-5)`, so the top padding is zero and the content
  touches the trigger.
- Rules respected: SCSS only under `web/src/styles/`, no `<style>` blocks, CSS
  custom properties for tokens, no trailing semicolons in JS/TS.

## Open Questions
1. **How should the password field stay empty?**
   - Option A (**recommended**): reproduce first. If the value is browser autofill,
     keep `current-password` on sign in (it keeps password managers working for
     real users) but stop pre-filling on load by clearing the field after mount
     when it was filled without user input, and use `autocomplete="new-password"`
     on sign up only.
   - Option B: set `autocomplete="new-password"` in both modes. This blocks most
     autofill, but it breaks password managers on the sign-in form.
   - Option C: if the value comes from app code (for example a stale store or a
     dev seed), fix that source and leave the attributes alone.
2. **Accordion gap size.** Recommended: `var(--sp-3)` top padding on
   `.accordion-panel`. Alternative: `var(--sp-4)`, matching the trigger padding.
3. **Where to put the gap.** Recommended: top padding on the panel, so the panel
   background and the card animation are unaffected. Alternative: a margin on the
   panel's first child.

## Steps
1. Reproduce: run `web/`, open `/login` and `/signup` in a fresh profile and in a
   profile with a saved credential. Record whether the field is filled and by what
   (browser or app). This gates Step 2.
2. Apply the chosen option from Question 1 in `LoginView.vue`.
3. In `accordion.scss`, change `.accordion-panel` padding to
   `var(--sp-3) var(--sp-5) var(--sp-5)` (or the answer to Question 2).
4. Add tests (see Validation).
5. Run `cd web && npm test`, `npx vue-tsc --noEmit`, `npm run lint`.

## Validation
QA checklist, each item provable:
- [ ] Step 1 result is written in `.orchestrate/qa-report.md`: what filled the field
      and in which browser.
- [ ] A component test mounts `LoginView` in sign in and sign up modes and asserts
      the password input value is `''` on first render.
- [ ] A test asserts the `autocomplete` value of the password input in each mode
      matches the chosen option.
- [ ] Typing a password, submitting, and a failed login still behave as before
      (existing `LoginView` specs pass unchanged).
- [ ] A style spec asserts `.accordion-panel` has a non-zero top padding using a
      spacing token.
- [ ] Manual check: on Home, opening each of the three accordions shows a gap between
      header and content, in light and dark theme.
- [ ] `npm test`, `npx vue-tsc --noEmit`, `npm run lint` pass in `web/`. Known
      failures from a local `web/.env` selecting the HTTP source are not caused by
      this task.

## Risks
- The password cause is inferred from code. If it is browser autofill, the fix is
  partial by nature, since browsers may still offer saved credentials.
- Option B can hurt real users who rely on a password manager.
- A larger panel padding changes the height of the open accordion and may shift the
  card animation on Home.

## Rollout Order
1. Branch `fix/empty-password-and-accordion-spacing` (created from `origin/master`).
2. Frontend implementation and tests.
3. QA pass against the Validation list.
4. Human review, then merge approval (no commit or merge without approval).

## Rollback
Revert the branch commit(s). The change is one view's input attributes plus one
SCSS rule, with no data, API, or schema impact.
