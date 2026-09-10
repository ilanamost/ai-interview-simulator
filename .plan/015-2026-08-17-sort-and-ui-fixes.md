Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-17

# Sort and UI Fixes: Report Sorting, Detail Card Animation, Dark-Mode Date Picker

## Goal
Three independent improvements to the reports experience. Backlog source:
`.plan/000-backlog.md`: *"Sort and UI fixes: 1. Add a sort option in the Reports
route. I want an option to sort according to the grade, from hight to low or vice
versa, Also sorting by date from latest to oldest and vice versa. 2. Add an
animation to the cards when they appear in the /reports/:id route. 3. In dark
mode, the date picker icon, remains black, should be white."*

All three land on top of what plans 010 (card animation), 011 (theme toggle) and
013 (reports history) already shipped — this plan extends those mechanisms rather
than introducing parallel ones.

## Scope
- **Frontend-only (`web/`).** No `stack:full` marker on the backlog item, and none
  is needed — see Assumptions for why sorting requires no `api/` change.
- In scope:
  1. A sort control on `/reports` (`web/src/views/ReportsHistoryView.vue`) with
     four orderings: date newest→oldest, date oldest→newest, grade high→low,
     grade low→high. Sort state and the ordering itself live in
     `web/src/stores/report-history.store.ts`.
  2. A staggered entrance animation on the cards rendered at `/reports/:id`
     (`web/src/views/ReportHistoryDetailView.vue` via
     `web/src/cmps/ReportCard.vue`), reusing the existing `.card-in` mechanism
     from `web/src/styles/cmps/animation.css`.
  3. A `color-scheme` declaration in `web/src/styles/setup/variables.css` so the
     native date-input calendar glyph (and its popup panel) follow the active
     theme instead of always rendering light-mode black.
- Out of scope:
  - Any `api/` change, including a `sort` query parameter (see Assumptions).
  - Pagination — still out of scope, exactly as in plan 013.
  - Animating the **live** report route `/report` (`ReportView.vue`). The backlog
    names `/reports/:id` specifically, and `ReportView.vue` is already-shipped,
    already-QA'd UI; see Open Questions 1.
  - Sorting the report *entries* inside a single report — "sort in the Reports
    route" is about the list of past interviews, not the question-by-question
    order inside one of them (which is chronological by design).
  - Restyling the date input beyond the theme-correctness fix.

## Assumptions
- **Sorting is client-side, and it must be.** Two independent reasons:
  1. `api/src/routes/interview.routes.ts` validates `GET /api/interview`'s query
     with `validateQuery` against a `.strict()` zod schema (plan 013, Backend
     Steps 2 and 4). Sending `?sort=grade-desc` at that endpoint is a validation
     **400**, not an ignored extra param. Making the server sort would therefore
     require editing `api/`, which this frontend-only task must not do.
  2. Plan 013 deliberately ships **no pagination**: `list()` returns every row
     matching the filters, and the store holds all of them. So a client-side sort
     is not an approximation of a server sort — it sees the complete result set and
     produces exactly the same ordering a server `ORDER BY` would. This is the
     reason sorting is legitimately a frontend concern here, and it is worth
     recording: if pagination is ever added, sorting has to move server-side with
     it.
- **Sort state belongs in the store, not the view.** `report-history.store.ts`
  already owns `list`, `filters`, `status` and the request-token sequencing. Adding
  `sort` there keeps one owner of "what the screen is showing", makes the ordering
  unit-testable without mounting a component, and means the view stays declarative
  (`v-for="item in store.sortedList"`). `list` keeps holding the source's own order
  (newest-first) untouched; a new `sortedList` computed derives the displayed order
  from it. Deriving rather than re-sorting `list` in place matters: re-sorting the
  same array under two different orderings would make the store's state depend on
  the order operations happened in.
- **Sort must not be part of `filters`.** `hasFilters` is
  `Object.values(filters.value).some(Boolean)` and drives two visible behaviours:
  the "Clear filters" button's `v-if`, and whether the empty state reads "No
  interviews match these filters" or "You have not finished an interview yet."
  Sort always has a value, so folding it into `filters` would pin `hasFilters` to
  `true` forever — the clear button would never hide and a brand-new user with zero
  interviews would be told their filters matched nothing. Sort is a separate ref.
