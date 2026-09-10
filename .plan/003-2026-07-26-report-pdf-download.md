# Report PDF Download

Status: active
Owner: Ilana
Last updated: 2026-07-26

## Goal
- Let a user download their finished interview report ([web/src/views/ReportView.vue](web/src/views/ReportView.vue)) as a `.pdf` file, from a button on the report screen, in both `mock` and `http` `VITE_INTERVIEW_SOURCE` modes.

## Scope
### In scope
- A "Download PDF" action on `ReportView.vue`, next to the existing "Run another interview" button.
- Client-side PDF generation from the `Report` object already held in `store.report` ([web/src/stores/interview.store.ts](web/src/stores/interview.store.ts)) — overall grade, headline, recurring strengths/improvements, and the per-question breakdown (question, answer, evaluation summary + improvements), matching what's on screen today.
- A new `web/src/services/report-pdf.service.ts` doing the layout/generation, so `ReportView.vue` stays a thin trigger.
- A unit test for the new service and a component test asserting the button calls it.

### Out of scope
- Any backend/API changes. The full `Report` is already in the Pinia store by the time `ReportView` renders (both sources return it via the existing `getReport` contract), so no new endpoint is needed — this stays a pure frontend feature.
- Emailing, cloud storage, or server-persisted copies of the PDF.
- Custom branding/theming of the PDF beyond a clean, readable layout matching the on-screen structure.
- Localization/i18n of PDF content — matches the app's current English-only UI.

## Assumptions
- `store.report` and `store.session` are non-null whenever the download button is reachable — `ReportView.vue`'s existing `v-if="store.report && store.session"` guard already enforces this ([web/src/views/ReportView.vue:22](web/src/views/ReportView.vue#L22)).
- No change to the `InterviewSource` contract ([web/src/services/interview.service.ts](web/src/services/interview.service.ts)) — PDF generation reads only the already-fetched `Report`/`InterviewSession` shapes from [web/src/types/interview.ts](web/src/types/interview.ts).
- Report content is plain text (no images/rich formatting in `Report`/`Evaluation`), so a text-layout PDF library is sufficient — no need to rasterize the live DOM.

## Open Questions
> Please answer inline (edit after each `A:`). Recommended answer is pre-filled.

1. **Client-side generation vs. a backend endpoint (e.g. `GET /api/interview/:id/report/pdf`)?**
   - Recommended: client-side. It works identically in `mock` and `http` modes (mock has no backend at all — [.doc/architecture.md](.doc/architecture.md) line 12), needs no new API route/tests/error-shape work, and the report data is already fully in hand client-side.
   - A: _(unanswered — proceeding with recommended default)_
2. **Which PDF library?**
   - Recommended: [`jspdf`](https://github.com/parallax/jsPDF) only (no `html2canvas`). It generates real text (selectable, small file size, crisp at any zoom) laid out programmatically from the `Report` object, rather than rastering the live DOM (which would also capture buttons/interactive chrome and be fragile to CSS changes). Adds exactly one new `web/` dependency.
   - A: _(unanswered — proceeding with recommended default)_
3. **Filename convention?**
   - Recommended: `interview-report-{jobTitle}-{level}-{YYYY-MM-DD}.pdf`, e.g. `interview-report-frontend-senior-2026-07-26.pdf`, built from `store.session.config` and the current date.
   - A: _(unanswered — proceeding with recommended default)_
4. **PDF content depth — full per-question breakdown or summary-only?**
   - Recommended: full breakdown (header + strengths/improvements + every question/answer/evaluation), i.e. a straight text-layout port of everything already rendered in `ReportView.vue`. A summary-only PDF would be less useful for the report's actual purpose (a takeaway artifact) and is more code (two layouts) for no clear benefit.
   - A: _(unanswered — proceeding with recommended default)_

## Steps

1. **Add dependency** — `npm install jspdf` in `web/`.

2. **New service** — `web/src/services/report-pdf.service.ts`, exporting `buildReportPdf(session: InterviewSession, report: Report): jsPDF` (or a `downloadReportPdf(session, report): void` wrapper that also calls `.save(filename)`):
   - Layout mirrors `ReportView.vue`'s structure top to bottom: title/config line, overall grade, headline, recurring strengths, recurring improvements, then one block per `report.entries[]` (question text, answer text, grade, evaluation summary, improvements list).
   - Handle pagination: use `jsPDF`'s `splitTextToSize` for wrapping and check page height before each block, calling `doc.addPage()` when a block would overflow — reports can have many questions.
   - Filename built per Open Question 3, done in this module so it's covered by the same unit test as the layout.

3. **Wire up the button** — in `ReportView.vue`, add a "Download PDF" button (lucide `Download` icon, per [.rule/ui-rules.md](.rule/ui-rules.md)) next to "Run another interview", calling `downloadReportPdf(store.session, store.report)` from the new service.

4. **Tests**
   - `web/src/services/report-pdf.service.spec.ts`: construct a small `Report`/`InterviewSession` fixture, call `buildReportPdf`, assert on the returned `jsPDF` instance (e.g. `getNumberOfPages()`, extracted text via `doc.output()` or a text-capture spy) covering — all entries present, multi-page output when entries overflow one page, correct filename string.
   - Extend `ReportView.spec.ts` (or add one if it doesn't exist — confirm during implementation): clicking "Download PDF" calls the service once with `store.session`/`store.report`, per [.rule/testing-rules.md](.rule/testing-rules.md)'s happy-path coverage expectation.

5. **Docs** — add a short line to [.doc/architecture.md](.doc/architecture.md)'s `Primary Components (Stage 1)` list for `report-pdf.service.ts`, and to its Change Log.

## Validation
- New unit tests (Step 4) pass; existing `web/` suite still passes unmodified (no store/type/contract changes).
- `npm run lint` and `vue-tsc --noEmit` (via `npm run build`) pass in `web/`.
- Manual check: complete one interview in the browser (either source mode), click "Download PDF", open the resulting file and confirm it contains the same grade/headline/strengths/improvements/per-question content shown on screen, correctly paginated for a multi-question report.

## Risks
- **Pagination bugs with long answers**: a very long answer/summary could still overflow a page if height-checking is off by one block — mitigated by testing with a fixture that has enough entries to force at least 2 pages.
- **Library bundle size**: `jspdf` is a few hundred KB; acceptable for a local-dev app with no current bundle-size budget, but worth a one-line note in the PR if `web/`'s build output size is ever gated.
- **Content drift from `ReportView.vue`**: the PDF layout is a separate hand-written mirror of the on-screen report, so future changes to one won't automatically propagate to the other — acceptable for now given the small surface, but worth flagging in the PR description.

## Rollout Order
1. Implemented directly on `feat/interview-integration` (current branch), per explicit user instruction to not cut a new branch for this workstream, overriding [.rule/versioning-rules.md](.rule/versioning-rules.md)'s default "one plan/workstream per branch."
2. Implement Steps 1-4, then Step 5 docs, in that branch.
3. Manual validation (see above) before requesting review.

## Rollback
- Self-contained: one new dependency, one new service file, one new/extended test file, and a small addition to `ReportView.vue` (an extra button + import). No store, type, or API contract changes to unwind. Since this shares a branch with the interview-integration work, a revert would need to target these specific files/commits rather than the whole branch.
