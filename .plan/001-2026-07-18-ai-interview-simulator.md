# AI Interview Simulator

Status: Stage 1 complete (frontend), Stage 2 complete (backend)
Owner: Ilana
Last updated: 2026-07-24

## Goal
- Build an AI-driven interview simulator where an AI interviewer asks role-specific questions, asks follow-ups, analyzes each answer, and produces feedback and a grade.
- The user configures the session by choosing a **job title** (frontend, backend, etc.), an **experience level**, and an **interview type**.
- Deliver in two stages: **Stage 1 = frontend only** (Vue.js, no backend), **Stage 2 = add the Node.js backend** that persists the question, answer, evaluation, and grade.

## Core Flow (from the provided sketch)
- `Question` -> `User Answer` -> `AI evaluates` -> (optional `Follow-up`) -> `Next Question` -> ... -> `Final Report`.

## Scope
### In scope
- Stage 1 (frontend, Vue 3):
  - Setup screen: pick job title, experience level, interview type; optional Job Description text.
  - Interview screen: shows current question, captures the answer, shows the AI evaluation + grade per answer, advances to the next question or a follow-up, progress indicator.
  - Report screen: aggregate feedback, per-question grades, and an overall grade.
  - A `service` layer that abstracts "where answers/questions come from" so Stage 1 uses a **mock adapter** and Stage 2 swaps in the real backend with no UI changes.
  - Pinia store holding the live interview session (config, questions, answers, evaluations, grades).
  - CSS structured per [.rule/style-rules.md](.rule/style-rules.md) (`main.css` -> `setup`/`basics`/`cmps`, CSS variables).
- Stage 2 (backend, Node.js):
  - REST API that generates questions/follow-ups, evaluates answers (LLM), and returns feedback + grade.
  - Persistence of question, answer, evaluation, and grade.
  - Error shape, input validation, and secret handling per repo rules.

### Out of scope (for now)
- User accounts / login and full auth flows (schema will still carry `org` from day one per [.rule/database-rules.md](.rule/database-rules.md); see Open Questions).
- Payments, resume parsing, voice/audio answers, live proctoring.
- Multi-language interviews.

## Assumptions
- Single developer, local development first; no production deployment in these two stages.
- Tooling: **Vite + Vue 3** with **Vue Router** and **Pinia** for state management (fills the `state mgmt` placeholder in [.rule/coding-rules.md](.rule/coding-rules.md)).
- Code style follows [.rule/coding-rules.md](.rule/coding-rules.md): **no trailing semicolons** (leading `;` only when needed for syntax safety).
- Naming follows [.rule/naming-rules.md](.rule/naming-rules.md): singular entities, e.g. `interview.service`, route `/api/interview`.
- Stage 1 does **not** call any LLM directly from the browser (avoids exposing an API key per [.rule/security-rules.md](.rule/security-rules.md)); the "AI" in Stage 1 is a deterministic mock behind the service layer.
- Stage 2 LLM calls run server-side only, with the key loaded from an environment variable.
- New domain terms (Interview, Question, Answer, Evaluation, Grade, FollowUp, Report, JobTitle, ExperienceLevel, InterviewType) will be added to [.doc/glossary.md](.doc/glossary.md) before broad use.

## Open Questions
> Please answer inline (edit after each `A:`). Recommended answer is pre-filled.

1. **JavaScript or TypeScript for both apps?**
   - Recommended: **TypeScript** (better safety for the shared question/answer/evaluation shapes).
   - A: _TypeScript_
2. **Job Description handling** — the request mentions both "by Job Description" and "choose a Job title".
   - Recommended: user always picks **job title + level + type**, and may **optionally paste a Job Description** to tailor questions. JD optional.
   - A: _both, JD optional_
3. **Stage 1 AI source** — mock only, or wire a real LLM early?
   - Recommended: **deterministic mock adapter** in Stage 1 (curated question bank + rule-based scoring), real LLM arrives in Stage 2 behind the same interface.
   - A: _mock adapter_
4. **UI libraries** — [.rule/ui-rules.md](.rule/ui-rules.md) names `sonner` (toasts) and `lucide-react` (icons), which are React packages. This is a Vue project.
   - Recommended: use the Vue equivalents **`vue-sonner`** and **`lucide-vue-next`**, and update `ui-rules.md` to note the Vue variants.
   - A: _use Vue equivalents + update ui-rules_
