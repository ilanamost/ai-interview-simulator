Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-13

# UI-Owned Toasts for Store API Calls

## Goal
Make "the store makes the API call, the UI decides how to tell the user about the
result" the whole frontend's convention — specifically, toast calls belong in
components/views, never inside a store action. Backlog source:
`.plan/000-backlog.md`: *"In the frontend Use pinia store with relevant files. Make
all the api calls happen through the store files. add error handling with toaster
messages for api error notifications. The UI components should call store files
and these should handle the api calls."*

Revision note: an earlier draft of this plan proposed the opposite direction
(centralize toasting *inside* the stores, matching `auth.store.ts`'s current
behavior). The human reviewer rejected that: toasts belong in the UI. This
version reverses the plan accordingly — see git history on this file for the
earlier draft if useful context.

## Scope
- Frontend-only (`web/`). No `api/` changes.
- In scope: `web/src/stores/auth.store.ts` (stop toasting internally) and its
  three calling surfaces — `web/src/views/LoginView.vue`,
  `web/src/views/UserSettingsView.vue`, `web/src/cmps/SettingsMenu.vue` (start
  toasting based on the store's result).
- Out of scope, and why (research already done):
  - `web/src/stores/interview.store.ts` and its views
    (`SetupView.vue`/`InterviewView.vue`) — **already compliant**. The store's
    four mutating actions catch their own error, set `error.value`, and
    rethrow; the views already catch that and call `toast.error(store.error ??
    '<fallback>')` themselves. That's UI-owned toasting already; nothing to
    change here. (This is the reverse of what the rejected draft assumed was
    the target shape — it isn't, `interview.store.ts` was the correct example
    all along.)
  - `web/src/services/label.service.ts`, `report-pdf.service.ts`,
    `session-storage.service.ts`, `speech.service.ts`, `avatar.service.ts` —
    none make network calls, so "the store handles the API call" doesn't apply;
    they're correctly called directly from components today.
  - `VoiceInput.vue`'s `toast.error(error.message)` (speech-recognition
    failure, not an API call) and `UserSettingsView.vue`'s two local-validation
    toasts (`AvatarError` from a client-side file read, "Nothing to save yet")
    — neither is API-error handling, both already live correctly in the UI.
  - `fetchMe()` — stays silent on failure (no toast, in either direction).
    That's the existing, deliberate boot-time behavior (a signed-out visitor is
    normal, not an error) and this plan doesn't touch it.

## Assumptions
- A research pass (Explore agent) plus direct reads of `auth.store.ts`,
  `LoginView.vue`, `UserSettingsView.vue`, and `SettingsMenu.vue` confirmed the
  exact shape of the gap: `auth.store.ts`'s `signup`, `login`, `logout`, and
  `updateProfile` each call `toast.success(...)` or, via a shared `fail()`
  helper, `toast.error(...)` *inside the store*. None of the three views that
  call these actions fire a toast themselves — they only branch on the
  returned `boolean` (e.g. `LoginView.vue:64` `if (!ok) return`). Moving the
  toast calls out of the store and into these three views, using the store's
  already-computed `error.value` and `user` state to build the message, closes
  the gap without changing any action's success/failure contract.
- The store keeps computing the *content* of the message (the
  code-to-copy mapping in `MESSAGE_BY_CODE` and the per-action overrides, e.g.
  `INVALID_CREDENTIALS` → "Your current password is incorrect." on a password
  change) — that logic depends on server error codes the view shouldn't need
  to know about. Only the act of calling `toast.error`/`toast.success` moves
  out; `error.value` remains the store's computed, user-safe string for the
  view to display.
- Success-message text (`"Welcome, {name}."`, `"Welcome back, {name}."`,
  `"Profile updated."`) moves into the views too, since composing a
  user-facing success message is exactly the kind of UI-presentation concern
  this plan is drawing the line around. Views already have `auth.user`
  available after a successful action to build the greeting.

## Open Questions
None — the target pattern already exists in the codebase
(`interview.store.ts` + its views) and this plan brings `auth.store.ts` in
line with it, rather than inventing a new one.

