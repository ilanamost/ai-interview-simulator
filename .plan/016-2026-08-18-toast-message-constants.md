Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-18

# Toast Message Constants: One Module Owns All User-Facing Toast Copy

## Goal
Remove every hard-coded user-facing toast string from views, components, stores and
services, and move it into a single constants module the whole frontend imports from.
Backlog source: `.plan/000-backlog.md`: *"There should be no hard coded values in the
application - replace all toaster messages with constants that will be in a relevant
utils file"*.

The concrete payoff is not tidiness for its own sake — a codebase search found **six
pairs of exactly duplicated copy** already live in `web/src/`, where the same sentence
is typed out in two files and nothing keeps them in sync:

| Duplicated string | Site A | Site B |
|---|---|---|
| `Could not create your account. Please try again.` | `web/src/stores/auth.store.ts:116` | `web/src/views/LoginView.vue:94` |
| `Could not sign you in. Please try again.` | `web/src/stores/auth.store.ts:129` | `web/src/views/LoginView.vue:95` |
| `Signed out on this device, but the server could not be reached.` | `web/src/stores/auth.store.ts:149` | `web/src/cmps/SettingsMenu.vue:61` |
| `Could not save your profile. Please try again.` | `web/src/stores/auth.store.ts:163` | `web/src/views/UserSettingsView.vue:130` |
| `Could not reach the server. Check your connection and try again.` | `web/src/stores/auth.store.ts:30` | `web/src/services/auth.service.ts:81` |
| `That image could not be read. Try another file.` | `web/src/services/avatar.service.ts:48` | `web/src/services/avatar.service.ts:55` |

Editing the wording of any of those today silently changes it in one place and not the
other. That is the bug this plan closes.

This is a pure refactor: **no toast fires at a different moment, in a different type, or
with different words than it does on `master` today.** Every existing assertion in the
suite must keep passing untouched.

## Scope
- **Frontend-only (`web/`).** The backlog item carries no `stack:full` marker and needs
  none: toasts are a `vue-sonner` concern per `.claude/rules/ui-and-styling.md`, and
  every string in scope is authored in `web/`, never returned by `api/`. No `api/`
  file, route, or migration is touched.

### In scope
1. **New module `web/src/services/toast-message.service.ts`** — the single home for
   user-facing toast copy. See Assumptions for why `services/` and why that name.
2. **All 13 `toast.*()` call sites** in non-test source, which is the complete set as
   of this branch:

   | File | Line | Call |
   |---|---|---|
   | `web/src/views/LoginView.vue` | 91 | `toast.error(...)` — signup/signin fallbacks |
   | `web/src/views/LoginView.vue` | 101 | `toast.success(...)` — `Welcome, ${name}.` / `Welcome back, ${name}.` |
   | `web/src/views/UserSettingsView.vue` | 67 | `toast.error(...)` — avatar rejection |
   | `web/src/views/UserSettingsView.vue` | 121 | `toast.info('Nothing to save yet — change a field first.')` |
   | `web/src/views/UserSettingsView.vue` | 130 | `toast.error(...)` — profile save failure |
   | `web/src/views/UserSettingsView.vue` | 135 | `toast.success('Profile updated.')` |
   | `web/src/views/SetupView.vue` | 45 | `toast.error(store.error ?? 'Could not start the interview.')` |
   | `web/src/views/InterviewView.vue` | 30 | `toast.error(store.error ?? 'Could not evaluate that answer.')` |
   | `web/src/views/InterviewView.vue` | 40 | `toast.error(store.error ?? 'Could not load the next question.')` |
   | `web/src/views/ReportsHistoryView.vue` | 53 | `toast.error(store.error ?? 'Could not load your reports.')` |
   | `web/src/views/ReportHistoryDetailView.vue` | 24 | `toast.error(store.error ?? 'Could not load that report.')` |
   | `web/src/cmps/SettingsMenu.vue` | 60 | `toast.error(...)` — logout failure |
   | `web/src/cmps/VoiceInput.vue` | 63 | `toast.error(error.message)` — **no literal, nothing to extract** |

3. **The upstream copy that actually reaches those toasts**, because the view-level
   literals above are only `??` fallbacks — on the common path the user reads a string
   authored elsewhere:
   - `web/src/stores/auth.store.ts` — the `MESSAGE_BY_CODE` map (lines 26–31) and the
     five per-action fallbacks passed to `fail()` / `toUserMessage()` (lines 101, 116,
     129, 149, 163–164).
   - `web/src/services/avatar.service.ts` — the three `AvatarError` messages (lines 31,
     38, 48, 55), surfaced verbatim by `UserSettingsView.vue:67`.
   - `web/src/services/auth.service.ts` — the two fallback messages (lines 81, 92) that
     become `err.message` and flow into the store's toast copy.