5. **Backend framework (Stage 2)** — Express or Fastify?
   - Recommended: **Express** (widely known, simplest to onboard).
   - A: _Express_
6. **Database (Stage 2)** — [.rule/database-rules.md](.rule/database-rules.md) implies Postgres (`schema.sql`, `org` table, `jsonb`).
   - Recommended: **PostgreSQL** with a `schema.sql` bootstrap; keep `org` for future multi-tenant/auth.
   - A: _PostgreSQL_
7. **LLM model (Stage 2)** — provider/model for interviewer + evaluator.
   - Recommended: **Anthropic Claude**, `claude-sonnet-5` for question generation and answer evaluation, optionally `claude-opus-4-8` for the final report. (Will confirm exact params against the `claude-api` skill during Stage 2.)
   - A: _Claude, sonnet-5 default_
8. **Auth in these stages?**
   - Recommended: **no auth yet**; run single-user locally, but design the schema with `org` so auth can be added without migration pain.
   - A: _no auth yet_
9. **Interview length / adaptivity** — fixed number of questions or adaptive?
   - Recommended: **configurable count (default 5)**, with at most one AI follow-up per question in Stage 2; Stage 1 mock uses a fixed set.
   - A: _default 5, 1 follow-up_

## Steps

### Stage 1 — Frontend (Vue 3, no backend) — DONE
> All ten steps implemented in `web/` on branch `feat/interview-web`.
> Deviations from the plan as written:
> - Required a Node upgrade first (the machine had v14.15.1, which no supported Vite release runs on).
> - Vitest was moved from v2 to v3 so it shares the project's Vite 6 instead of nesting its own Vite 5.
> - Step 9 was extended beyond the planned store/evaluator/component tests with `interview-flow.spec.ts`,
>   a full setup → answer → report pass over the real router, store, and mock (44 tests total).
> - `.rule/coding-rules.md` had empty `services` and `state mgmnt` sections; both are now filled in
>   to describe the patterns this stage established.

1. Scaffold `web/` with Vite + Vue 3 + Vue Router + Pinia; add ESLint/Prettier configured for **no trailing semicolons**.
2. Set up CSS per [.rule/style-rules.md](.rule/style-rules.md): `web/src/styles/main.css` importing `setup`, `basics`, `cmps`; define color/spacing tokens as CSS variables.
3. Define shared types/models: `Interview`, `Question`, `Answer`, `Evaluation`, `Grade`, `Report`, plus enums `JobTitle`, `ExperienceLevel`, `InterviewType`.
4. Build the service abstraction `interview.service` with an `InterviewSource` interface and a `mockInterviewSource`:
   - `startInterview(config)`, `getNextQuestion(session)`, `evaluateAnswer(question, answer)`, `getReport(session)`.
   - Mock uses a curated question bank keyed by job title/level/type and rule-based scoring so the flow is fully demoable offline.
5. Create the Pinia `interview` store: holds config, question list, current index, answers, evaluations, grades, and derived overall grade; drives the Question -> Answer -> Evaluate -> Next loop.
6. Build views/components:
   - `SetupView` (job title, experience level, interview type, optional Job Description).
   - `InterviewView` with `QuestionCard`, `AnswerInput`, `EvaluationCard`, `GradeBadge`, `ProgressIndicator`.
   - `ReportView` with per-question breakdown + overall grade + feedback.