## Steps
1. `web/src/stores/auth.store.ts`:
   - Remove the `import { toast } from 'vue-sonner'` and every `toast.success`/
     `toast.error` call.
   - Keep the `fail()` helper's job of setting `error.value` and `status.value`
     and returning `false` — just delete its `toast.error(error.value)` line.
   - Keep `MESSAGE_BY_CODE`, `toUserMessage`, and the per-call `overrides`
     parameter exactly as they are — that message-computation logic stays in
     the store, only its delivery mechanism (toast) moves out.
   - Actions keep returning `Promise<boolean>` exactly as today; no change to
     any call site's control flow, only to what happens after a `true`/`false`
     result.
2. `web/src/views/LoginView.vue`: after `const ok = await auth.signup(...)` /
   `await auth.login(...)`, branch — on `true`, `toast.success(...)` with a
   welcome message built from `auth.user?.name` (mirror the store's old
   copy: `Welcome, {name}.` for signup, `Welcome back, {name}.` for login);
   on `false`, `toast.error(auth.error ?? '<fallback>')` before the existing
   `if (!ok) return`.
3. `web/src/views/UserSettingsView.vue`: after `const ok = await
   auth.updateProfile(patch)`, on `true` add `toast.success('Profile
   updated.')` (alongside the existing `resetFromUser()`); on `false`,
   `toast.error(auth.error ?? '<fallback>')`. The view already imports `toast`
   for its two local-validation cases, so this is additive, not a new import.
4. `web/src/cmps/SettingsMenu.vue`'s `onLogout`: `auth.logout()` today has no
   success toast (silent success is the existing, deliberate UX — preserve
   it) and no failure toast either. Add `toast.error(auth.error ?? '<fallback>
   ')` when `auth.logout()` resolves `false`, so a failed server-side logout
   (network error) is now visible instead of silently swallowed — today the
   store's internal toast made this work by accident; without it, this view
   must do it explicitly or the behavior regresses.
5. Do not touch `interview.store.ts`, `SetupView.vue`, `InterviewView.vue`,
   `VoiceInput.vue`, or `web/src/stores/interview.store.spec.ts` — all already
   correct.

## Validation
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — updated/new
  tests cover: `auth.store.spec.ts`'s actions no longer call `toast.*`
  themselves (assert `vue-sonner`'s `toast.success`/`toast.error` mocks are
  never called from a store-level test) while still setting `error`/returning
  the right boolean; `LoginView.spec.ts` asserts a toast fires on both
  successful signup/login and on failure, with the right text;
  `UserSettingsView.spec.ts` asserts a success toast on save and an error
  toast on failure (including the `INVALID_CREDENTIALS` → "Your current
  password is incorrect." case, proving the override text still reaches the
  toast even though the store no longer fires it); `SettingsMenu.spec.ts`
  asserts a failed logout now toasts an error (new coverage — this path
  wasn't toasting-tested before because the store did it invisibly to the
  component test).
- Manual: `npm run dev`, sign up, sign in, sign out, and save a profile change
  (success and a deliberately wrong current-password case) — confirm exactly
  one toast per action, in the view, matching today's copy.

## Risks
- Silent regression risk: any of the three views that isn't updated will
  simply stop toasting (the store no longer does it, and the view was never
  doing it either) rather than fail loudly — verify all three call sites
  before finishing, not just skim the plan's list.
- `auth.store.spec.ts` almost certainly asserts today's `toast.success`/
  `toast.error` calls directly from store-level tests; those assertions need
  to move to the corresponding view spec, not just be deleted.

## Rollout Order
1. `auth.store.ts` — strip internal toasting, keep everything else.
2. `LoginView.vue`, `UserSettingsView.vue`, `SettingsMenu.vue` — add the toast
   calls the store used to make.
3. QA pass, including the manual walkthrough above.

## Rollback
Purely a call-site relocation inside `web/` — no data or API surface touched.
Revert the branch's merge commit to restore the store's internal toasting and
remove the views' new toast calls.
