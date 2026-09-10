Status: done
Owner: Ilana
Last updated: 2026-09-06

# Reports History Pagination (stack:full)

## Goal
The `/reports` list (`ReportsHistoryView.vue`) fetches and renders every matching
interview at once. Add real pagination end to end: `GET /api/interview` accepts
`page`/`pageSize`/`sort` and returns a `total`, and the frontend requests one page
at a time instead of the whole history.

Backlog source: `.plan/000-backlog.md`: *"Add pagination for the reports history
data."* No `stack:full` marker on the backlog item. Confirmed `stack:full` with the
human during planning: the initial recommendation was client-side windowing (no
`api/` change, since the mock source is capped at `MAX_HISTORY_ENTRIES = 50` and
paginating in-memory costs nothing); the human asked instead for real server-side
pagination, which is impossible without changing `GET /api/interview` — see Scope.

## Scope
- `stack:full` — touches `api/` and `web/`.
- In scope:
  - `api/`: extend `GET /api/interview`'s query schema, repository query, and
    response shape to support `page`, `pageSize`, `sort`, and a `total` count.
  - `web/`: extend `ReportHistorySource.list()` to send `page`/`pageSize`/`sort`
    and return `{ items, total }`; move sorting out of the store (it becomes a
    server concern) and into the request; add a `Pagination` component; wire it
    into `ReportsHistoryView.vue`.
- Out of scope: changing what a page of results contains (filters stay exactly
  `date`/`jobTitle`/`level`/`type`); any schema/migration change — `interview` and
  `evaluation` already carry every column this needs; the mock source's 50-entry
  cap (unrelated: that bounds total history kept, not page size).

## Assumptions
- **Page size**: 10, sent by the frontend as `pageSize` on every request rather than
  hardcoded server-side, so a future UI page-size picker needs no API change.
  Backend clamps `pageSize` to `[1, 50]` and defaults to `10` if omitted, so a bad or
  missing value can't force an unbounded query.
- **`page` is 1-based**, defaulting to `1` if omitted — matches how the store already
  thinks about "page" in the UI, no off-by-one translation at either layer.
- **`sort` moves server-side.** `report-history.store.ts:98-106` already carries a
  comment saying exactly this has to happen once pagination lands: sorting a page
  independently of the full ordering would put the wrong rows on each page. `sort`
  becomes a query param with the same four values the store's `REPORT_SORTS`
  already defines (`date-desc` | `date-asc` | `grade-desc` | `grade-asc`), applied as
  the SQL `ORDER BY` before `LIMIT`/`OFFSET`, and the store's client-side `COMPARE`/
  `sortedList` computed goes away — `list.value` is now already-sorted, already-paged
  server output.
- **Pagination technique: `LIMIT`/`OFFSET`.** No pagination convention exists
  anywhere else in `api/` (checked: no other list endpoint). Keyset/cursor pagination
  would perform better at large scale, but `OFFSET` is simplest to reason about and
  test, and history sizes here are small (bounded by how many interviews one org has
  actually run) — not worth the added complexity for the first pagination endpoint
  in this backend.
- **Changing a filter or the sort resets to page 1** on the frontend (a stale page
  number against a new, smaller result set would render an empty page instead of
  results).

## Open Questions
None outstanding — the client-vs-server-side pagination question was resolved above
during planning.

## Steps

### Backend (`api/`)
1. `api/src/routes/interview.routes.ts`: extend `listInterviewQuerySchema` with
   `page: z.coerce.number().int().min(1).optional()`,
   `pageSize: z.coerce.number().int().min(1).max(50).optional()`, and
   `sort: z.enum(['date-desc', 'date-asc', 'grade-desc', 'grade-asc']).optional()`
   (`z.coerce` because query params arrive as strings). Update the `GET /` handler
   to pass these through to `service.listInterviews` and to respond
   `res.status(200).json({ interviews: result.items, total: result.total })`.
2. `api/src/repositories/interview.repository.ts`: change `listInterviews`'s
   `ListInterviewFilters` type (or a new `ListInterviewQuery` type) to add
   `page?`, `pageSize?`, `sort?`; change the return type to
   `Promise<{ items: InterviewSummary[]; total: number }>`.
   - Apply `ORDER BY` from `sort` (map each of the four values to
     `i.created_at desc/asc` or `avg(e.grade) desc/asc, i.created_at desc` — same
     tie-break-by-newest logic the frontend's `COMPARE` map used, kept in SQL now:
     `order by avg(e.grade) desc, i.created_at desc` etc.). Default to
     `i.created_at desc` when `sort` is omitted, matching today's hardcoded
     behavior.
   - Add `limit $n offset $n` using the resolved `pageSize`/`page`, appended after
     `group by i.id` and the new `order by`.
   - `total` needs the filtered-but-unpaginated count: since the query already
     groups by `i.id` (one row per interview), wrap it as
     `select count(*) from (<query without limit/offset/order-by-needed>) as
     counted`, or run a second `count(distinct i.id)` query reusing the same
     `conditions`/`params` — either works; prefer whichever keeps `conditions`/
     `params` shared between both queries rather than duplicated.
