# AI Interview Simulator — Frontend/Backend Integration

Status: active
Owner: Ilana
Last updated: 2026-07-26

> All steps (1-7) implemented on `feat/interview-integration`, branched from local `feat/interview-web`
> (which already contained the `feat/interview-api` merge — `master` only has Stage 1 merged at the time
> of writing).
> - Step 6 (live smoke test) was run against a real local Postgres (`interview` DB, bootstrapped from
>   `api/schema.sql`) and a real Anthropic key: `POST /api/interview` (questionCount 1) → a live
>   LLM-generated question → a submitted answer → a live LLM evaluation (grade 82, no follow-up needed)
>   → `GET /api/interview/:id/report`. The persisted `question`/`answer`/`evaluation` rows were queried
>   directly and matched the API responses exactly. This exercised the real `api/` stack end-to-end for
>   the first time (Stage 2 itself shipped fully DB/LLM-mocked). Kept intentionally small (1 question) to
>   limit real LLM spend, per Open Question 3's "small, targeted validation."
>   Not exercised in this pass: the browser/`web/` side with `VITE_INTERVIEW_SOURCE=http` (the frontend's
>   HTTP source is instead covered by the fetch-mocked tests in Step 5) — worth a follow-up manual click
>   through if end-to-end browser confidence is wanted.

## Goal
- Complete Stage 2 of [001-2026-07-18-ai-interview-simulator.md](001-2026-07-18-ai-interview-simulator.md): swap the frontend's `mockInterviewSource` for a real `httpInterviewSource` that talks to the `api/` backend, with no changes to the Pinia store or views.
- This is exactly step 16 / Rollout Order item 3 that 001 deferred to its own branch (`feat/interview-integration`).

## Scope
### In scope
- A new `InterviewSource` implementation in `web/` that calls the four `api/src/routes/interview.routes.ts` endpoints already built.
- Mapping the backend's `{ error: { code, message, details } }` shape ([.rule/error-handling-rules.md](.rule/error-handling-rules.md)) into the frontend's `InterviewError`.
- Env-based config on both sides so the frontend knows the API base URL and can still fall back to the mock.
- Tests for the new source (fetch mocked) per [.rule/testing-rules.md](.rule/testing-rules.md).
- Docs: `web/README.md` (new env vars, two-server dev flow) and [.doc/architecture.md](.doc/architecture.md) (data flow now crosses the network).
- One manual end-to-end smoke test through the real UI, against the real API — first time this stack runs against a live DB/LLM (001 Stage 2 shipped fully mocked).

### Out of scope
- Session resume/rehydration after a page reload (`GET /api/interview/:id` is not currently used by any UI flow; Stage 1 never persisted a session id in the URL either).
- Auth, deployment, hosting — unchanged from 001's Assumptions (local dev only).
- Retry/resubmit UX for partial failures (e.g., answer persisted server-side but the LLM evaluation call then fails). Documented as a known risk, not fixed here.
- Root-level dev orchestration tooling (e.g. `concurrently`) — two terminals is enough for now.

## Assumptions
- `api/` and `web/` keep running as two independently-started dev servers (`npm run dev` in each), matching their current `package.json` scripts — there is no root `package.json` today.
- `api/.env.example` already sets `CORS_ORIGIN=http://localhost:5173`, matching Vite's default port, so no CORS changes are needed for local dev as long as neither port is customized.
- The `InterviewSource` contract in [web/src/services/interview.service.ts](web/src/services/interview.service.ts) stays exactly as-is (`startInterview`, `getNextQuestion`, `evaluateAnswer`, `getReport`) — the HTTP source implements the same 4 methods, so the store ([web/src/stores/interview.store.ts](web/src/stores/interview.store.ts)) and every view are untouched.
- Response shapes already line up 1:1 between [web/src/types/interview.ts](web/src/types/interview.ts) and [api/src/types/interview.ts](api/src/types/interview.ts) — confirmed by reading both files, no type changes expected.
- Two response envelopes need unwrapping: `GET /:id/question` returns `{ question }` and `POST /:id/answer` returns `{ evaluation }`, while `POST /` and `GET /:id/report` return the bare object.

