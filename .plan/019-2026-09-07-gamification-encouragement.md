Status: done
Owner: Ilana
Last updated: 2026-09-07

# Gamification Encouragement Modal

## Goal
Backlog source: `.plan/000-backlog.md`: *"Add gamification element. Add messages
such as: 'You're awesome!', 'Good Job!', etc' as alerts for users that are
successful in answering the interview questions, but not after each question, do
it periodically. The messages will appear in a nice modal with appropriate icons
and animations."*

No `stack:full` marker — frontend-only, scoped to `web/`. No Figma URL was
attached to this backlog item.

When the candidate answers a question well, celebrate it — but sparingly, so it
reads as a genuine milestone and not a popup on every question. A new
`EncouragementModal` appears every `ENCOURAGEMENT_INTERVAL`-th *successful*
answer during an interview, with a short congratulatory message, an icon, and an
entrance animation, then dismisses on its own or on user action.

## Scope
- Frontend-only (`web/`).
- In scope:
  - A grade-based "was this answer successful" check and a periodic counter in
    `interview.store.ts`.
  - A new presentational `EncouragementModal.vue` component with icon +
    animation, following this app's existing component/animation conventions
    (no new dependency).
  - A new pure `gamification.service.ts` holding the message pool, the
    threshold, and the interval — no hardcoded strings/numbers at the call
    site, per `AGENTS.md`.
  - Wiring the modal into `InterviewView.vue`, the one place the Q&A flow
    already lives.
  - A `.doc/glossary.md` entry for the new UI concept ("encouragement"),
    parallel to the existing `toast` entry.
- Out of scope:
  - Any `api/` change — nothing here needs persistence or a new grade.
    `Evaluation.grade` already exists and is all this needs.
  - Cross-session/streak tracking (e.g. "3 interviews in a row"). This is
    scoped to milestones *within one interview*, matching the backlog's "not
    after each question, periodically" framing.
  - Extracting the `grade >= 70` "good" threshold that `GradeBadge.vue`,
    `answer-grader.ts`, and `interview.service.ts` each already inline into one
    shared constant across those three files — real duplication, but pre-dates
    this task and touching all three is a refactor beyond what gamification
    needs. This plan reuses the same value (`70`) so "successful" means the
    same thing here as it visually does on `GradeBadge`, without touching
    those files.
  - Sound effects — not mentioned in the backlog item, no existing audio in
    the app to extend.

## Assumptions
- **"Successful answer" = `evaluation.grade >= 70`.** Matches `GradeBadge.vue`'s
  existing `is-good` cutoff (`web/src/cmps/GradeBadge.vue:15`), which is the
  only place the app already draws a visual line for "good", so reusing it
  keeps "successful" meaning one consistent thing across the UI.
- **Trigger point is `submitAnswer` in `interview.store.ts`** (right after
  `session.value.evaluations.push(evaluation)`, `interview.store.ts:213`) —
  the one place a fresh grade becomes available, already the natural home for
  per-answer side effects.
- **Counter is in-memory, not persisted.** `interview.store.ts`'s snapshot
  watcher only persists `session`/`report` (`interview.store.ts:108-114`); a
  new "successful answers since last celebration" ref is deliberately left out
  of that snapshot. A user who refreshes mid-interview may see the count reset
  early (lose progress toward the next celebration) or, if they refresh right
  after one fires, could in principle see it again — both are inconsequential
  for a decorative milestone popup, and match how this codebase already treats
  this class of state as best-effort (`session-storage.service.ts`,
  `report-history.service.ts` are both documented fail-silent/best-effort).
- **No new dependency.** No animation library exists in this app
  (`web/package.json` has no gsap/framer-motion/etc.) and no modal/dialog
  component exists anywhere in `web/src` today — confirmed by search. The
  modal is built the same way `SettingsMenu.vue` already builds its overlay
  (open ref, `Escape`-key + outside-click dismiss) plus Vue's built-in
  `<Transition>` for the enter/leave animation, and CSS `@keyframes` in
  `styles/cmps/`, matching `animation.scss`'s existing pattern. No `<dialog>`
  element or new library.
