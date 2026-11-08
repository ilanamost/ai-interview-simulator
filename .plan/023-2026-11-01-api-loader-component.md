Status: done
Owner: Ilana
Last updated: 2026-11-01

# Global API Loader Component

## Goal
Show one shared loader component for as long as any API call is in flight, and
remove the ad-hoc loaders it replaces, so loading feedback looks and behaves the
same everywhere. Builds on [[022-2026-09-13-backend-deployment]]'s deployed
backend (slower real calls make this visible) and on the startup loader added in
commit `20aa992`.

## Scope
- In scope (frontend only, `web/`; task is not `stack:full`):
  - `web/src/stores/loader.store.ts` — Pinia store holding an in-flight request
    counter; `isLoading` is `count > 0`.
  - `web/src/services/loader.service.ts` — `trackRequest(promise)` helper that
    increments before and decrements in `finally`, so a failed call never leaves
    the loader stuck.
  - Hook `trackRequest` into the two fetch wrappers: `fetch` in
    `web/src/services/auth.service.ts` and `web/src/services/interview-http.service.ts`.
  - `web/src/cmps/ApiLoader.vue` — the loader component (overlay + spinner,
    `role="status"`, `aria-live="polite"`), mounted once in `web/src/App.vue`.
  - Styles in `web/src/styles/cmps/progress.scss` (SCSS, tokens only, no inline
    styles or `<style>` blocks).
  - Remove the loaders it replaces (see Open Questions for which).
  - Unit and component tests; update `.doc/glossary.md` if "loader" is a new shared term.
- Out of scope: `api/`, new routes, changes to the `InterviewSource` contract,
  the mock adapter (it makes no network calls, so it never shows the loader).

## Assumptions
- "Each API call" means every `fetch` through the two wrappers above, including
  the startup `fetchMe()` / `rehydrate()` calls.
- Overlapping calls share one loader (counter, not a boolean) and it hides only
  when the last one settles.
- A short grace delay (~150 ms) before showing avoids a flash on fast calls.
- Existing `status` / `isBusy` flags in the stores stay: they drive button
  disabling and error states, not just visuals.

## Open Questions
All three answered APPROVED with the recommended answers: replace (a) and (b), keep (c); full-screen overlay; 150 ms grace.

1. **Which existing loaders does the new one replace?**
   Candidates: (a) `StartupLoader.vue` + `startup-loader.service.ts`, (b) the
   inline "Loading your reports…" / "Loading that report…" text in
   `ReportsHistoryView.vue` and `ReportHistoryDetailView.vue`, (c) the small
   button spinners in `AnswerInput`, `InterviewView`, `LoginView`, `SetupView`,
   `UserSettingsView`.
   *Recommended:* replace (a) and (b); keep (c). Button spinners signal which
   action is pending and the button is disabled by them — a full overlay would
   not replace that.
2. **Blocking overlay or non-blocking indicator?**
   *Recommended:* a full-screen overlay with a translucent backdrop, which also
   blocks double submits. Alternative: a thin top progress bar.
3. **Grace delay before showing?** *Recommended:* 150 ms.

## Steps
1. Add `loader.store.ts` (`pending` counter, `isLoading`, `start()`, `stop()`
   clamped at 0) and a Vitest spec.
2. Add `loader.service.ts` with `trackRequest<T>(p: Promise<T>): Promise<T>`
   and a spec covering success, rejection, and overlapping calls.
3. Wrap the `fetch` calls in `auth.service.ts` and `interview-http.service.ts`
   with `trackRequest`; extend their specs.
4. Build `ApiLoader.vue` bound to `isLoading` (with grace delay); add SCSS in
   `progress.scss`; mount in `App.vue`; component spec.
5. Remove the replaced loaders per Open Question 1 and fix their tests/imports
   (`index.html` / `404.html` mount point changes if `StartupLoader` goes).
6. Run `cd web && npm test`, `npx vue-tsc --noEmit`, `npm run lint`.
7. Record in `.orchestrate/frontend-agent-report.md`; API contract is unchanged.

## Validation
- `loader.store` spec: counter increments/decrements, never below 0, `isLoading` true while any call pending.
- `trackRequest` spec: decrements on resolve and on reject; two overlapping calls keep the loader up until both settle.
- Service specs: a mocked `fetch` in `auth.service` and `interview-http.service` toggles `isLoading` and clears it after a 4xx/5xx and after a timeout/abort.
- `ApiLoader` component spec: hidden when idle; rendered with `role="status"` while pending; not rendered for calls faster than the grace delay.
- Grep shows no remaining references to removed loaders; `npm test`, `npx vue-tsc --noEmit`, `npm run lint` all pass.
- No trailing semicolons, no inline styles, no `<style>` block, styles only under `web/src/styles/cmps/`.

## Risks
- A path that bypasses the two wrappers leaves a call untracked — mitigated by the grep for `fetch(` in step 3.
- A stuck counter would leave the overlay up forever — mitigated by `finally` and the clamp.
- The overlay at startup must appear before the app mounts if `StartupLoader` is removed; the loader must mount early enough for `fetchMe()`.

## Rollout Order
1. Store + service (no UI change). 2. Hook into fetch wrappers. 3. Component and
styles. 4. Remove replaced loaders. 5. QA.

## Rollback
Frontend-only and self-contained: revert the branch `feat/api-loader-component`.
No data, API, or schema changes to undo.