- **Changing the sort must not refetch.** `ReportsHistoryView.vue` currently does
  `watch(form, load)`, firing one `fetchList` per filter change. The sort control
  must therefore live **outside** that `form` reactive object, or every sort change
  would trigger a redundant network read (and, given the request-token logic, a
  loading flicker) to re-receive rows the store already has. Re-sorting is pure
  local computation.
- **Default sort is date newest→oldest**, which is exactly today's behaviour (both
  sources already return newest-first, and the page copy says "newest first"). So
  the visible default does not change; the control starts on the ordering the page
  already had.
- **Grade ties break by date, newest first.** `overallGrade` is a small integer, so
  ties are common with a handful of interviews. An explicit secondary comparison
  makes the order deterministic and provable in a test, rather than relying on
  `Array.prototype.sort` stability over whatever order the source happened to
  return.
- **The animation reuses `.card-in`, opt-in via a prop.** `ReportCard.vue` is
  shared by `ReportView.vue` (live report) and `ReportHistoryDetailView.vue` (past
  report) — plan 013 extracted it precisely so both render identically. Adding
  `card-in` unconditionally inside it would animate the live report too, which the
  backlog did not ask for and which plan 010 explicitly kept out of scope. So
  `ReportCard.vue` gets an `animate?: boolean` prop defaulting to `false`, and only
  the history detail view passes `animate`. `ReportView.vue` is not edited at all,
  which is the cheapest possible guarantee that the live report screen is
  unchanged.
  A CSS-only alternative (`.report-detail > .card { animation: … }`) was considered
  and rejected: `ReportCard.vue` is a fragment, so its cards are direct children of
  the parent `<section>` **alongside** the back-link `<p>`, the `<h2>`, and the
  download `<button>` — any `nth-child` stagger would be counting those siblings
  too and would silently break the moment that markup shifts.
- **Stagger reuses the existing capped helper.** `HomeView.vue` already defines
  `STAGGER_STEP_MS`, `MAX_STAGGER_MS = 250` and `staggerStyle(index)` locally
  (`web/src/views/HomeView.vue`). A report can render many cards (5 questions by
  default, plus follow-ups, plus the two header cards), so the cap is not optional
  here. Rather than copy the helper, extract it to one shared module and have both
  call sites use it — same values, so `HomeView.spec.ts`'s existing delay
  assertions must keep passing unchanged.
  The cap matters for a second reason specific to this repo: the global
  reduced-motion rule in `web/src/styles/setup/reset.css` neutralises
  `animation-duration` with `!important` but **not** `animation-delay`, and the
  stagger sets delay inline (the highest-priority origin). A reduced-motion user
  therefore still waits out the delay on a card held at `opacity: 0` by
  `animation-fill-mode: both`. 250ms total is imperceptible; an uncapped
  `index * step` over a dozen cards would not be.
- **The black date-picker glyph is a missing `color-scheme`, not a missing icon
  colour.** Confirmed by search: `color-scheme` appears nowhere in
  `web/src/styles/` today. Without it the UA renders form controls in its light
  scheme regardless of the app's tokens, so `input[type="date"]`'s built-in
  calendar indicator stays dark and its popup panel stays white — the tokens in
  `variables.css` never reach UA-drawn chrome. Declaring `color-scheme: light` in
  `:root` and `color-scheme: dark` in the two existing dark blocks fixes the glyph,
  the popup, and every other UA-drawn control at once, in Chromium **and** Firefox.
  A `::-webkit-calendar-picker-indicator { filter: invert(1) }` hack would repaint
  only the glyph, only on Chromium, and would leave a blinding white calendar popup
  in dark mode. See Open Questions 2.
- **The three dark-mode selectors are already correct and must not be
  restructured.** Plan 011 established `:root` / `@media (prefers-color-scheme:
  dark) { :root:not([data-theme='light']) }` / `:root[data-theme='dark']`. The
  `color-scheme` declaration goes into those same three blocks — it is a normal
  declaration, not a custom property, so it participates in the cascade there
  exactly as the colour tokens do, and it automatically respects both the OS
  preference and the manual toggle with no new mechanism.
