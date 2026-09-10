Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-14

# Reports History (stack:full)

## Goal
A route where a signed-in user can browse, view, and download every past
interview report they've completed, filterable by date, job title, interview
type, and experience level — plus header nav links to every top-level route
with a visible "you are here" indicator. Backlog source: `.plan/000-backlog.md`:
*"Add a reports history route where I can view and download all previous
reports for the user. It should also have a date filter to display reports
for a specific date, and filters of 'Job title', 'Interview type' and
'Experience level' same as appear in the 'practice' route. add links for all
existing routes to the application header. Add a UI indication for the
selected link that we are currently on."*

Confirmed `stack:full` with the human before planning (no marker on the
backlog item, but the feature is impossible without backend work — see
Assumptions).

## Scope
- `stack:full` — touches `api/` and `web/`.
- In scope:
  - `api/`: one new endpoint, `GET /api/interview` (list, filterable,
    org-scoped), plus its repository query and tests. No new tables, no
    schema change — every row this needs already exists.
  - `web/`: a `report-history` service/store pair (mirroring the existing
    `InterviewSource`/`interview.store.ts` mock-vs-http pattern), a list view
    with filters, a detail view for one historical report, and header nav
    links with an active-route indicator.
- Out of scope: pagination (see Assumptions — local-dev scope, no page-count
  problem to solve yet); editing or deleting a past interview; exporting
  anything other than the existing single-report PDF.

## Assumptions
- **Why this is `stack:full` despite no marker.** Checked before writing this
  plan: `api/src/routes/interview.routes.ts` has no endpoint that returns more
  than one interview — every existing route (`POST /`, `GET /:id`, `GET
  /:id/question`, `POST /:id/answer`, `GET /:id/report`) operates on a single
  ID. A history *list* needs a new query. Separately, `mock` mode
  (`web/src/services/session-storage.service.ts`) keeps exactly one snapshot
  key, overwritten on every interview — it has no memory of past interviews
  at all today, so "view all previous reports" needs a new local history
  mechanism there too. The human chose the full-stack option: build both, so
  the feature behaves identically regardless of `VITE_INTERVIEW_SOURCE`.
- **Only one new backend endpoint, not two.** Fetching one historical
  report's full detail does **not** need a new route:
  `GET /api/interview/:id` and `GET /api/interview/:id/report` already exist
  and already return everything a detail view needs. Only the *list* is new.
  This keeps the backend surface small.
- **List membership: only interviews with at least one evaluation.**
  `api/src/services/interview.service.ts`'s existing `getReport` already 422s
  with `NO_EVALUATION` when an interview has none — "a report exists" is
  already defined by the codebase as "at least one evaluation exists." The
  history list uses the same definition: an interview the user started but
  never answered a single question on doesn't appear, matching what "no
  report to show yet" already means everywhere else in the app.
- **Overall grade is a fresh aggregate, not a stored column.**
  `api/src/services/interview.service.ts:46-47` computes `overallGrade` as
  `Math.round(average of every evaluation's grade)` — base and follow-up
  evaluations alike, no filtering. The list endpoint mirrors this exactly via
  one grouped SQL aggregate (`avg(grade) ... group by interview_id`) rather
  than fetching every question/answer per interview just to summarize it —
  cheap, and provably consistent with the number the detail view will show
  for the same interview.
- **No pagination.** `.doc/product-definition.md`'s operational constraints
  say "single developer; local development first." Returning every matching
  interview for the org in one response is fine at this stage; a page-size
  problem is a future-scale concern this app doesn't have yet. Filters (date/
  job title/type/level) are the only way results narrow, which is what the
  backlog asked for.
- **Detail view is a separate route, not a repurposed live `ReportView.vue`.**
  `interview.store.ts`'s `session`/`report` are the *live* session — they're
  what `session-storage.service.ts` auto-persists on every change (a `watch`
  in the store) to make the "resume where I left off" feature work. Loading a
  historical report into those same fields would silently overwrite that
  resumable snapshot with old data. So historical viewing gets its own store
  (`report-history.store.ts`) and its own route (`/reports/:id`), entirely
  independent of the live interview flow. The read-only report markup itself
  (header, strengths/improvements, per-question entries — currently ~60 lines
  inline in `ReportView.vue`) is worth extracting into a shared presentational
  component (`ReportCard.vue`, props: `session`/`report`, no store access) so
  both `ReportView.vue` (the live report) and the new historical detail view
  render it identically without copy-pasting — this is a real second consumer
  of substantial markup, not a premature abstraction.