4. **`.doc/glossary.md`** — add `toast` as the canonical term (see Assumptions).

### Out of scope, and why
- **`web/src/services/speech.service.ts`'s `ERRORS` map** (lines 75–105) plus
  `UNSUPPORTED` and `FAILED_TO_START`. These are already a named, centralized constants
  map — not hard-coded literals scattered at call sites — and they are the `.message`
  of a thrown `SpeechError`, i.e. properties of an error type rather than toast copy.
  `VoiceInput.vue:63` passes `error.message` through with no literal of its own, so
  there is nothing at the toast call site to replace. Moving them would be a lateral
  rename that widens the diff without removing a single duplicate. See Open Question 3.
- **Inline field-validation copy** — `'Enter your name.'`, `'Enter a valid email
  address.'`, `` `Use at least ${MIN_PASSWORD_LENGTH} characters.` `` and friends in
  `LoginView.vue` and `UserSettingsView.vue`. These render into
  `<p class="field-error">`, never into a toast. The backlog item's operative clause is
  *"replace all toaster messages"*; a separate pass can take form copy. See Open
  Question 2.
- **Static template prose** — headings, hints, empty-state paragraphs, `aria-label`s.
  Not toasts, and inlining them in the template they belong to is correct Vue.
- **Non-copy constants** already correctly homed elsewhere: `MIN_PASSWORD_LENGTH` and
  `MAX_AVATAR_BYTES` in `web/src/types/user.ts`, `STAGGER_STEP_MS` in
  `web/src/services/animation.service.ts`, the `*_LABEL` maps in
  `web/src/services/label.service.ts`. This plan does not relocate them.
- Any change to when a toast fires, its type (`error`/`success`/`info`), or its wording.

## Assumptions