## Open Questions
> Please answer inline (edit after each `A:`). Recommended answer is pre-filled.

1. **How does the frontend choose mock vs. HTTP?**
   - Recommended: an explicit `VITE_INTERVIEW_SOURCE=mock|http` env var (default `mock`), read once where `interviewSource` is currently exported in `interview.service.ts`. Keeps today's dev/test behavior unchanged until someone opts in, and gives the Rollback path from 001 ("fall back to mock if the API is unavailable") a one-line flip instead of a code change.
   - A: _(unanswered — proceeding with recommended default)_
2. **Fetch timeout for LLM-backed calls (`getNextQuestion`, `evaluateAnswer`)?**
   - Recommended: 30s, no automatic retries (validation/domain failures shouldn't retry per [.rule/error-handling-rules.md](.rule/error-handling-rules.md); a hung LLM call should fail loud, not hang the UI forever).
   - A: _(unanswered — proceeding with recommended default)_
3. **Run the live end-to-end smoke test (real Postgres + real `ANTHROPIC_API_KEY`) as part of this workstream?**
   - Recommended: yes if a local Postgres and a real API key are available; otherwise defer it, same caveat 001 already logged for Stage 2 (all 48 backend tests there were LLM/DB-mocked, nothing live was ever exercised).
   - A: Yes — run the live smoke test as part of this integration workstream, but only as a small, targeted validation. _(Note: no `api/.env`, no local Postgres/psql detected in this environment — will defer the live run and flag it as a manual follow-up rather than fake it.)_
4. **Add `getInterview` (`GET /:id`) to the `InterviewSource` contract now, for future resume-on-reload?**
   - Recommended: no, defer — no UI flow reads it today and adding an unused method just to have it risks interface drift the original plan explicitly wanted to avoid.
   - A: _(unanswered — proceeding with recommended default)_
5. **Root-level `npm run dev` to launch both servers together?**
   - Recommended: skip; document the two-terminal flow in `web/README.md` instead. Keep this branch scoped to the source swap.
   - A: _(unanswered — proceeding with recommended default)_

## Steps

1. **Frontend env & config**
   - Add `web/.env.example` with `VITE_API_BASE_URL=http://localhost:3001` and `VITE_INTERVIEW_SOURCE=mock`.
   - Add a small `web/src/config/env.ts` reading `import.meta.env.VITE_API_BASE_URL` / `VITE_INTERVIEW_SOURCE` with safe defaults, so the rest of the code never touches `import.meta.env` directly.

2. **Implement the HTTP source** — new file `web/src/services/interview-http.service.ts`, exporting `createHttpInterviewSource(baseUrl)` implementing `InterviewSource`:
   - `startInterview(config)` → `POST {baseUrl}/api/interview`, body = `config`, response is the bare `InterviewSession`.
   - `getNextQuestion(session)` → `GET {baseUrl}/api/interview/{session.id}/question`, unwrap `{ question }` → `Question | null`.
   - `evaluateAnswer(session, question, answer)` → `POST {baseUrl}/api/interview/{session.id}/answer` with `{ questionId: question.id, text: answer.text }`, unwrap `{ evaluation }` → `Evaluation`.
   - `getReport(session)` → `GET {baseUrl}/api/interview/{session.id}/report`, response is the bare `Report`.
   - Shared fetch helper: on a non-2xx response, parse the body's `error.code` / `error.message` into `new InterviewError(code, message)`; on a thrown/aborted fetch (network failure or the timeout from Open Question 2), throw `new InterviewError('NETWORK_ERROR', 'Could not reach the interview service. Check your connection and try again.')`.

3. **Wire source selection** — at the bottom of `web/src/services/interview.service.ts`, replace the hardcoded `export const interviewSource: InterviewSource = createMockInterviewSource()` with a small factory that reads `VITE_INTERVIEW_SOURCE` (via `web/src/config/env.ts`) and picks `createMockInterviewSource()` or `createHttpInterviewSource(baseUrl)`. No changes to the store or views — `interviewSource` keeps the same export shape they already import.

4. **Backend config check** — no code changes expected; confirm `api/.env.example`'s `CORS_ORIGIN` and `PORT` still match whatever `web/.env.example` points at, and note `ORG_ID` stays server-side only (no client changes needed for org scoping).

5. **Tests**
   - `web/src/services/interview-http.service.spec.ts`: mock global `fetch`, cover each of the 4 methods' happy path and envelope-unwrapping, a 4xx/5xx error mapped to `InterviewError` with the backend's `code`, and a network/timeout failure mapped to `InterviewError('NETWORK_ERROR', ...)`.
   - Extend/add a spec for the source-selection factory from Step 3, covering both `mock` and `http` branches.

6. **Manual live smoke test** (see Open Question 3): bootstrap `api/schema.sql` against a local Postgres, run `api` with a real `ANTHROPIC_API_KEY`, run `web` with `VITE_INTERVIEW_SOURCE=http`, complete one full interview in the browser (setup → question loop → report), and confirm the persisted rows in Postgres match what the report showed.

7. **Docs** — update [.doc/architecture.md](.doc/architecture.md) with the frontend → backend request flow, and `web/README.md` with the new env vars and the two-terminal dev instructions.

## Validation
- All new unit tests (Step 5) pass; existing frontend and backend suites still pass unmodified (the store/view contract didn't change).
- `npm run lint` passes in `web/` with the no-semicolon rule.
- With `VITE_INTERVIEW_SOURCE=http`, a full interview completed in the browser produces the same UI states (asking → evaluating → reviewing → complete) as the mock does today, sourced from real API responses.
- The manual smoke test's persisted DB rows (question, answer, evaluation, grade) match what the UI displayed, closing 001's Stage 2 validation gap ("frontend using `httpInterviewSource` completes the same flow").
- Flipping `VITE_INTERVIEW_SOURCE` back to `mock` with no other changes restores today's offline demo behavior — proves the Rollback path.

## Risks
- **Latency mismatch**: the mock's fixed ~320ms delay is nothing like real LLM latency (can run several seconds). The chosen timeout (Open Question 2) must be generous enough to avoid false-positive `NETWORK_ERROR`s on slow-but-legitimate calls.
- **CORS misconfiguration**: mitigated today because `api/.env.example`'s default `CORS_ORIGIN` already matches Vite's default port, but this breaks silently if either port is customized without updating the other side.
- **Partial-failure drift**: `submitAnswer` persists the answer row server-side before calling the LLM; if the LLM call then fails, the server has an orphaned answer with no evaluation and the client never advances past `asking`. No retry/resubmit path exists yet — flagged as an out-of-scope risk, worth a follow-up plan if it shows up in the manual smoke test.
- **Error-shape drift**: mitigated by testing the HTTP source against the documented shape in [.rule/error-handling-rules.md](.rule/error-handling-rules.md) rather than against backend internals.

## Rollout Order
1. Branch `feat/interview-integration`, cut from `master` once both `feat/interview-web` (Stage 1) and `feat/interview-api` (Stage 2, current branch) are merged — per [.rule/versioning-rules.md](.rule/versioning-rules.md), one workstream per branch. If either parent branch isn't merged yet when this starts, confirm with the user whether to branch from `feat/interview-api` instead and rebase later.
2. Implement Steps 1-5, then run the manual smoke test (Step 6) before requesting review.
3. Update docs (Step 7) in the same branch.

## Rollback
- Revert the `feat/interview-integration` branch independently; it touches only `web/src/services/` (new file + one export swap), `web/src/config/`, `web/.env.example`, and docs — no store/view/API changes to unwind.
- Even without a revert, flipping `VITE_INTERVIEW_SOURCE=mock` restores the fully offline mock flow immediately, per 001's Rollback section.