- **Message/icon selection is deterministic, not random.** The mock interview
  source is deliberately deterministic (per `.doc/product-definition.md`), and
  nothing else in this codebase uses `Math.random`. Messages and icons cycle by
  the milestone's index (`count % messages.length`), which is also what makes
  the message pool trivially testable (no fixed seed / mocked RNG needed).

## Open Questions
1. **How many successful answers between celebrations?**
   Recommended: `ENCOURAGEMENT_INTERVAL = 2` (every 2nd successful answer,
   i.e. milestones at the 2nd, 4th, 6th… successful answer). A typical
   interview is 5 questions per `.doc/product-definition.md`'s default, so `2`
   gives roughly 2 celebrations per interview — enough to feel rewarding
   without popping up on every other question. `3` is the fallback if that
   reads as too frequent once seen in the browser.
2. **Auto-dismiss or manual-only?**
   Recommended: both — auto-dismiss after 4s (`AUTO_DISMISS_MS = 4000`) *and*
   a manual close (button, `Escape`, backdrop click), so it never blocks the
   flow if the user is mid-typing on the next question but also doesn't linger
   if they'd rather move on immediately.
3. **Exact message copy** — recommended starter pool (5 messages, short and
   varied in register): *"You're awesome!"*, *"Great job!"*, *"Nice work —
   keep it up!"*, *"You're on a roll!"*, *"Impressive answer!"*. Open to
   editing; cycling through 5 avoids the same line repeating in a single
   interview for anyone hitting more than one milestone.

Plan proceeds with the recommended answers above; update this section if the
approval gate changes any of them.

## Steps

### `web/src/services/gamification.service.ts` (new)
1. Pure module, no imports/IO — same shape as `toast-message.service.ts` /
   `animation.service.ts`. Exports:
   - `SUCCESS_GRADE_THRESHOLD = 70`
   - `ENCOURAGEMENT_INTERVAL = 2`
   - `ENCOURAGEMENT_MESSAGES = [...] as const` — the 5 strings from Open
     Question 3.
   - `isSuccessfulGrade(grade: Grade): boolean` → `grade >= SUCCESS_GRADE_THRESHOLD`
   - `pickEncouragementMessage(milestoneIndex: number): string` →
     `ENCOURAGEMENT_MESSAGES[milestoneIndex % ENCOURAGEMENT_MESSAGES.length]`
     (`milestoneIndex` is 0-based: the 1st fired celebration is index 0).

### `web/src/stores/interview.store.ts`
2. Add two new refs alongside the existing state (near `status`/`error`,
   `interview.store.ts:74-75`):
   - `successSinceEncouragement = ref(0)` — not returned from the store setup
     function (internal only), counts successful answers since the last
     celebration fired.
   - `encouragementTrigger = ref(0)` — returned from the store; increments
     once per fired celebration. The view watches this counter rather than a
     boolean so two celebrations in a row (however unlikely at the chosen
     interval) each still register as a change.
3. In `submitAnswer` (`interview.store.ts:196-223`), right after
   `session.value.evaluations.push(evaluation)` (line 213), add:
   ```ts
   if (isSuccessfulGrade(evaluation.grade)) {
     successSinceEncouragement.value++
     if (successSinceEncouragement.value >= ENCOURAGEMENT_INTERVAL) {
       successSinceEncouragement.value = 0
       encouragementTrigger.value++
     }
   }
   ```
   Import `isSuccessfulGrade` and `ENCOURAGEMENT_INTERVAL` from the new
   service.
