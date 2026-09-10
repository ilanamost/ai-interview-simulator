Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-14

# Multi-Environment Support and GitHub Pages Deployment

## Goal
Support `staging`/`production` environments alongside local development, and
deploy the frontend to GitHub Pages, with clear instructions for filling in
each environment's `.env` files. Backlog source: `.plan/000-backlog.md`:
*"support different environments and not only localhost, which is
[development]. I want .env.staging and .env.production to be supported as
well. I[']ll deploy to gi[t]hub pages and leave instruction[s] on how to fill
the other .env files for the application to work there too and n[o]t only on
localhost."*

Confirmed with the human before planning (this conflicted with documented
scope — see Assumptions) and clarified that GitHub Pages, being static-only,
means the deployed frontend talks to a separately self-hosted `api/`, not a
Pages-hosted one.

## Scope
- `stack:full` in the sense that both `web/` and `api/` gain new `.env.*`
  templates, but **not** stack:full in the "new feature" sense — no
  application code changes to either the frontend UI or the backend's
  request-handling logic. This is deployment/environment tooling.
- In scope:
  - `web/`: `.env.staging`/`.env.production` example files, a GitHub-Pages-
    aware `base` path, a fix for client-side routing on a static host (GitHub
    Pages has no server to rewrite deep links to `index.html`), a
    `build:staging` script (`build` already covers production — see
    Assumptions).
  - `api/`: `.env.example` (doesn't exist yet at all today) plus
    `.env.staging.example`/`.env.production.example`, documenting every
    variable `api/src/config/env.ts` already reads. No code change.
  - Repo root: a GitHub Actions workflow that builds `web/` and deploys it to
    GitHub Pages; a security-hook fix (see Assumptions — a real gap this task
    surfaced); `.doc/deployment.md`; updates to `.doc/product-definition.md`
    and `.doc/architecture.md` to reflect the new scope.
- Out of scope: actually hosting `api/` anywhere (no cloud account/credentials
  to provision one; `.doc/deployment.md` documents *how*, generically, not
  *where*); enabling GitHub Pages in the repo's settings or merging/pushing
  the workflow so it actually runs (see Rollout Order — these are the human's
  actions, same as every merge/push this session); a staging deployment
  target (the backlog names GitHub Pages for the deployed environment; it
  never says where staging is hosted, so this plan makes the *tooling*
  support a staging build without inventing a staging host the human didn't
  ask for — see Open Questions).

## Assumptions
- **Why this conflicted with documented scope, and how it's resolved.**
  `.doc/product-definition.md`'s Operational Constraints said "No production
  deployment in these two stages," and `.doc/architecture.md`'s Context said
  "Runs locally in development; no deployment target in these stages." Both
  are updated by this plan (see Steps) — the same approach taken for the
  authentication task, which also arrived without updating scope docs first.
- **GitHub Pages cannot run `api/`.** Pages serves static files only — no
  Node process, no database connection. Confirmed with the human: the
  deployed frontend runs `VITE_INTERVIEW_SOURCE=http` pointed at a
  self-hosted `api/` via `VITE_API_BASE_URL`, not `mock` mode. This plan
  documents generic self-hosting guidance (any Node 20+ host; the env vars to
  set; point its `CORS_ORIGIN` at the Pages URL) rather than picking and
  provisioning a specific host, which needs real infrastructure decisions and
  credentials outside this plan's reach.
- **Vite already natively supports `.env.staging`/`.env.production` — this
  isn't new plumbing, just missing example files and one script.** Vite loads
  `.env.[mode]` automatically based on the `--mode` flag; `vite build`'s
  default mode is already `production`, so `.env.production` already works
  with the existing `npm run build` — no script change needed for it. Only
  `.env.staging` needs a new script (`build:staging`, passing `--mode
  staging`) since nothing currently invokes that mode.
- **A real security-hook gap, surfaced by this task, gets fixed as part of
  it.** `.claude/hooks/block-secret-file-access.js`'s
  `SECRET_FILE_PATTERN` only recognizes `.env`, `.env.local`,
  `.env.development`, and `.env.production` as secret-bearing — `.env.staging`
  matches none of those alternatives and is **not currently blocked** from
  being read/grepped/cat'd by any tool, including a spawned sub-agent. That
  gap is harmless today because no `.env.staging` file exists anywhere in the
  repo; it stops being harmless the moment this plan makes `.env.staging` a
  real, populated file real developers will create locally. The pattern is
  broadened to block any `.env.<anything>` except `.env.example` (and the new
  `.env.<mode>.example` templates this plan adds), rather than special-casing
  `staging` alongside the other three — so the next mode name nobody
  anticipated doesn't reopen the same gap. This is a guardrail fix, not
  application code, and is called out explicitly for review since
  `AGENTS.md` says hooks are the single source of truth for this and
  shouldn't drift silently.
- **GitHub Pages + client-side routing needs a deliberate choice.** This
  app uses `createWebHistory` (clean URLs, e.g. `/practice`) — GitHub Pages
  has no server-side rewrite, so a hard reload or direct link to anything but
  the root 404s. The standard, well-documented fix for a Vite/Vue SPA on
  Pages is a `404.html` that's a copy of `index.html` (Pages serves it for
  any unmatched path, and the app's own router then takes over client-side)
  — chosen over switching to `createWebHistory`'s hash-based sibling because
  hash URLs (`/#/practice`) would be a visible, permanent regression for
  every existing bookmark/link/test that assumes clean paths, whereas the
  404.html trick is invisible to the user and reversible.
- **Repo name fixes the Pages `base` path.** `git remote get-url origin` →
  `ilanamost/ai-dev`, so a GitHub Pages project site serves from
  `https://ilanamost.github.io/ai-dev/` — `vite.config.ts` needs `base:
  '/ai-dev/'` when building for Pages, but **not** for local dev or a
  same-origin production deployment elsewhere (a custom domain, for
  instance). This is set per the `production` mode specifically (via Vite's
  mode-aware config function), not globally, so `npm run dev` and a non-Pages
  production deploy aren't forced onto a path prefix they don't need.
- **Deployment docs live at `.doc/deployment.md`**, per `AGENTS.md`'s
  existing layout (`.doc/` — hand-written product and architecture docs;
  never create a `docs/` directory).

## Open Questions
- **Where does `staging` actually deploy?** The backlog names GitHub Pages
  for "deploy," but doesn't say where staging lives — GitHub Pages can only
  serve one site per repo by default (typically the production build).
  Recommended default: this plan makes `npm run build:staging` produce a
  working build (correct env vars, no code assuming production), but does
  **not** wire an automated staging deployment target — that's a
  follow-up once a real staging host is chosen. Revise this plan (or file a
  new backlog item) if a specific staging target is wanted now.

## Steps

### Repo root (orchestrator)
1. `.claude/hooks/block-secret-file-access.js`: broaden
   `SECRET_FILE_PATTERN`/`SECRET_IN_COMMAND_PATTERN` from enumerating
   `\.local|\.development|\.production` to matching any `.env.<suffix>`
   except `.example`-suffixed files (covering `.env.staging`,
   `.env.staging.example` stays allowed, etc.). Add/update this hook's own
   test coverage if any exists, and manually verify with a throwaway `cat
   .env.staging` attempt that it's now blocked.
2. `.github/workflows/deploy-pages.yml`: on push to `master` (paths filtered
   to `web/**` and the workflow file itself, so an `api/`-only or docs-only
   commit doesn't trigger a rebuild) and `workflow_dispatch`: checkout, setup
   Node, `cd web && npm ci && npm run build`, upload the `web/dist` artifact,
   deploy via `actions/deploy-pages`. Standard, minimal GitHub Pages Actions
   workflow — no custom deploy scripting needed.
3. `.doc/deployment.md` (new): an environment matrix (`development` /
   `staging` / `production` × which `.env.*` file, which `VITE_*`/`api/`
   vars matter, what's different between them), how `vite build --mode
   <mode>` selects the file, the GitHub Pages `base`-path and `404.html`
   mechanism explained, and generic self-hosting guidance for `api/`
   (env vars to set, `CORS_ORIGIN` must name the Pages URL, `web/`'s
   `VITE_API_BASE_URL` must name wherever `api/` ends up).
4. `.doc/product-definition.md`: remove/revise "No production deployment in
   these two stages," matching this plan's scope.
5. `.doc/architecture.md`: revise "Runs locally in development; no
   deployment target in these stages" and add a Change Log entry once the
   frontend/backend pieces land.

### Frontend (`web/`)
6. `web/vite.config.ts`: mode-aware `base` — `/ai-dev/` when `mode ===
   'production'` (or an explicit Pages flag, agent's call on the cleanest
   way to express "this build targets Pages" without hardcoding an
   assumption that every production build is a Pages build going forward),
   unset/`'/'` otherwise.
7. `web/public/404.html`: a copy of `index.html`'s shell (or a small script
   that redirects to it) — the standard GitHub-Pages-SPA-routing workaround
   described in Assumptions.
8. `web/.env.staging.example` and `web/.env.production.example`: mirror
   `web/.env.example`'s two variables (`VITE_INTERVIEW_SOURCE`,
   `VITE_API_BASE_URL`) with placeholder/commented guidance for each
   environment (e.g. production's `VITE_API_BASE_URL` pointing at wherever
   `api/` is actually hosted, not `localhost`).
9. `web/package.json`: add `"build:staging": "vue-tsc --noEmit && vite build
   --mode staging"` alongside the existing `build` script (which already
   covers production).
10. Confirm (via a build, not just reading code) that `npm run build` and
    `npm run build:staging` both succeed and produce a `dist/` that loads
    correctly when served with the Pages `base` path — this is the one place
    "looks right" isn't enough, an actual build is the only real proof.

### Backend (`api/`)
11. `api/.env.example` (new — none exists today): every variable
    `api/src/config/env.ts` reads (`NODE_ENV`, `PORT`, `DATABASE_URL`,
    `ANTHROPIC_API_KEY`, `ORG_ID`, `LLM_QUESTION_MODEL`, `LLM_EVAL_MODEL`,
    `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
    `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`), with placeholder
    values and a one-line comment on each.
12. `api/.env.staging.example` and `api/.env.production.example`: same
    variable set, with comments on what must actually differ per
    environment (`CORS_ORIGIN` naming that environment's frontend URL,
    `NODE_ENV=production` for both per Node convention — "staging" is a
    deployment target, not a `NODE_ENV` value — real secrets never
    committed, generated per environment).
13. No code change to `api/src/config/env.ts` — it already reads whatever
    `.env` file the process was started with; this step is documentation-only
    per the Assumptions above. Confirm the existing `NODE_ENV` enum
    (`development`/`test`/`production`) doesn't need a `staging` value —
    it doesn't, since staging runs the server with `NODE_ENV=production` and
    different secrets, not a different `NODE_ENV`.

## Validation
- `cd web && npm run build && npm run build:staging` both succeed; inspect
  `dist/index.html` for the `/ai-dev/` base path in asset URLs after the
  production build, and confirm `dist/404.html` exists and is a functional
  copy of `index.html`.
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` still green —
  no application code changed, so no test should need updating; if one does,
  that's a signal something outside this plan's stated scope moved.
- `cd api && npm run typecheck && npm run lint && npm test` still green, same
  reasoning.
- Manually verify the broadened `block-secret-file-access.js` pattern: a
  throwaway attempt to read/cat a (temporarily created, then deleted)
  `.env.staging` file is blocked, while `.env.staging.example` is not.
- `yamllint`/GitHub's own workflow syntax check (or a manual read against
  `actions/deploy-pages`'s documented usage) on
  `.github/workflows/deploy-pages.yml` — this can't run end-to-end without
  pushing, so a careful manual review substitutes for that here.

## Risks
- The GitHub Pages workflow **cannot be verified by actually deploying**
  without the human pushing/merging it and enabling Pages in repository
  settings — both explicitly out of scope for this plan to do unilaterally
  (same bar as every git push/merge this session). Manual YAML review is the
  ceiling of what this plan can validate before that happens.
- Broadening the secret-file-access regex is itself a security-relevant
  change — get it wrong in the *other* direction (too broad) and it could
  block legitimate access to `.env.example`-pattern files that don't
  actually end in exactly `.example`; get it wrong by being too narrow and
  the gap this plan exists partly to close remains open. Test both
  directions explicitly, not just the one motivating case.
- `base: '/ai-dev/'` is derived from the current repo name — if the repo is
  ever renamed, this silently breaks the Pages build until someone remembers
  to update it. `.doc/deployment.md` should say this plainly so it isn't a
  mystery next time.

## Rollout Order
1. Security hook fix + `.doc/deployment.md` + doc scope updates (orchestrator)
   — the mechanism and its documentation, before anything depends on it.
2. `web/` changes (frontend agent) and `api/` changes (backend agent) — these
   are independent of each other (no shared contract, unlike a feature
   plan), so no ordering dependency between them.
3. QA pass: confirm both builds succeed, both suites remain green, the hook
   fix works in both directions, and the workflow YAML is sound by review.
4. Human: merge, enable GitHub Pages in repository settings (Source: GitHub
   Actions), and confirm the first real deployment — none of which this plan
   or its agents do unilaterally.

## Rollback
Entirely additive (new files, a broadened regex, a mode-conditional `base`
that defaults to today's unset/`/` behavior outside `production` mode) — no
schema, no existing route, no existing UI behavior changes. Reverting the
branch's merge commit removes the workflow, the example files, and the
`404.html`, and narrows the hook regex back — with no data or running
deployment affected, since this plan never triggers one itself.