7. Wire routing (`/`, `/interview`, `/report`) and guards (can't enter interview without a valid config).
8. Add toasts (`vue-sonner`) and icons (`lucide-vue-next`); user-safe error/empty states per [.rule/error-handling-rules.md](.rule/error-handling-rules.md).
9. Add unit tests (Vitest) for the store transitions and the mock evaluator; component test for the answer-submit flow ([.rule/testing-rules.md](.rule/testing-rules.md)).
10. Update [.doc/glossary.md](.doc/glossary.md) and [.doc/architecture.md](.doc/architecture.md) with the new terms and the frontend component/data flow.

### Stage 2 — Backend (Node.js) + integration
> Steps 11-15, 17-18 implemented in `api/` on branch `feat/interview-api`, branched from `feat/interview-web`
> (Stage 1 was not yet merged to `master` when this started).
> Deviations from the plan as written:
> - Step 16 (frontend swap to `httpInterviewSource`) was **not** done here — confirmed with the user up front to
>   keep this branch backend-only per the Rollout Order below; it remains its own future workstream on
>   `feat/interview-integration`.
> - Report aggregation (grade averaging, headline, top recurring strengths/improvements) is computed
>   deterministically server-side from persisted evaluations, the same algorithm as the Stage 1 mock — not an
>   extra LLM call — so it stays fast and fully covered by non-LLM tests. Per-answer evaluation still goes
>   through the LLM per Open Question 7.
> - No live DB or live Anthropic call was exercised in this session (confirmed with the user up front): the
>   repository is written against real SQL and the LLM adapter against the real Anthropic SDK/API shape, but all
>   48 tests mock the `Queryable` DB client and the `@anthropic-ai/sdk` module. `schema.sql` bootstrap and a live
>   LLM smoke test are left for manual verification against a real `DATABASE_URL` / `ANTHROPIC_API_KEY`.
> - `zod` is v4 (not v3) — required by the Anthropic SDK's `zodOutputFormat` helper used for structured LLM output.

11. Scaffold `api/` (Node + Express + TypeScript); env-based config (`.env` local only, git-ignored) per [.rule/security-rules.md](.rule/security-rules.md).
12. Create `schema.sql` per [.rule/database-rules.md](.rule/database-rules.md): keep `org`; add `interview`, `question`, `answer`, `evaluation` (grade stored on evaluation or answer). Idempotent seed for a default `org`.
13. Implement server-side LLM adapter (Anthropic SDK) behind the same `InterviewSource` contract used by the mock: generate questions/follow-ups, evaluate answers (structured feedback + numeric grade), build the final report. Key from env only.
14. Implement REST endpoints with the stable error shape from [.rule/error-handling-rules.md](.rule/error-handling-rules.md) and strict input validation:
    - `POST /api/interview` — create session (job title, level, type, optional JD).
    - `POST /api/interview/:id/answer` — submit answer, persist it, return evaluation + grade, persist evaluation.
    - `GET  /api/interview/:id/question` — next question or follow-up.
    - `GET  /api/interview/:id/report` — final report.
    - `GET  /api/interview/:id` — retrieve a saved interview.
15. Persist question, answer, evaluation, and grade on each step; scope every query by `org`.
16. **Deferred to `feat/interview-integration`.** Swap the frontend `mockInterviewSource` for an `httpInterviewSource` (real API calls) via config/env; no UI/store changes required.
17. Backend tests: request validation, error responses, persistence paths, and `org` scoping ([.rule/testing-rules.md](.rule/testing-rules.md), [.rule/security-rules.md](.rule/security-rules.md)); mock the LLM in tests.
18. Update [.doc/architecture.md](.doc/architecture.md) (routes, data flow, external LLM dependency) and [.rule/database-rules.md](.rule/database-rules.md) if schema evolves.

## Validation
- Stage 1: from a clean checkout, `npm install && npm run dev` runs the full interview loop end-to-end against the mock and produces a final report; unit/component tests pass; lint passes with the no-semicolon rule.
- Stage 2: `schema.sql` bootstraps a local DB; API endpoints return the documented shapes; an interview persisted through the API can be re-fetched with matching question/answer/evaluation/grade; frontend using `httpInterviewSource` completes the same flow; backend tests (validation, errors, `org` scoping, persistence) pass.
- LLM calls verified to run only server-side with no key present in any client bundle.

## Risks
- **UI-rules mismatch** (React libs named for a Vue project) — resolved by Open Question 4; risk of divergence if `ui-rules.md` isn't updated.
- **Non-determinism of LLM grading** in Stage 2 — mitigate with a constrained/structured output schema and fixed grading rubric; keep tests LLM-mocked.
- **Interface drift** between mock and real sources — mitigate by locking the `InterviewSource` contract in Stage 1 and reusing it verbatim in Stage 2.
- **Secret exposure** — mitigate by keeping all LLM calls server-side and `.env` out of version control.
- **Scope creep** (auth, resumes, audio) — explicitly deferred in Scope.

## Rollout Order
1. Stage 1 frontend on branch `feat/interview-web`, merged after review.
2. Stage 2 backend + persistence on branch `feat/interview-api`.
3. Frontend integration (mock -> HTTP source) on `feat/interview-integration`.
- Per [.rule/versioning-rules.md](.rule/versioning-rules.md): one workstream per branch, no commits/merges without explicit approval.

## Rollback
- Stage 1 is self-contained; revert the frontend branch to remove it.
- Stage 2: the frontend can fall back to `mockInterviewSource` via config if the API is unavailable; revert the backend/integration branches independently. No destructive DB migrations in these stages (additive `schema.sql`).