4. In `reset()` (`interview.store.ts:116-124`), add
   `successSinceEncouragement.value = 0`. Deliberately do **not** reset
   `encouragementTrigger` — it's a monotonic counter the view watches for
   *changes*, not an absolute milestone count; resetting it to `0` on a fresh
   interview risks colliding with its own starting value and needing an extra
   "is this the first render" guard at the call site.
5. Add `encouragementTrigger` to the store's returned object
   (`interview.store.ts:263-283`).

### `web/src/styles/cmps/encouragement.scss` (new)
6. `@keyframes` for the modal's entrance (e.g. scale-and-fade pop-in on the
   panel, a small bounce on the icon) — same authoring pattern as
   `animation.scss`: rely on the global `prefers-reduced-motion` handling
   already in `styles/setup/reset.scss`, no separate opt-out needed here.
   Backdrop gets a plain opacity fade. Load it from `styles/cmps/index.scss`
   in the existing alphabetical/grouped order.

### `web/src/cmps/EncouragementModal.vue` (new)
7. Presentational component. Props: `open: boolean`, `milestoneIndex: number`.
   Emits: `close`.
   - Computes `message = pickEncouragementMessage(props.milestoneIndex)` and
     an icon chosen the same way: a local fixed array of lucide icons
     (`PartyPopper`, `Trophy`, `Sparkles`, `Star`, `ThumbsUp` — matched 1:1 by
     count to the 5 messages so pairing stays stable) indexed by
     `milestoneIndex % icons.length`. Icons are imported here, not in the
     service — `gamification.service.ts` stays a pure module per this
     codebase's convention (`toast-message.service.ts:1-12` states this
     explicitly for its own file; the same reasoning applies here).
   - Backdrop `<div>` + panel, wrapped in Vue's `<Transition name="encouragement">`
     so `open` toggling plays the enter/leave animation declared in
     `encouragement.scss`.
   - Dismiss on: close button click, backdrop click, `Escape` keydown (attach
     the listener only while `open`, following `SettingsMenu.vue:24-30`'s
     add/remove-on-watch pattern), and an auto-dismiss `setTimeout` at
     `AUTO_DISMISS_MS` (imported from `gamification.service.ts` — add this
     constant to the service alongside the others) that's cleared on manual
     dismiss/unmount so it can't fire a duplicate `close`.
   - Icon rendered with explicit `:size` and `aria-hidden="true"`, matching
     every existing icon usage in this app. Panel gets `role="alertdialog"`
     and an `aria-live="polite"` region for the message, since this is an
     unprompted popup, not a user-initiated dialog.

### `web/src/views/InterviewView.vue`
8. Add `const showEncouragement = ref(false)`.
9. Add a second `watch`, alongside the existing `store.status` watch
   (`InterviewView.vue:20-25`):
   ```ts
   watch(
     () => store.encouragementTrigger,
     (next, prev) => {
       if (prev !== undefined && next > prev) showEncouragement.value = true
     }
   )
   ```
   The `prev !== undefined` guard prevents an initial-mount false-positive
   (irrelevant with Vue's default lazy watcher, but keeps the intent explicit
   given `deriveSessionState`-driven rehydration could set a nonzero starting
   value in a future change).
10. Render `<EncouragementModal :open="showEncouragement"
    :milestone-index="store.encouragementTrigger - 1"
    @close="showEncouragement = false" />` inside the `store.session` branch
    of the template, alongside the other status-driven components.

### `.doc/glossary.md`
11. Add an `encouragement` term under the existing `## UI` section, parallel
    to `toast`: *"a milestone popup shown periodically (not per-question)
    after a run of successful answers during an interview, raised via
    `EncouragementModal.vue`. Distinct from a `toast` — it interrupts with a
    dismissible overlay rather than appearing transiently over the UI. Copy
    and cadence live in `web/src/services/gamification.service.ts`."*