**Where the module lives — `web/src/services/toast-message.service.ts`.**
The backlog says "a relevant utils file", but this repository has no `utils/` directory
and inventing one would contradict `.claude/rules/naming.md` ("keep file names aligned
with the domain name they serve"). The established precedent for a pure, IO-free module
holding shared UI constants is `services/`:
- `web/src/services/label.service.ts` — the `*_LABEL` display-name maps (plans 013/015).
- `web/src/services/animation.service.ts` — `STAGGER_STEP_MS` / `MAX_STAGGER_MS`, whose
  own header comment reads *"A pure module with no IO, the same shape as
  `label.service.ts`"* (plan 015).
`toast-message.service.ts` is the third member of that family. Singular entity name per
`.claude/rules/naming.md` (`site.service`, `label.service` → `toast-message.service`).

**The term is `toast`, not `toaster`.** The backlog says "toaster messages", but
`.claude/rules/ui-and-styling.md` says *"`vue-sonner` for toast messages"*, the library
API is `toast.error(...)`, and `.claude/rules/naming.md` forbids introducing a second
word for a concept that already has one. Everything this plan names uses `toast`.
`.doc/glossary.md` has no entry for it today and this plan will use it broadly, so the
naming rule's *"document a new shared term there before using it broadly"* applies —
hence the glossary step.

**Grouping: by feature, not by toast type.** The module exports one object per feature
area, and the `error`/`success`/`info` distinction stays at the call site where
`vue-sonner` already expresses it:

```ts
export const AUTH_TOAST = {
  signupFailed: 'Could not create your account. Please try again.',
  signinFailed: 'Could not sign you in. Please try again.',
  logoutFailed: 'Signed out on this device, but the server could not be reached.',
  welcome: (name: string) => `Welcome, ${name}.`,
  welcomeBack: (name: string) => `Welcome back, ${name}.`
} as const
```

Four groups: `AUTH_TOAST`, `PROFILE_TOAST`, `INTERVIEW_TOAST`, `REPORT_TOAST`, plus the
code map re-homed as `AUTH_ERROR_BY_CODE`. The reasoning, since the request asks for a
decision rather than an option list:
- Every call site is feature-local. A reader in `LoginView.vue` follows one import to
  one object; a type-keyed layout (`ERROR_MESSAGE` / `SUCCESS_MESSAGE` / `INFO_MESSAGE`)
  would scatter the login flow's three strings across three objects.
- Copy changes arrive per feature ("reword the reports errors"), never per severity
  ("reword all the info toasts").
- The type is already stated, unmissably, by `toast.error` vs `toast.success` at the
  call site. Encoding it again in the constant's name is redundant and creates a second
  thing that can disagree with the first.
- It matches the existing precedent: `label.service.ts` groups by domain concept
  (`JOB_TITLE_LABEL`, `REPORT_SORT_LABEL`), not by where the label gets rendered.

**Static strings are constants; parameterized ones are arrow functions** living in the
same feature object (`welcome(name)`, `avatarTooLarge(actual, max)`). Keeping the
interpolation inside the module is the point — otherwise the template literal, which is
half the copy, stays hard-coded at the call site.

**No import cycle is possible.** `toast-message.service.ts` imports nothing at runtime,
so `auth.store.ts` → service and `avatar.service.ts` → service are both one-directional.
(`label.service.ts` already imports a store *type*, and does so type-only for exactly
this reason.)

**Plan 009's convention is preserved.** `.plan/009-2026-08-13-pinia-store-api-calls.md`
established that stores compute the message and the **UI** calls `toast`. This plan does
not move a single `toast.*()` call — it only changes where the *string* those calls pass
is authored. Stores still never import `vue-sonner`; `auth.store.spec.ts:247–261`
asserts exactly that and must keep passing.

**The existing test suite is the regression net.** Assertions such as
`expect(toast.error).toHaveBeenCalledWith('Could not load your reports.')`
(`ReportsHistoryView.spec.ts:351`) and the ten similar ones in `LoginView.spec.ts`,
`LoginView.adversarial.spec.ts`, `UserSettingsView.spec.ts`, `SettingsMenu.spec.ts` and
`ReportHistoryDetailView.spec.ts` hard-code the expected copy as literals. **Leave those
literals alone.** A spec that asserts against the same constant it is testing proves
nothing; keeping the literal is what makes the suite a real guard against accidental
rewording during the move.

## Open Questions

1. **Should `AUTH_ERROR_BY_CODE` move out of `auth.store.ts` into the new module, or
   stay in the store?**
   *Recommended: move it.* Those four strings (`EMAIL_TAKEN`, `INVALID_CREDENTIALS`,
   `UNAUTHENTICATED`, `NETWORK_ERROR`) are the copy the user actually reads in the
   common failure case — the view-level literals are only `??` fallbacks for when the
   store's message is nullish. Leaving them behind would mean the task ships with the
   most-seen toast copy still hard-coded, and would leave duplicate pair #5 in the table
   above unresolved. The store keeps `toUserMessage()` and its precedence logic exactly
   as-is; only the string table relocates.

2. **Should inline form-validation copy (`'Enter your name.'` and the other seven
   field-error strings) move in the same pass?**
   *Recommended: no — keep this pass toast-only.* The backlog clause is specific to
   toaster messages, the strings render as inline `<p class="field-error">` rather than
   toasts, and mixing them in doubles the diff on two of the highest-traffic views in
   the app for a concern with a different lifetime. Suggested follow-up: add a backlog
   item for a `form-message.service.ts` sibling once this module has settled.

3. **Should `speech.service.ts`'s `ERRORS` map be folded into the new module for
   consistency?**
   *Recommended: no.* It is already a centralized, well-named constants map, and its
   entries are `SpeechError.message` values — properties of an error type, not toast
   copy. `VoiceInput.vue:63` toasts `error.message` with no literal of its own, so the
   move would remove zero hard-coded call-site strings and zero duplicates while
   coupling the speech layer to a UI-copy module. If the human prefers absolute
   uniformity ("every user-facing string in one file"), flip this and add a
   `VOICE_TOAST` group — it is a mechanical addition to Step 2.

4. **`as const` on the exported objects, or plain object literals?**
   *Recommended: `as const`.* It gives each entry a literal string type, so a typo in a
   key fails `npm run build`'s `vue-tsc --noEmit` rather than rendering `undefined` into
   a toast at runtime. It costs nothing and matches how `label.service.ts`'s `Record<>`
   typing already fails loudly on a missing key.

## Steps

1. **Add `web/src/services/toast-message.service.ts`.**
   Module header comment explaining that this is the single home for user-facing toast
   copy, that grouping is by feature (with the reasoning from Assumptions in one line),
   and that the `error`/`success`/`info` choice stays at the call site. Export, all
   `as const`, no imports, no trailing semicolons per `.claude/rules/code-style.md`:
   - `AUTH_ERROR_BY_CODE` — the four entries lifted verbatim from `auth.store.ts:26–31`.
   - `AUTH_TOAST` — `checkFailed`, `signupFailed`, `signinFailed`, `logoutFailed`,
     `welcome(name)`, `welcomeBack(name)`.
   - `PROFILE_TOAST` — `saveFailed`, `currentPasswordWrong`, `nothingToSave`, `saved`,
     `avatarUnusable`, `avatarTypeRejected`, `avatarUnreadable`,
     `avatarTooLarge(actual, max)`.
   - `INTERVIEW_TOAST` — `startFailed`, `evaluateFailed`, `nextQuestionFailed`.
   - `REPORT_TOAST` — `listFailed`, `detailFailed`.
   - `API_TOAST` — `networkUnreachable`, `requestRejected` (from `auth.service.ts:81,92`;
     `networkUnreachable` is the single source that `AUTH_ERROR_BY_CODE.NETWORK_ERROR`
     also references, killing duplicate pair #5).
   Copy every string **byte-for-byte**, em dashes and trailing periods included.

2. **Rewire the four store/service authors of upstream copy.**
   - `web/src/stores/auth.store.ts` — delete the local `MESSAGE_BY_CODE`, import
     `AUTH_ERROR_BY_CODE` and `AUTH_TOAST`, and replace the five `fail()` /
     `toUserMessage()` fallback literals. `toUserMessage()`'s precedence chain
     (overrides → code map → `err.message` → fallback) is unchanged. The
     `INVALID_CREDENTIALS` override at line 164 becomes
     `PROFILE_TOAST.currentPasswordWrong`.
   - `web/src/services/auth.service.ts` — replace the two literals with `API_TOAST`.
   - `web/src/services/avatar.service.ts` — replace the three `AvatarError` messages
     with `PROFILE_TOAST` entries; `avatarTooLarge(actual, max)` takes the two
     already-formatted `formatMb()` strings so `formatMb` stays in the service.
     Resolves duplicate pair #6 by construction — one constant, two `reject` sites.
   - Confirm no store gained a `vue-sonner` import.

3. **Rewire the seven toast call sites that carry a literal.**
   `LoginView.vue` (2), `UserSettingsView.vue` (4), `SetupView.vue`, `InterviewView.vue`
   (2), `ReportsHistoryView.vue`, `ReportHistoryDetailView.vue`, `SettingsMenu.vue`.
   Each becomes e.g. `toast.error(store.error ?? REPORT_TOAST.listFailed)`. The `??` /
   `||` fallback structure, the `.trim()` guards, and `LoginView.vue`'s `greetingName()`
   truncation all stay exactly as they are — only the literal is swapped for the
   constant. `VoiceInput.vue` is read to confirm it needs no change, and is not edited.

4. **Add a `toast` entry to `.doc/glossary.md`** naming `toast` as canonical (not
   "toaster", not "notification"), pointing at `vue-sonner` and at
   `web/src/services/toast-message.service.ts` as the home for the copy.

5. **Add `web/src/services/toast-message.service.spec.ts`** per the `writing-tests`
   skill — see Validation for what it asserts.

6. **Grep for stragglers.** Re-run the discovery search
   (`toast\.(error|success|info)\(` across `web/src`, excluding `*.spec.ts`) and confirm
   zero remaining string literals at any call site.

## Validation
Each item is provable by a command or a test — this is QA's checklist.

1. `cd web && npm run test` — the full Vitest suite passes with **no spec file modified
   by this plan except the new `toast-message.service.spec.ts`**. `git diff --stat` on
   `web/src/**/*.spec.ts` must show that one new file and nothing else. This is the
   central proof that the refactor changed no observable behavior: every existing
   `toHaveBeenCalledWith('<literal>')` assertion still matches.
2. `cd web && npm run build` — `vue-tsc --noEmit` passes; no `any`, no missing key.
3. `cd web && npm run lint` — clean at `--max-warnings 0`, including the no-trailing-
   semicolon style rule.
4. **No literal left at a toast call site.**
   `grep -rnE "toast\.(error|success|info)\(" web/src --include=*.vue --include=*.ts |
   grep -v "\.spec\.ts"` returns 13 lines, and none contains a quoted string literal or
   a backtick template. `VoiceInput.vue:63` (`toast.error(error.message)`) is the one
   line that was already literal-free.
5. **No duplicated copy remains.** For each of the six strings in the Goal table,
   `grep -rn "<string>" web/src --include=*.ts --include=*.vue | grep -v "\.spec\.ts"`
   returns exactly **one** line, and that line is in `toast-message.service.ts`.
6. **Stores still do not toast.** `grep -rn "vue-sonner" web/src/stores --include=*.ts |
   grep -v "\.spec\.ts"` returns nothing, and `auth.store.spec.ts`'s "no action reaches
   for vue-sonner" block (lines 247–261) passes — plan 009's convention held.
7. **The new module is pure.** `toast-message.service.ts` has zero `import` statements,
   verified by reading the file; no store, no component, no `vue-sonner`.
8. `toast-message.service.spec.ts` asserts: every exported group is non-empty; no value
   is an empty or whitespace-only string; the parameterized entries interpolate
   correctly (`AUTH_TOAST.welcome('Dev User') === 'Welcome, Dev User.'`,
   `welcomeBack`, `PROFILE_TOAST.avatarTooLarge('2.5MB', '2.0MB')` contains both);
   and `AUTH_ERROR_BY_CODE` still has all four keys — `EMAIL_TAKEN`,
   `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `NETWORK_ERROR`.
9. **Manual smoke, `npm run dev`:** sign in with a wrong password (error toast, exact
   old wording), sign in successfully (`Welcome back, <name>.`), open User settings and
   press Save with no changes (info toast), pick a >2MB image (size error naming both
   sizes), start an interview with the API stopped (error toast), open `/reports` with
   the API stopped (error toast). Every toast reads exactly as it does on `master`.

## Risks
- **Silent reword during the move (highest risk).** A dropped em dash in
  `'Nothing to save yet — change a field first.'` or a lost trailing period changes
  what a user reads. *Mitigation:* the untouched spec literals catch it — Validation 1
  fails loudly. Copy by clipboard, never retype.
- **Scope creep into "no hard coded values in the application" at large.** The backlog
  title is broad; the operative clause is toast messages. *Mitigation:* the Out of scope
  list is explicit, and Open Questions 2 and 3 name the two tempting adjacencies with a
  recommended "not now" so the decision is recorded rather than rediscovered mid-task.
- **`toUserMessage()` precedence regression.** `auth.store.ts:38–47` layers overrides →
  code map → `err.message` → fallback. Swapping the table for an import must not reorder
  those branches; `UserSettingsView.spec.ts:166` (`'Your current password is
  incorrect.'`) is the assertion that proves the per-action override still beats the
  shared `INVALID_CREDENTIALS` entry.
- **Import cycle.** Mitigated by construction — Validation 7 pins the module at zero
  imports.
- **Re-tabling `AVATAR_TOO_LARGE` breaks the substring assertions.**
  `UserSettingsView.spec.ts:320,335` assert with `expect.stringContaining('under 2.0MB')`
  and `'PNG, JPEG, WebP, or GIF'`. The function form must keep producing a string
  containing `under ${max}` verbatim.
- **Merge friction.** Eight source files, six of them already modified on the current
  branch per `git status`. *Mitigation:* land this on its own branch after the current
  work merges — see Rollout Order.

## Rollout Order
1. Confirm the working tree is clean and the current `feat/sort-and-ui-fixes` work has
   landed; branch `chore/toast-message-constants` off `master`
   (`.claude/rules/git-workflow.md`: maintenance work, one workstream per branch).
2. Step 1 — add `toast-message.service.ts`. Additive only; suite stays green. Commit.
3. Step 5 — add `toast-message.service.spec.ts` against the new module. Commit.
4. Step 2 — rewire `auth.store.ts`, `auth.service.ts`, `avatar.service.ts` (the upstream
   copy authors). Run the suite: this is where a mistyped string surfaces, against the
   store and view specs that assert the old wording. Commit.
5. Step 3 — rewire the seven view/component call sites. Run the suite. Commit.
6. Steps 4 and 6 — glossary entry, then the straggler grep and the full Validation list.
   Commit.
7. QA agent pass against the Validation checklist; then review and merge on approval.

Order matters: the module lands before any consumer, and the upstream authors (step 4)
land before the call sites (step 5) so that at no commit does a view import a constant
that does not exist yet. Every commit in the sequence is independently green.

## Rollback
Low-risk by design — the change is textual and additive-then-substitutive, with no
schema, no API contract, no persisted state, and no `.orchestrate/api-contract.yaml`
change.
- **Per-commit:** `git revert <sha>` on any single step. Because each commit leaves the
  suite green, reverting step 5 alone leaves the module and the store rewiring in place
  and working.
- **Whole branch:** `git revert -m 1 <merge-sha>`, or drop the branch before merge. No
  migration to unwind, no cache to clear, no deployed environment to reconfigure —
  `.env.staging` / `.env.production` from plan 014 are untouched.
- **Partial:** if only one feature group proves contentious, revert that group's call
  sites to inline literals and delete the group from the module; the other three groups
  are independent and keep working.
- **Detection:** a wrong-copy regression shows up as a failing Vitest assertion in CI
  before merge, not in production. If one somehow lands, Validation item 5's grep
  locates the single line to fix — which is precisely the property this plan buys.
