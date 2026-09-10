Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-14

# Show Password Toggle on the Login/Signup Form

## Goal
Extend the show/hide password toggle to `LoginView.vue`. Backlog source:
`.plan/000-backlog.md`: *"In login route also add the show password option."*
This is a direct follow-up to `.plan/010-2026-08-14-ui-fixes.md`, which added
the same toggle to `UserSettingsView.vue`'s two password fields but explicitly
left `LoginView.vue` out of scope ("the backlog names User settings
specifically").

## Scope
- Frontend-only (`web/`). No `api/` changes.
- In scope: `web/src/views/LoginView.vue`'s single password field (one field,
  shared by both the sign-in and create-account modes — read at
  `web/src/views/LoginView.vue:152-159`).
- Out of scope: anything already covered by plan 010 (User settings' two
  fields are done); no new CSS pattern — `web/src/styles/cmps/form.css`
  already has the `.password-field`/`.password-toggle` classes from that
  plan, meant to be reused, not reinvented.

## Assumptions
- **Reuse, don't reimplement.** `UserSettingsView.vue` is the reference
  implementation: an `Eye`/`EyeOff` (`lucide-vue-next`) toggle button,
  `type="button"`, `aria-label` flipping between "Show password"/"Hide
  password", wrapped around the input in a `.password-field` div, switching
  the input's `type` between `password`/`text`. `LoginView.vue` needs exactly
  the same structure around its one field — this plan is a copy of an
  already-approved, already-QA'd pattern, not new design.
- **One field, one toggle, one ref** — `LoginView.vue` only ever has a single
  password input on screen (the same field is reused for both sign-in and
  signup by toggling `mode`, per `web/src/views/LoginView.vue:13-14`), unlike
  `UserSettingsView.vue`'s two independent fields. No independence concern
  here — there's nothing to keep independent.
- **Reveal state resets with the rest of the form.** `LoginView.vue:96`
  already clears `form.password = ''` after a successful submit; the reveal
  toggle should reset alongside it for the same reason password
  visibility shouldn't survive a completed action (consistent with the spirit
  of avoiding a revealed field lingering, matching plan 010's `.password-
  field` role even though that plan didn't reset `UserSettingsView.vue`'s
  toggles on save — see that plan's QA-recorded, deliberately-shipped minor
  finding). Also reset it on `setMode()` (switching between sign-in/signup)
  so toggling modes doesn't carry a stale reveal state into a differently-
  purposed field.

## Open Questions
None — this plan applies an existing, already-approved pattern to one
additional field.

## Steps
1. `web/src/views/LoginView.vue`: add a `showPassword` ref. Wrap the password
   `<input>` in a `.password-field` div (existing class from `form.css`) with
   a sibling `.password-toggle` button — `type="button"`, `Eye`/`EyeOff` icon,
   `aria-label` flipping with state — toggling `:type="showPassword ? 'text'
   : 'password'"`.
2. Reset `showPassword` to `false` in both `onSubmit`'s post-success cleanup
   (alongside the existing `form.password = ''`) and in `setMode()` (alongside
   the existing `clearErrors()` call).
3. No new CSS — reuse `.password-field`/`.password-toggle` from
   `web/src/styles/cmps/form.css` as-is.

## Validation
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — new/updated
  tests in `LoginView.spec.ts` cover: the toggle switches the field's
  `input[type]` between `password`/`text`, the toggle button doesn't submit
  the form, the `aria-label` flips with state, and the reveal state resets
  after a successful submit and after switching between sign-in/signup modes.
- Manual: `npm run dev`, confirm the eye icon shows/hides the password on
  `/login` in both sign-in and create-account mode.

## Risks
- Low — this is a same-shape repeat of an already-shipped, already-QA'd
  pattern. The only real risk is a copy-paste miss (e.g. forgetting the
  `type="button"` and accidentally submitting the form on toggle-click),
  which the Validation tests directly guard against.

## Rollout Order
1. `LoginView.vue` change + tests.
2. QA pass.

## Rollback
Purely additive UI on one existing field — revert the branch's merge commit,
no data or API surface touched.