## Validation
- **Store**: `web/src/stores/interview.store.spec.ts` — extend with cases:
  `encouragementTrigger` increments after the `ENCOURAGEMENT_INTERVAL`-th
  successful (`grade >= 70`) answer, not before; a run of unsuccessful answers
  never increments it; mixing successful and unsuccessful answers only counts
  the successful ones toward the interval; `reset()` zeroes the internal
  counter so a new interview needs a full fresh interval before its first
  celebration.
- **Service**: new `web/src/services/gamification.service.spec.ts` —
  `isSuccessfulGrade` boundary at exactly `70`; `pickEncouragementMessage`
  cycles correctly past the end of the array (`index = messages.length` wraps
  to index `0`).
- **Component**: new `web/src/cmps/EncouragementModal.spec.ts` — renders the
  expected message/icon for a given `milestoneIndex`; emits `close` on button
  click, on backdrop click, and on `Escape`; emits `close` automatically after
  `AUTO_DISMISS_MS` (Vitest fake timers); does not double-emit `close` if
  manually dismissed before the auto-dismiss timer fires.
- **View**: `web/src/views/InterviewView.spec.ts` — extend so that submitting
  enough successful answers to cross a milestone opens the modal, and that
  `@close` (or auto-dismiss) closes it without disturbing the normal
  question/evaluation flow underneath.
- **Commands**: `cd web && npm test`, `npx vue-tsc --noEmit`, `npm run lint`
  all pass.
- **Manual**: run a mock-mode interview, answer enough questions well to cross
  the interval at least twice, confirm the modal appears only on milestone
  answers (not every question), shows a different message/icon on the second
  appearance than the first, and dismisses correctly by button, backdrop,
  `Escape`, and timeout. Check both light and dark theme, and confirm the
  modal doesn't block submitting the *next* question once dismissed.

## Risks
- **Interval feels wrong once seen live** (too frequent or too rare) — the
  Open Questions above flag this; `ENCOURAGEMENT_INTERVAL` is a single
  exported constant, so adjusting it after a first look is a one-line change.
- **Modal timing collides with the "advancing to next question" flow** — the
  modal is purely additive over `InterviewView.vue`'s existing template and
  reacts only to `encouragementTrigger`, not to `status`, so it can't block or
  reorder the existing `asking → evaluating → reviewing` transitions; worst
  case it's visually simultaneous with the evaluation card, which is the
  intended "celebrate the answer you just gave" moment.
- **First component of its kind (no existing modal to mirror exactly)** —
  mitigated by following `SettingsMenu.vue`'s already-proven open/close-ref +
  `Escape` + outside-click pattern rather than inventing a new one, and by the
  component/view/store specs listed above.

## Rollout Order
1. `gamification.service.ts` + its spec.
2. `interview.store.ts` changes + extended store spec.
3. `encouragement.scss` + `EncouragementModal.vue` + its spec.
4. Wire into `InterviewView.vue` + extended view spec.
5. `.doc/glossary.md` entry.
6. Full `web/` suite, `vue-tsc`, `lint`; manual check in the browser (mock
   mode) per Validation above.

## Addendum (2026-09-07, post-QA)
QA (`.orchestrate/qa-report.md`) passed the feature (863/863 tests, clean
typecheck/lint, clean build) and raised three non-blocking findings, all
addressed directly rather than via a new agent round:
1. **Auto-dismiss timer not restarted on a new milestone.** The watch in
   `EncouragementModal.vue` keyed only on `open`, so a second milestone
   landing while the modal was still up inherited whatever was left of the
   first one's `AUTO_DISMISS_MS` clock. Fixed by keying the watch on
   `[open, milestoneIndex]`, so each milestone now gets its own full timer.
2. **Follow-up answers counted toward a milestone, inconsistent with
   `answeredCount`.** The plan's Steps section was silent on this; resolved
   by excluding follow-ups from the milestone check in `submitAnswer`
   (`!isFollowUpId(question.id) && isSuccessfulGrade(...)`), matching
   `answeredCount`'s own existing "follow-ups are extra depth on a question
   already counted" rule — the celebration cadence now tracks the same
   "answer" the progress bar does.