- **Only one date input exists** (`#filter-date` in `ReportsHistoryView.vue`), so
  the visible symptom is confined to `/reports` — but the fix is deliberately
  global, since the next date or time input added would otherwise reintroduce it.

## Open Questions
1. **Should the live report route `/report` animate its cards too, now that the
    history detail route does?** The two screens render identical markup, so they
    will visibly differ. *Recommended: no.* The backlog names `/reports/:id`
    specifically, and leaving `ReportView.vue` untouched is what guarantees no
    regression on an already-shipped screen. The `animate` prop makes it a
    one-line follow-up if the inconsistency turns out to bother you once seen.
2. **Adopt `color-scheme` globally, or patch just the calendar glyph?**
    *Recommended: global `color-scheme`* (see Assumptions). It is the standards
    mechanism, fixes Firefox and the popup panel as well, and needs no
    browser-prefixed pseudo-element. The trade-off to eyeball during QA: it also
    darkens other UA-drawn chrome — native `<select>` dropdown lists, autofill
    backgrounds, default scrollbars. That is the intended outcome, but it does
    change pixels on `/practice` and `/settings` as well as `/reports`, so it needs
    a look in both themes before merge.
3. **Should "Clear filters" also reset the sort to the default?** *Recommended:
    no.* Sort is a view preference about how the results are ordered, not a
    predicate that hides rows; silently reordering the list when someone clears a
    filter would be surprising. The button's label says filters, so it should touch
    filters only.
4. **One `<select>` with four options, or a field select plus a direction toggle
    button?** *Recommended: one `<select>` with four options*, placed in the
    existing `.field-grid` alongside the four filter controls. It matches the form
    pattern already on the page, is one tab stop instead of two, labels every
    ordering in plain words ("Newest first", "Highest grade first"), and needs no
    new icon or aria-pressed state.

## Steps

