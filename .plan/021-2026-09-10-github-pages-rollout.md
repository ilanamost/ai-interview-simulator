Status: active
Owner: Ilana
Last updated: 2026-09-10

# Deploy `web/` to GitHub Pages

## Goal
Get the already-built GitHub Pages mechanism actually live at
`https://ilanamost.github.io/ai-interview-simulator/`, and leave a clear,
step-by-step runbook for doing it (and repeating it later). This is a
rollout/runbook plan, not a new-feature plan: [[021-2026-09-10-github-pages-rollout]]
finishes what `.plan/014-2026-08-14-multi-env-deployment.md` started — that
plan built the mechanism (workflow, mode-aware `base`, `404.html`,
`.doc/deployment.md`) but explicitly left "enable Pages in repository
settings" and "confirm the first real deployment" as the human's action, still
outstanding.

## Scope
- In scope: the two real blockers found while checking today's repo state
  (see Assumptions) that would make the existing workflow fail or silently
  produce a broken deployment, plus the manual GitHub-side steps only a repo
  admin can do, plus verifying the result.
  - Repo root: `.gitignore` (carve out an exception so the Pages workflow is
    actually committed), `.github/workflows/deploy-pages.yml` (get it
    tracked and pushed).
  - `web/vite.config.ts`: fix the hardcoded Pages base path to match the
    repo's real name.
- Out of scope: any application code change to `web/` or `api/`; hosting
  `api/` anywhere (this deploys the static frontend only, same as
  plan 014); adding a `staging` deployment target (plan 014 already scoped
  that out; nothing here revisits it); re-litigating the `.doc/`/`.claude/`
  exclusion from `.gitignore` — only `.github/workflows/` is touched.

## Assumptions
- **The workflow file cannot reach GitHub today.** `git ls-files .github/`
  returns nothing — `.gitignore` has a block ("Agent guardrail/config and
  docs directories") that excludes `.github/` wholesale, alongside
  `.claude/`, `.doc/`, and `.rule/`. That block makes sense for the agent
  scaffolding, but it also swallows `.github/workflows/deploy-pages.yml`,
  which is real deployment infrastructure, not agent config — as written, it
  can never be pushed, so GitHub has no workflow to run no matter what
  happens in repo Settings. This looks like the `.github/` line was meant to
  catch some other agent-only subpath and over-matched; see Open Questions
  for the exact fix.
- **The Pages `base` path is already wrong for this repo.** `git remote -v`
  shows `origin` is `ilanamost/ai-interview-simulator`, but
  `web/vite.config.ts`'s `PAGES_BASE` is hardcoded to `/ai-dev/` (with a
  comment saying exactly "if this repository is ever renamed, update this
  value" — `.plan/014-2026-08-14-multi-env-deployment.md` flagged this
  as a risk, and it has now happened). Left as-is, a production build emits
  asset URLs like `/ai-dev/assets/....js`, which 404 under the real Pages
  URL `https://ilanamost.github.io/ai-interview-simulator/` — a blank page.
  This must be fixed before the workflow is ever pushed, not after.
- **Everything else the mechanism needs already exists and does not need to
  be rebuilt:** `web/404.html` (SPA deep-link fallback), `.doc/deployment.md`
  (environment/variable reference), the workflow's build-and-deploy steps
  themselves (`actions/checkout`, `setup-node`, `npm ci`, `npm run build`,
  `actions/upload-pages-artifact`, `actions/deploy-pages`). This plan does
  not re-derive that design — see `.plan/014-2026-08-14-multi-env-deployment.md`
  for the reasoning behind it.
- **No `api/` is hosted anywhere yet.** Per `.doc/deployment.md`, an unset
  `VITE_INTERVIEW_SOURCE`/`VITE_API_BASE_URL` falls back to `mock` mode — so
  the first live deployment is a working offline demo, not a broken one.
  Pointing it at a real `api/` is a separate, later step (repository
  Variables, not Secrets — see `.doc/deployment.md`), out of scope here.

## Open Questions
- **How should `.gitignore` carve out the workflow file?** Two ways to do
  it:
  - (a) **Recommended.** Narrow the existing line from `.github/` to
    `.claude/` only affecting agent-specific paths, and add an explicit
    negation so the workflows directory is tracked:
    ```
    .github/
    !.github/workflows/
    ```
    Keeps every other agent/orchestration exclusion in that block exactly as
    it is; only `.github/workflows/` becomes trackable.
  - (b) Remove `.github/` from the ignore block entirely, so anything ever
    added under `.github/` (issue templates, CODEOWNERS, other workflows)
    is trackable by default.
  Recommended: (a) — smallest change that unblocks this task, no implicit
  change to what future `.github/` content does.