3. **`role="alertdialog"` was a weak fit and the `aria-live` message risked
   never being announced**, since the whole subtree is inserted already
   populated behind `v-if="open"`. Changed the panel's role to `role="status"`
   (a live-region role that announces on insertion, per this app's own
   precedent in `VoiceInput.vue`), keeping `aria-live="polite"` on the message
   as belt-and-suspenders. No focus trap was added — QA's own note that
   stealing focus mid-typing would be worse than the current behaviour for a
   decorative, self-dismissing popup stands.
Tests updated to match: `EncouragementModal.spec.ts`'s role assertion, and
two `encouragement.adversarial.spec.ts` cases that had documented the old
behaviour as findings now assert the fixed behaviour instead. Full `web/`
suite re-run at 863 tests, `vue-tsc` and `lint` clean.

QA's remaining two items were left as-is, by design: the scrim-color
justification in the frontend report (Finding #4) is documentation-only and
was corrected in this addendum's read of it, no code changed; the missing
in-flight guard on `submitAnswer` (Finding #5) is pre-existing and
unreachable through the UI, already covered by a regression test.

## Addendum (2026-09-07, cadence change)
Follow-up request after the above shipped: show the celebration on **every**
successful answer rather than periodically, superseding this plan's original
Open Question 1 and its `ENCOURAGEMENT_INTERVAL = 2` recommendation (and the
backlog item's own "not after each question" framing, which this direct
request explicitly overrides).

Change: `ENCOURAGEMENT_INTERVAL` in `gamification.service.ts` set to `1`. No
other code changed — the constant already gated the one `if` check in
`submitAnswer`, so this is a one-line change exactly as the original Risks
section anticipated ("a one-line change in `gamification.service.ts` if it
reads as too frequent/rare"). The name `ENCOURAGEMENT_INTERVAL` is kept even
though it now equals 1, since the constant may move again.

Tests updated to match the new cadence:
- `gamification.service.spec.ts`: the cadence-constant test now asserts
  `ENCOURAGEMENT_INTERVAL` equals `1` (was: asserts it is `> 1`).
- `interview.store.spec.ts`'s `encouragement milestones` block: two tests
  whose premise required an interval greater than 1 to observe partial
  progress (`counts only the successful answers toward the interval`,
  `makes a fresh interview earn a full interval again after a reset`) were
  rewritten to assert the same underlying invariants — a weak answer never
  counts, and no state leaks across a `reset()` — using assertions that hold
  at interval `1` (each successful answer now firing its own milestone
  immediately, so those invariants show up as "the trigger increments by
  exactly one per success" rather than as delayed crossing of a threshold).
- `encouragement.adversarial.spec.ts`'s `encouragement milestones — counting
  edge cases` block: the follow-up-exclusion, failed-evaluation, and
  concurrent-submit tests were updated for the new baseline (a single base
  question's success now fires on its own; the concurrent-submit test's
  expected count moved from `1` to `2`, since at interval `1` two concurrent
  successes each earn their own milestone — a more visible illustration of
  the same pre-existing, UI-unreachable double-count risk than before).
- `.doc/glossary.md`'s `encouragement` entry reworded from "periodically
  (not per-question)" to "after each successful answer (not after every
  question — a weak answer earns none)".

All other plan content (dismiss behavior, message pool, threshold, follow-up
exclusion, a11y fixes from the prior addendum) is unchanged. Full `web/`
suite re-run at 863 tests, `vue-tsc` and `lint` clean, `npm run build`
succeeds.

## Addendum (2026-09-07, last-question copy fix)
User-reported bug: the modal's fixed second line, "Keep going — the next
question is waiting.", was shown even when the successful answer that earned
it was the interview's *last* question — there was no next question waiting,
only the report.

Fix: `EncouragementModal.vue` gained an `isLastQuestion?: boolean` prop
(default `false`) and a `note` computed swapping the copy to "That was the
last question — your report is next." when true. `InterviewView.vue` passes
`:is-last-question="store.answeredCount >= store.totalCount"` — the exact
same condition the continue button already uses to switch between "Next
question" and "See your report", so the two stay consistent by construction.

Tests added: `EncouragementModal.spec.ts` (default note vs. last-question
note in isolation) and two new `InterviewView.spec.ts` cases using a full
8-answer run (`CONFIG.questionCount = 8`) to exercise a milestone that
genuinely lands on the last question — every other test in that file answers
fewer than 8, so this condition was previously never reached at all. Full
`web/` suite re-run at 867 tests, `vue-tsc` and `lint` clean.

## Addendum (2026-09-07, root cause of "last question" still saying "keep going")
The copy fix above was correct but insufficient on its own: user testing still
showed "Keep going — the next question is waiting." on the genuine last
question. Root cause, found by inspecting `question-bank.ts`: every curated
bank (`technical.frontend`, `technical.backend`, …, `behavioral`,
`systemDesign`) has exactly **5** entries, while `SetupView.vue`'s
`QUESTION_COUNTS` offers **3, 5, or 7**. Picking `7` (or any count above a
bank's actual size) has always silently delivered fewer questions than
requested — `planEntries()` in `interview.service.ts` caps `selected` to
`bank.length` — but `session.config.questionCount` (what `store.totalCount`,
the progress bar, and the continue button's "Next question"/"See your
report" label all read as "the total") stayed at the number the user picked,
never the number they would actually get. `isLastQuestion`
(`answeredCount >= totalCount`) could therefore never become true once
`totalCount` was an unreachable 7 against a real maximum of 5 — this is a
pre-existing mismatch, not something introduced by plan 019, just newly
visible because this feature was the first thing to read `totalCount` and
show the user text that depends on it being exactly right.

Fix, in `interview.service.ts`'s `createMockInterviewSource().startInterview`:
compute the plan first, then return the session with
`config: { ...config, questionCount: plan.length }` instead of the original
`config` object — `plan.length` is the true number of base questions (bank
entries actually selected, including a job-description-tailored entry when
present) this interview will ask. Confirmed idempotent under `rehydrate()`'s
`planEntries(session.config)` recomputation (re-running the same capping
logic against an already-clamped count reproduces the same plan), and
harmless to every existing test (none configure a `questionCount` above 5).
This is a genuine, general fix: `totalCount`, the progress bar, and the
"See your report" button label were all silently wrong together whenever a
bank ran short, not just the encouragement modal's copy — `isLastQuestion`
was simply the first place anyone noticed.

New test: `interview.service.spec.ts` — `clamps the session config to how
many questions the bank actually has` (requests 7, asserts `session.config
.questionCount` becomes 5, then drives `getNextQuestion` to confirm exactly
5 base questions are ever actually offered).

**Scope note:** this fix covers `mockInterviewSource` only. Whether
`httpInterviewSource`/`api/` has an analogous cap-vs-requested-count mismatch
is unknown and unverified — out of scope here since this backlog item carries
no `stack:full` marker, and fixing it would mean touching `api/`. If the
person reporting this bug is running against the live backend rather than
the mock, this fix will not by itself resolve what they saw, and a follow-up
`stack:full` investigation of `api/`'s own question-count handling would be
needed.

Full `web/` suite re-run at 868 tests, `vue-tsc` and `lint` clean.

## Rollback
Revert the branch's commits. Purely additive: no existing store field, route,
or persisted shape changes — `encouragementTrigger` is a new field nothing
else reads, and nothing here touches `session`/`report` or their persisted
snapshot shape. An older build ignoring the new code would behave exactly as
today. No data cleanup or coordinated deploy ordering needed.
