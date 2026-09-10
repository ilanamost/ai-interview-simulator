Status: done
Owner: orchestrator
Last updated: 2026-09-08

# Project Summary Documentation

## Goal
Produce a set of hand-written-style reference documents under `.doc/` that let
someone with no prior exposure to this codebase explain the application —
purpose, UX, architecture, data, services, store, connections, auth/authz —
convincingly enough to a recruiter or interviewer. Split by stack (frontend /
backend), plus a standalone schema diagram, per the backlog request.

## Scope
- New files only, no application code changes:
  - `.doc/summary-frontend.md` — product purpose/UX for `web/`, then its
    architecture: views/router, components, Pinia store, service layer
    (`InterviewSource` mock/HTTP abstraction, speech, PDF, gamification,
    session persistence), config/env handling, styling system, and how it
    talks to `api/`.
  - `.doc/summary-backend.md` — `api/` purpose and architecture: Express app
    and routing, middleware (auth, error handling, validation), services
    (`interview.service`, `llm/` adapter), repository layer, error shape,
    and the auth/org security model (JWT pair, cookie flags, session
    revocation).
  - `.doc/schema-diagram.md` — a Mermaid ER diagram of `api/schema.sql`
    (`org`, `user`, `user_session`, `interview`, `question`, `answer`,
    `evaluation`) plus one paragraph per table explaining its role and FK
    relationships.
- Update `.plan/000-backlog.md`: check off this task once done.
- No changes to `web/**` or `api/**` source, no new dependencies, no CI changes.
- Not `stack:full` in the code sense — it reads both stacks but writes only
  to `.doc/`, so the frontend/backend agent split does not apply (see Open
  Questions in the orchestration decision already made: orchestrator writes
  these files directly).

## Assumptions
- `.doc/architecture.md`, `.doc/product-definition.md`, `.doc/glossary.md`,
  `.doc/deployment.md`, and `api/schema.sql` are the primary sources of
  truth; the new files synthesize and reorganize them for a narrative,
  recruiter-facing read rather than duplicating them verbatim.
- Mermaid renders natively in the tools this repo's docs are viewed with
  (GitHub renders ` ```mermaid ` fences); no diagram image asset is needed.
- "Everything explained thoroughly" means: what was built, why that
  architecture was chosen over the obvious alternative, and what tradeoff it
  bought — not just an inventory of files.

## Open Questions
- None outstanding — Linear-ticketing and agent-routing were already
  resolved with the user before this plan was written (skip Linear while its
  MCP token is invalid; write the docs directly as orchestrator rather than
  via the frontend/backend sub-agents, since neither's write allowlist
  covers `.doc/`).

## Steps
1. Re-read `.doc/architecture.md` change log end-to-end (already done for
   this plan) plus skim `web/src/stores/interview.store.ts`,
   `web/src/services/interview.service.ts`, `web/src/router/`, and
   `api/src/app.ts`, `api/src/middleware/`, `api/src/services/interview.service.ts`
   to confirm the architecture doc's descriptions still match current code
   before writing anything derived from them.
2. Write `.doc/summary-frontend.md`: product framing (who/why, 3 sentences)
   → UX walkthrough (setup → interview → report, plus history/settings/auth
   routes) → architecture (router, views, cmps, store, services layer with
   the `InterviewSource` contract as the centerpiece design choice) → styling
   system (SCSS structure, design tokens) → how `web/` talks to `api/`
   (env-driven source selection, HTTP error mapping).
3. Write `.doc/summary-backend.md`: architecture layering (routes →
   middleware → service → repository → LLM adapter) → the `InterviewSource`-
   mirroring contract in `api/src/types/` → auth/org model (dual JWT, cookie
   flags, session revocation, per-request org resolution) → error handling
   shape → LLM integration (structured JSON output, provider-failure
   mapping).
4. Write `.doc/schema-diagram.md`: a ` ```mermaid erDiagram ``` ` block
   covering all seven tables and their FKs (`user.org`, `user_session.user_id`/
   `org`, `interview.org`, `question.interview_id`/`org`/`parent_id`,
   `answer.question_id`/`interview_id`/`org`, `evaluation.question_id`/
   `answer_id`/`interview_id`/`org`), followed by a short per-table
   explanation and a note on the org-scoping convention.
5. Cross-link: `summary-frontend.md` and `summary-backend.md` link to
   `schema-diagram.md` where relevant (backend doc primarily); all three
   link back to `.doc/architecture.md` and `.doc/product-definition.md`
   rather than re-deriving facts that live there.
6. Check off this task in `.plan/000-backlog.md`.

## Validation
- All three files exist under `.doc/` and are non-empty.
- The Mermaid block in `schema-diagram.md` includes exactly the 7 tables in
  `api/schema.sql` and every FK column that appears there (`references`
  clauses) — spot-checked against schema.sql column-by-column.
- No file references a route, component, service, or table name that does
  not exist in the current codebase (spot-checked via grep, since these are
  prose docs with no test suite of their own).
- `.plan/000-backlog.md`'s summary-docs line is checked off.
- QA agent confirms: docs are internally consistent with each other, with
  `.doc/architecture.md`, and with `.doc/product-definition.md`'s stated
  scope (no contradictions on auth model, source abstraction, or schema).

## Risks
- Docs can drift from code the moment either changes again; mitigated by
  linking to `.doc/architecture.md` (which already has an Update Triggers
  policy) as the living source rather than re-stating every implementation
  detail that could rot.
- Overly long files reduce usefulness for the stated "explain a recruiter"
  goal; each file targets a narrative read, not an exhaustive file listing.

## Rollout Order
Single PR, no staged rollout: write all three files, validate, then check
off the backlog item in the same branch.

## Rollback
Delete the three new `.doc/` files and revert the backlog checkbox; no other
part of the app depends on their existence.