- **Download stays a detail-view action, not a list-row action.** Generating
  the PDF (`report-pdf.service.ts`) needs the full session + report, not the
  list summary. Keeping "Download PDF" on the detail view (as it already is
  on the live `ReportView.vue`) means one download code path, not two.
- **Header nav links cover the top-level, always-relevant routes only:**
  Home, Practice, Reports (new), Settings. `Interview` and the live `Report`
  route are session-scoped and guarded (`requiresSession`/`requiresReport`)
  — linking to them from a static nav bar would just redirect away when
  there's no active session, which isn't useful navigation. "All existing
  routes" is read as "all routes meaningful to link to at any time," not
  including screens that only make sense mid-flow.
- **Mock-mode history cap: 50 entries, oldest dropped first.** Same
  bounded-growth reasoning `session-storage.service.ts` already applies (its
  24h expiry exists so storage doesn't grow forever) — a hard cap here serves
  the same purpose for an unbounded append-only list. 50 is generous for
  local manual testing and small enough that `localStorage`'s per-origin
  quota is never a practical concern.

## Open Questions
None — every design decision above has a stated default; revise if any
doesn't match what's wanted once seen.

## Steps

### Backend (`api/`)
1. `api/src/repositories/interview.repository.ts`: new `listInterviews(org,
   filters)` — one query joining `interview` to a `group by interview_id`
   aggregate over `evaluation` (`avg(grade)`, and only interviews with
   `count(*) > 0`, satisfying the "has a report" rule above), filtered by
   optional `date` (match `created_at`'s calendar day), `jobTitle`, `level`,
   `type`. Returns id/config fields/`createdAt`/`overallGrade` per row, newest
   first. Every query still scoped by `org` per `.rule/security-rules.md`.
2. `api/src/middleware/validate.ts`: add `validateQuery` (mirrors the existing
   `validateBody`/`validateParams` exactly — `.strict()` zod schema against
   `req.query`).
3. `api/src/services/interview.service.ts`: thin `listInterviews(org,
   filters)` passthrough to the repository, matching this file's existing
   style for the other five operations.
4. `api/src/routes/interview.routes.ts`: `GET /` (i.e. `GET /api/interview`),
   `validateQuery` against a `.strict()` schema with all four filters
   optional (`date` as `YYYY-MM-DD`, `jobTitle`/`level`/`type` from the
   existing enums) — mounted the same as every other route here, behind
   `require-auth`, `org` from `getAuth(req)`.
5. Tests: repository (each filter alone and combined, org scoping, an
   interview with zero evaluations correctly excluded, grade average matches
   `buildReport`'s formula for the same data), route (query validation
   rejects a bad date/enum value, response shape, 401 without auth).
6. Extend `.orchestrate/api-contract.yaml` with the new `GET /interview` path
   and its query parameters/response schema.

### Frontend (`web/`)
7. New `web/src/services/report-history.service.ts`: a `ReportHistorySource`
   contract (mirrors `InterviewSource`'s shape) —
   `list(filters): Promise<InterviewSummary[]>` and `getDetail(id):
   Promise<{ session: InterviewSession; report: Report } | null>` — with two
   implementations selected by `env.interviewSource`, exactly like
   `interview.service.ts`'s existing mock/http factory:
   - `httpReportHistorySource`: `list` calls the new `GET /api/interview`
     with query params; `getDetail` calls the two already-existing endpoints
     (`GET /api/interview/:id`, `GET /api/interview/:id/report`) — nothing new
     needed there.
   - `mockReportHistorySource`: reads/writes a new, capped (50-entry),
     versioned `localStorage` array (new key, separate from
     `session-storage.service.ts`'s single-snapshot key — different shape,
     different lifecycle, don't conflate them) holding full session+report
     pairs (mock has no server to re-fetch from, so `getDetail` must find
     everything locally); `list` filters that array in JS using the same
     filter semantics as the backend query.
8. `web/src/stores/interview.store.ts`: after `finish()` successfully builds
   a report, call a new `recordCompletedInterview(session, report)` from
   `report-history.service.ts` — a no-op under `http` (the server already has
   it durably; no client-side duplication) and an append-and-cap under `mock`.
9. New `web/src/stores/report-history.store.ts` (Pinia): `list`, `filters`,
   `isBusy`, `error`; a `fetchList(filters)` action calling through the
   service. Follows `interview.store.ts`'s existing convention (throw on
   failure, UI catches and toasts) — **not** `auth.store.ts`'s (toast lives in
   the view), per the UI-owns-toasts direction established in
   `.plan/009-2026-08-13-pinia-store-api-calls.md`.
10. New `web/src/cmps/ReportCard.vue`: the extracted presentational markup
    from `ReportView.vue` (props: `session`, `report`; no store access).
    `ReportView.vue` is updated to render it instead of its inline markup,
    with no visible change to the live report screen.
11. New `web/src/views/ReportsHistoryView.vue`: filter controls (date input;
    job title/level/type selects reusing `JOB_TITLES`/`EXPERIENCE_LEVELS`/
    `INTERVIEW_TYPES` and `label.service.ts`'s labels — the exact set
    `SetupView.vue` already uses, per the backlog's "same as appear in the
    'practice' route"), a list of matching past interviews (date, config
    summary, `GradeBadge`), each row linking to `/reports/:id`. Empty state
    when no interviews match (or none exist yet).
12. New `web/src/views/ReportHistoryDetailView.vue`: loads one historical
    entry via `report-history.store.ts`, renders `ReportCard.vue` with it,
    plus "Download PDF" (reusing `downloadReportPdf` unchanged) and a "Back
    to history" link — no "Run another interview" button, this isn't the live
    flow.
13. `web/src/router/index.ts`: `{ path: '/reports', name: 'reports',
    meta: { requiresAuth: true } }` and `{ path: '/reports/:id', name:
    'report-detail', meta: { requiresAuth: true } }` — plain `requiresAuth`
    like `home`/`setup`/`settings`, no dependency on a live session/report.
14. `web/src/App.vue`: header nav links for Home, Practice, Reports, Settings
    (see Assumptions for why not Interview/Report), each showing an active
    state when it's the current route — Vue Router's built-in
    `router-link-active`/`router-link-exact-active` classes are sufficient
    here, styled via new rules referencing existing tokens (no new active-
    state mechanism needed).
15. New/extended stylesheet under `web/src/styles/cmps/` for the nav links,
    filter form, and history list rows — tokens only, no inline styles, per
    `.claude/rules/ui-and-styling.md`.

## Validation
- `cd api && npm run typecheck && npm run lint && npm test` — covers every
  item in Backend Steps 5.
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — new/updated
  tests cover: `report-history.service.ts`'s mock implementation (list
  filtering logic, the 50-entry cap, append behavior) and http implementation
  (correct query params sent, correct endpoints called for detail); `report-
  history.store.ts`'s `fetchList` action; `ReportsHistoryView.vue` (filters
  narrow the list, empty state, row navigation); `ReportHistoryDetailView.vue`
  (renders the right entry, download button works, "not found" for a
  nonexistent/foreign-org id); `ReportCard.vue` used identically by both
  `ReportView.vue` (regression — the live report screen must look and behave
  exactly as before) and the new detail view; header nav active-state
  reflects the current route across all four linked pages; a completed
  interview under `mock` actually appears in the history list afterward
  (the full round trip, not just the service in isolation).