### 1. Sorting on `/reports`
1. `web/src/stores/report-history.store.ts`:
   - Export a `ReportHistorySort` union — `'date-desc' | 'date-asc' |
     'grade-desc' | 'grade-asc'` — and a `sort` ref defaulting to `'date-desc'`
     (today's behaviour), plus a `setSort(next)` action.
   - Add a `sortedList` computed that returns a **new** array (never sorts `list`
     in place), comparing `createdAt` with `localeCompare` for the date orderings
     (ISO-8601 strings sort lexicographically, the comparison
     `report-history.service.ts` already relies on) and numerically on
     `overallGrade` for the grade orderings, with `createdAt` descending as the
     tie-break in both grade directions.
   - Leave `reset()` restoring `sort` to the default along with everything else,
     so a fresh visit is not carrying a previous session's ordering.
   - Do **not** add `sort` to `filters`, and do not touch `fetchList`,
     `fetchDetail`, or the request-token logic (see Assumptions).
2. `web/src/views/ReportsHistoryView.vue`:
   - Add a "Sort by" `<select>` as a fifth `.field` inside the existing
     `.field-grid`, bound to `store.sort` through `setSort` (a plain
     `v-model="store.sort"` would also work with Pinia, but going through the
     action keeps one write path and is what the store test asserts). Its options
     are the four labelled orderings.
   - Keep this select **outside** the `form` reactive object that `watch(form,
     load)` observes, so changing it re-sorts without refetching.
   - Change the list `v-for` from `store.list` to `store.sortedList`.
   - Soften the header copy that currently hardcodes "newest first" — it becomes
     wrong the moment another ordering is picked.
3. Labels live next to the other option labels: either extend
   `web/src/services/label.service.ts` with a `REPORT_SORT_LABEL` map, matching how
   `JOB_TITLE_LABEL` / `EXPERIENCE_LEVEL_LABEL` / `INTERVIEW_TYPE_LABEL` already
   pair a union with its display strings, or keep the map beside the union in the
   store. Prefer `label.service.ts` for consistency with the four controls already
   on this form.

### 2. Card entrance animation on `/reports/:id`
4. New `web/src/services/animation.service.ts` (pure module, same
   no-IO-"service" shape as `label.service.ts`): move `STAGGER_STEP_MS`,
   `MAX_STAGGER_MS` and `staggerStyle(index)` out of `HomeView.vue` verbatim —
   same numbers, so no existing delay assertion changes — and export them.
   > Note for the next backlog item ("no hard coded values … constants in a
   > relevant utils file"): these two constants are exactly that kind of value.
   > Put them in one place now; that later task can relocate the module if it
   > introduces a `utils` home. Do not pre-empt it here.
5. `web/src/views/HomeView.vue`: delete the local helper and constants, import
   them from `animation.service.ts`. No template change.
6. `web/src/cmps/ReportCard.vue`: add an `animate?: boolean` prop (default
   `false`). When true, add `card-in` to each of the cards it renders — the
   `header.card`, the feedback `div.card`, and every `article.card.report-entry`
   — with an inline `:style="staggerStyle(index)"` delay that increases across
   that sequence (header first, feedback second, then the entries in order), so
   the report reads top-down. When false, render exactly what it renders today:
   no `card-in` class and no inline style attribute.
7. `web/src/views/ReportHistoryDetailView.vue`: pass `animate` to `ReportCard`.
   Nothing else on this view changes.
8. `web/src/views/ReportView.vue`: **not edited.** Listed explicitly so the
   omission reads as deliberate rather than forgotten.
9. No new CSS is needed for this item — `.card-in` and its `@keyframes` already
   exist in `web/src/styles/cmps/animation.css`. Add nothing there unless the
   report cards genuinely need a different rise distance, in which case override
   `--card-in-rise` from `history.css` rather than duplicating the keyframes.

### 3. Dark-mode date picker glyph
10. `web/src/styles/setup/variables.css`: add `color-scheme: light` to the
    `:root` block, and `color-scheme: dark` to both dark blocks — the
    `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` one
    and the `:root[data-theme='dark']` one. Keep the file's existing comment
    structure intact; add a short comment explaining that this is what makes
    UA-drawn controls (the date input's calendar glyph and popup) follow the
    theme, since the reason is not obvious from the declaration.
11. Re-check the custom scrollbar rules in `web/src/styles/basics/base.css`
    (plan 010) still look right — they reference tokens and set explicit
    `::-webkit-scrollbar*` colours, so they should override the new UA default
    rather than fight it, but confirm rather than assume, in both themes.
12. Only if manual checking shows the glyph is still hard to see in dark mode,
    add a narrow `::-webkit-calendar-picker-indicator` rule under
    `web/src/styles/cmps/form.css` as a supplement — not as the primary fix, and
    only with a comment saying why `color-scheme` alone was insufficient.

## Validation
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — all green.
- New/updated tests:
  - `report-history.store.spec.ts`: `sortedList` returns each of the four
    orderings correctly from a fixture with mixed dates and grades, including at
    least one grade tie proving the newest-first tie-break; `sortedList` does not
    mutate `list` (assert `list`'s order is unchanged after reading each
    ordering); `sort` defaults to `'date-desc'`; `setSort` updates it; `reset()`
    restores the default; **`hasFilters` stays `false` after `setSort`** (the
    regression Assumptions calls out).
  - `ReportsHistoryView.spec.ts` (or `reports-history-flow.spec.ts`): the sort
    select renders with four options; picking each one reorders the rendered rows;
    **changing the sort issues no additional `list()` call on the injected source
    stub** (assert the call count is unchanged), while changing a filter still
    does; the "Clear filters" button still hides when no filters are set even
    after a sort change; the zero-interviews empty state still reads as "not
    finished an interview yet", not "no interviews match these filters".
  - `ReportCard.spec.ts`: with `animate` unset, no element carries `card-in` and
    no element carries an inline `animation-delay` (this is the `ReportView.vue`
    regression guard); with `animate` set, every rendered `.card` carries
    `card-in`, delays are non-decreasing in render order, and the largest delay
    does not exceed `MAX_STAGGER_MS`.
  - `ReportHistoryDetailView.spec.ts`: the detail route's cards carry `card-in`;
    `ReportView.spec.ts` asserts its cards do not.
  - `HomeView.spec.ts`: unchanged and still passing — proof the
    `staggerStyle` extraction changed no values. Same for
    `card-animation.adversarial.spec.ts`, whose "nothing outside the two named
    views got animated" assertions are scoped to `HomeView`/`SetupView`/
    `LoginView` and must stay true.
  - A source-level assertion (same technique
    `card-animation.adversarial.spec.ts` already uses — `readFileSync` on the CSS,
    because vitest stubs CSS imports to an empty string) that
    `web/src/styles/setup/variables.css` declares `color-scheme` in all three
    theme blocks. jsdom paints no UA chrome, so this is the only automatable
    check for item 3; the visual confirmation is manual.
- Manual, `npm run dev`:
  - `/reports` with several finished interviews across different days and grades:
    each of the four orderings reorders the list correctly, the ordering survives
    a filter change, and no loading flicker appears when only the sort changes.
  - `/reports/:id`: cards fade and rise in top-down on load, the stagger finishes
    quickly even on a report with follow-up questions, and with the OS
    reduced-motion setting on they appear effectively instantly.
  - `/report` (live, right after finishing an interview): cards appear with **no**
    animation — unchanged from today.
  - Dark mode via the header toggle **and** via the OS preference with no stored
    choice: the `/reports` date filter's calendar glyph is light against the dark
    control, and opening the picker shows a dark popup panel, in Chromium and
    Firefox. Then light mode: the glyph is dark again, nothing inverted. Also
    glance at the `<select>` dropdowns on `/practice` and `/reports` and the
    scrollbars on a long page in both themes (Open Questions 2).

## Risks
- **`color-scheme` has app-wide visual reach.** It is the correct fix, but it
  repaints UA chrome well beyond the one date input that prompted it — native
  select popups, autofill highlight, default scrollbars. The manual both-themes
  sweep above is not optional, and it is the reason this item is sequenced last in
  the rollout: it should land where it can be eyeballed on its own rather than
  mixed into the sort diff.
- **Touching `ReportCard.vue` touches the live report screen.** Plan 013 flagged
  exactly this risk when extracting the component, and it applies again. The
  `animate` prop defaulting to `false` plus the paired
  `ReportCard.spec.ts`/`ReportView.spec.ts` assertions are what keep it honest.
- **Sort silently regressing the filter semantics.** The two subtle failure modes
  — `hasFilters` becoming permanently true, and a sort change firing a refetch
  through `watch(form, load)` — both produce working-looking UI with wrong
  behaviour (a clear button that never hides, a spinner on every sort change).
  Both have explicit tests listed above precisely because neither would be caught
  by "the rows are in the right order".
- **Extracting `staggerStyle` reaches into a shipped screen.** `HomeView.vue`'s
  animation is covered by two spec files with hardcoded delay expectations. Move
  the helper with its values byte-identical; if any HomeView delay assertion
  changes, the extraction is wrong, not the test.
- **A client-side sort becomes a lie the moment pagination exists.** Recorded in
  Assumptions; nothing to do now, but whoever adds pagination has to move sorting
  to the server in the same change.

## Rollout Order
1. Sorting: store (`sort`, `setSort`, `sortedList`) with its unit tests green
   first, then the view's select — the ordering logic is provable before any
   markup depends on it.
2. Animation: extract `animation.service.ts` and repoint `HomeView.vue` (existing
   HomeView specs must stay green at this point, with no visible change anywhere),
   then add the `animate` prop and pass it from the history detail view.
3. `color-scheme`: last, as its own small diff, so the app-wide visual sweep is
   reviewed in isolation.
4. QA pass, including the full light/dark, reduced-motion, and
   live-report-unchanged manual checks above.

## Rollback
Every item is additive and presentational, with no API surface, no schema, and no
persisted-data change. Reverting the branch's merge commit removes the sort
control (the list falls back to the source's newest-first order, which is the
default anyway), the `animate` prop (`ReportCard.vue` returns to its current
markup for both consumers), and the `color-scheme` declarations (UA chrome returns
to its light-scheme default, i.e. the black glyph). Any single item can also be
reverted on its own — they share no code beyond `animation.service.ts`, which only
item 2 touches.