- **Who runs the GitHub-side steps (enabling Pages, watching the run)?**
  These need repo admin access in the GitHub UI, which this plan's steps
  list explicitly as the human's action — same boundary
  `.plan/014-2026-08-14-multi-env-deployment.md` drew. Recommended: the
  human runs Steps 5–7 below; everything before that can be prepared and
  reviewed first.

## Steps

### Repo root
1. `.gitignore`: apply the Open-Questions fix (a) — narrow the `.github/`
   ignore to `.github/workflows/` being explicitly un-ignored, keeping
   `.claude/`, `.doc/`, `.rule/`, and the rest of that block untouched.
2. `git add -f .github/workflows/deploy-pages.yml` (or a plain `git add`
   once step 1 makes it non-ignored) so it's staged for the first time —
   confirm with `git status` that no other currently-ignored file (`.doc/`,
   `.claude/`, secrets) gets swept in accidentally.

### Frontend (`web/`)
3. `web/vite.config.ts`: change `PAGES_BASE` from `/ai-dev/` to
   `/ai-interview-simulator/` (matching `origin`'s real
   `ilanamost/ai-interview-simulator`), and update the file's own comment
   that currently asserts the wrong repo name.
4. Build and inspect locally before trusting CI with it:
   `cd web && npm run build`, then check `web/dist/index.html` for asset
   URLs prefixed `/ai-interview-simulator/` (not `/ai-dev/`). `npm run
   preview -- --base=/ai-interview-simulator/` (or serve `dist/` behind that
   path some other way) to confirm the built app actually loads, not just
   that the string looks right.

### Human (repo admin — GitHub UI)
5. Push the branch containing steps 1–3 and get it merged to `master` (per
   `.claude/rules/git-workflow.md`: dedicated branch, explicit approval
   before commit/merge — this plan does not do either unilaterally).
6. In the repo's GitHub Settings → Pages, set **Source: GitHub Actions**.
   Until this is set, the workflow can run green with nothing to publish to.
7. Trigger the first run: either push touching `web/**` (the merge in step 5
   already does, since it touches `web/vite.config.ts`) or run the workflow
   manually via Actions → "Deploy web/ to GitHub Pages" → **Run workflow**
   (the `workflow_dispatch` trigger already in the file).

## Validation
- `cd web && npm run build` succeeds and `web/dist/index.html`'s asset
  `src`/`href` values are prefixed `/ai-interview-simulator/`.
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` still green —
  no application logic changed, only a config constant and a comment.
- `git ls-files .github/workflows/deploy-pages.yml` returns the path (proves
  it's actually tracked, not just present on disk) — run this before
  pushing, so a silent gitignore failure doesn't get discovered on GitHub.
- After the human completes Steps 5–7: the Actions run for "Deploy web/ to
  GitHub Pages" finishes green (`gh run list --workflow=deploy-pages.yml`),
  and `https://ilanamost.github.io/ai-interview-simulator/` loads the app
  shell with no blank page or 404'd asset in the browser console. Also
  spot-check a deep link (e.g. `.../ai-interview-simulator/practice` typed
  directly, or a hard reload on a non-root route) to confirm `web/404.html`'s
  SPA fallback works under the corrected base path.

## Risks
- If step 1's `.gitignore` fix is too broad, it could accidentally un-ignore
  something under `.github/` that was meant to stay untracked (none exists
  today — the directory currently holds only the workflow file — but check
  `git status` after the change to be sure nothing unexpected appears
  staged).
- The base-path fix (step 3) only covers today's repo name. If the repo is
  renamed again, this breaks the same way it just did — `.doc/deployment.md`
  already says this plainly; no new mitigation is added here beyond what
  plan 014 already documented.
- The Actions run itself can only be verified once actually pushed and
  merged (same limitation plan 014 called out) — steps 1–4 are as far as
  this plan can validate before the human's steps 5–7.

## Rollout Order
1. Repo-root + frontend fixes (steps 1–4) on a dedicated branch — e.g.
   `fix/github-pages-base-path`.
2. Human review and approval to commit/push/merge (per the approval gates in
   `.claude/rules/git-workflow.md` — nothing here is committed or pushed
   without that).
3. Human: enable Pages source, trigger/confirm the first run (steps 5–7).
4. Validate the live URL per the Validation section above.

## Rollback
Entirely additive/corrective — a `.gitignore` exception, a corrected string
constant and its comment, and a first-time push of a file that already
existed locally. Reverting the merge commit re-ignores
`.github/workflows/deploy-pages.yml` and restores the old (broken) base
path; it does not remove or affect the already-published Pages site (Pages
serves whatever the last successful deployment published until a new one
replaces it — reverting the source doesn't retroactively un-publish).