- Manual: `npm run dev`, complete two or three practice interviews with
  different job titles/types, visit `/reports`, confirm all of them appear,
  filter down to one, open its detail, download the PDF, confirm the header
  nav correctly highlights whichever page is active on every route. Repeat
  with `VITE_INTERVIEW_SOURCE=http` against a real local Postgres with a
  couple of completed interviews already in it.

## Risks
- The mock-mode history array is a genuinely new persistence mechanism (not
  just reusing `session-storage.service.ts`) — get its versioning/cap logic
  wrong and either storage grows unbounded or old entries silently vanish;
  cover both directions in tests, not just the happy path.
- `GET /api/interview` sits at the same path prefix as every existing
  interview route — double-check the Express route ordering in
  `interview.routes.ts` doesn't let `GET /:id` shadow or conflict with the
  new list route (Express matches literal segments before params, so `GET /`
  vs `GET /:id` shouldn't collide, but confirm rather than assume).
- Extracting `ReportCard.vue` touches the already-shipped, already-QA'd live
  `ReportView.vue` — the Validation section's regression test for it is not
  optional.

## Rollout Order
1. Backend: repository + service + route + `validateQuery` + tests, landed
   and green before the frontend consumes it (same rollout order the
   authentication plan used, for the same reason: the frontend needs a real
   API and a recorded contract to build against).
2. Frontend: service/store pair, `ReportCard.vue` extraction (with the
   `ReportView.vue` regression check), the two new views, router, header nav.
3. QA pass, including the mock-and-http manual walkthrough above.

## Rollback
Backend addition is a new read-only endpoint plus a new repository query —
no schema change, easily reverted. Frontend addition is new routes/views plus
one extracted shared component; reverting the branch's merge commit restores
`ReportView.vue`'s previous inline markup and removes the nav links/routes
with no data loss (mock-mode history is a separate localStorage key that
simply stops being read).