3. `api/src/services/interview.service.ts`: `listInterviews` stays a passthrough,
   just typed against the new query/result shapes.
4. `api/src/types/interview.ts`: no change to `InterviewSummary` itself; add
   the paginated-response type where the route/service need it (co-locate with
   `InterviewSummary` since nothing else currently plays this "list response
   wrapper" role).

### Frontend (`web/`)
5. `web/src/services/report-history.service.ts`:
   - Add `ReportHistoryQuery extends ReportHistoryFilters { sort?: ReportHistorySort; page?: number; pageSize?: number }` and `ReportHistoryPage { items: InterviewSummary[]; total: number }`.
   - Move `REPORT_SORTS`, `ReportHistorySort`, `DEFAULT_REPORT_SORT` here from
     `report-history.store.ts` (they're now part of the request contract, not a
     display-only concern) and the `COMPARE`-equivalent tie-break comment can be
     deleted — the backend now owns ordering.
   - Change `ReportHistorySource.list(query?: ReportHistoryQuery): Promise<ReportHistoryPage>`.
   - `createMockReportHistorySource`: after `matchesFilters`, sort in-memory using
     the same four orderings (this logic moves here from the store's `COMPARE`
     map verbatim), then slice by `page`/`pageSize` (default page 1, pageSize 10,
     same clamping as the backend), returning `{ items, total: <filtered length
     before slicing> }`.
   - `createHttpReportHistorySource`: add `sort`/`page`/`pageSize` to the
     `URLSearchParams` alongside the existing filters (same "only send a value
     that's set" rule already used for filters), and return
     `{ items: interviews, total }` from the parsed response.
6. `web/src/stores/report-history.store.ts`:
   - Re-export `REPORT_SORTS`, `ReportHistorySort`, `DEFAULT_REPORT_SORT` from the
     service (so `ReportsHistoryView.vue`'s existing import path keeps working).
   - Remove `COMPARE` and the `sortedList` computed — `list` is now the current
     page, already ordered.
   - Add `export const PAGE_SIZE = 10`, `page = ref(1)`, `total = ref(0)`,
     `pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))`.
   - `fetchList` now calls `source.value.list({ ...filters.value, sort:
     sort.value, page: page.value, pageSize: PAGE_SIZE })` and assigns
     `list.value = result.items; total.value = result.total`.
   - `setSort` now also resets `page.value = 1` and calls `fetchList` (sorting is
     no longer a pure client-side reorder — it changes what the server returns for
     "page 1"), matching how filter changes already trigger a refetch.
   - Add `setPage(next: number)` that clamps to `[1, pageCount.value]`, assigns
     `page.value`, and calls `fetchList`.
   - Reset `page.value = 1` in `reset()`.
7. Add `web/src/cmps/Pagination.vue`: props `page`, `pageCount`; emits
   `update:page`. Prev/next buttons (disabled at the bounds) plus a "Page X of Y"
   label. Reuses existing `.btn`/`.btn-secondary` classes; add
   `web/src/styles/cmps/pagination.scss` (loaded from `cmps/index.scss` per
   `.claude/rules/ui-and-styling.md`) only if the buttons need bespoke layout.
8. `web/src/views/ReportsHistoryView.vue`: render `store.list` (now already the
   current page) instead of the removed `store.sortedList`; mount `<Pagination>`
   below the list (only when `store.pageCount > 1`), wired to `store.page` /
   `store.setPage`.

## Validation
- **Backend**:
  - `api/src/repositories/interview.repository.spec.ts`: extend for `page`/
    `pageSize`/`sort` — correct `LIMIT`/`OFFSET`, correct `ORDER BY` per sort value,
    correct `total` independent of `LIMIT`/`OFFSET`, and defaults when omitted.
  - `api/src/repositories/interview-list-grade.adversarial.spec.ts`: update the
    SQL-shape assertions for the new `order by`/`limit`/`offset` clauses; confirm
    the inner join, `group by i.id`, and org-scoping conditions are unchanged.
  - `api/src/routes/interview-list.adversarial.spec.ts`: add cases for
    out-of-range `page`/`pageSize` (e.g. `pageSize=999` clamps or is rejected —
    pick one and assert it; `page=0` rejected by the schema), invalid `sort`
    values rejected by `.strict()`/`z.enum`, and confirm org isolation still holds
    with pagination applied.
  - `api/src/app.spec.ts`: extend `GET /api/interview` happy-path tests to assert
    `total` is present and `interviews.length <= pageSize`.
  - `api/src/services/interview.service.spec.ts`: passthrough test updated for the
    new argument/return shape.
  - `cd api && npm test` passes.
- **Frontend**:
  - `web/src/services/report-history.service.spec.ts` /
    `report-history.adversarial.spec.ts`: extend mock-source tests for sorting,
    slicing, and `total`; extend HTTP-source tests for the new query params and
    `{ items, total }` parsing.
  - `web/src/stores/report-history.store.spec.ts` and the two
    `report-history-*.adversarial.spec.ts` store specs: update for `list` now
    being one page, `total`/`pageCount`, `setPage` clamping, and `setSort`/filter
    changes resetting to page 1 and refetching.
  - New `web/src/cmps/Pagination.spec.ts`: label text, Prev/Next disabled at
    bounds, emits `update:page`.
  - `web/src/views/ReportsHistoryView.spec.ts` and
    `reports-history-flow.spec.ts`/`report-history-ui.adversarial.spec.ts`/
    `reports-sort-interaction.adversarial.spec.ts`: update for the pager
    appearing/disappearing correctly and a sort change re-fetching instead of
    reordering in place.
  - `cd web && npm test`, `npx vue-tsc --noEmit`, `npm run lint` all pass.
- **Manual (http mode)**: run `api/` locally with more than one page of seeded
  interviews for a test org, point `web/` at it (`VITE_INTERVIEW_SOURCE=http`),
  confirm paging, sorting, and filters all combine correctly end to end and org
  isolation still holds.
- **Manual (mock mode)**: seed more than 10 mock history entries, confirm paging
  controls appear, page correctly, and reset to page 1 on a filter/sort change.

## Risks
- Moving `ORDER BY` into SQL means the four `sort` values must produce identical
  row order to today's client-side `COMPARE` map (including its grade-tie
  newest-first tiebreak) or a page boundary could show a duplicate or skipped row
  across pages — mitigated by the repository spec asserting exact order per sort
  value, not just presence of the rows.
- `OFFSET`-based paging can skip or repeat a row if a new interview is recorded
  between two page fetches (a classic offset-pagination hazard) — acceptable here
  since interview history changes rarely and never while actively paging through
  it; noted rather than solved, since keyset pagination is explicitly out of scope
  above.
- Removing `sortedList`/`COMPARE` from the store is a breaking change for any test
  that still imports them — the existing store/view specs must be updated in the
  same commit, not left calling a removed export.

## Rollout Order
1. Backend: repository query change + its specs, then route/schema change + its
   specs, then service passthrough update. `cd api && npm test` green before
   moving on.
2. Frontend service layer: `ReportHistorySource` contract change (mock + http) +
   specs.
3. Frontend store: pagination/sort-refetch rework + specs.
4. `Pagination.vue` + its spec.
5. Wire into `ReportsHistoryView.vue` + view specs.
6. Full `web/` and `api/` test/lint/typecheck passes; manual check in both mock
   and http mode.

## Addendum (2026-09-06, post-QA)
Two UI requests added after the plan's original implementation and QA passes:
1. A "Records per page" `<select>` in the filters area (`10 per page` / `20 per page` /
   `50 per page`), alongside the existing sort selector. `report-history.store.ts` gained a
   reactive `pageSize` ref (was a fixed `PAGE_SIZE` constant), `PAGE_SIZE_OPTIONS`, and a
   `setPageSize` action that — like `setSort` — resets to page 1 and re-reads, since a
   different page size is a different first page, not the same rows regrouped. No backend or
   contract change: `pageSize` was already a full, validated `[1, 50]` parameter on
   `GET /api/interview` from the original implementation; only the frontend never exposed a
   control for it.
2. "Page number with navigation arrows" — already satisfied by the existing
   `PaginationControl.vue` ("Page X of Y" with Previous/Next chevron buttons), added in the
   original implementation. No change needed.
Implemented directly (not via a new agent round), tests extended in
`report-history.store.spec.ts` and `ReportsHistoryView.spec.ts`; full `web/` suite (806 tests),
`vue-tsc`, and `lint` re-run clean. See RESOLUTION above for the same bar applied to the
QA-found defect.

Follow-up same day: `PAGE_SIZE_OPTIONS` widened from `[10, 20, 50]` to `[2, 5, 10, 20, 50]` on
request, so a small page size is selectable too — no other code changed, since the API and the
mock source already accepted any `pageSize` in `[1, 50]`. `web/` suite re-run at 807 tests,
`vue-tsc` and `lint` clean.

A separate browser console error was reported while filtering, and confirmed NOT a defect in
this change: `Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')`
at `et.reportAllChanges`, from an anonymous `VM…` script. `reportAllChanges` does not appear
anywhere in this repo, in `web/package.json`, or anywhere in the full `web/node_modules` tree
(exhaustive recursive grep, zero matches) — it cannot originate from anything this app ships.
The `🍍 "report-history" store installed 🆕` log line that appeared alongside it is unrelated:
confirmed in `node_modules/pinia/dist/pinia.mjs` as Pinia's own standard dev-mode logging,
gated only on `NODE_ENV !== 'production'`. The user confirmed the error does not reproduce
with all browser extensions disabled — a browser extension (performance/Web-Vitals-monitoring
class, given the `requestIdleCallback`-scheduled stack and the anonymous `VM` script with no
real file path) reacting to the row count changing, not this app. No code change made.

## Rollback
Revert the branch's commits. No schema or migration change, and the response shape
change (`{ interviews }` → `{ interviews, total }`) is additive — an older
frontend build that never reverted would simply ignore the new `total` field, so
rollback needs no data cleanup or coordinated deploy ordering.
