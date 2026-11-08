Status: draft
Owner: Ilana
Last updated: 2026-09-13

# Deploy `api/` to a Real Host

## Goal
Get `api/` actually running on a real, internet-reachable host with its own
PostgreSQL database, and leave a repeatable, step-by-step runbook for doing
it. `.doc/deployment.md`'s "Self-hosting `api/`" section already documents
this *generically* ("pick any Node 20+ host") — this plan picks one concrete
host, works through every step against it, and captures the host-specific
gotchas that only show up once you actually try. This is the backend half of
what [[021-2026-09-10-github-pages-rollout]] did for the frontend: that plan
got `web/` live on GitHub Pages; this one gets `api/` live so the Pages
frontend can leave `mock` mode and talk to a real backend.

## Scope
- In scope:
  - Provisioning one Node 20+ host + managed PostgreSQL instance for `api/`
    (Render — see Open Questions).
  - Filling in that host's real `.env` from `api/.env.production.example`
    (values only, done through the host's own secret manager / dashboard —
    never by an agent, never committed).
  - Bootstrapping the database from `api/schema.sql`.
  - Deploying and starting the `api/` process on that host, over HTTPS.
  - Wiring the already-deployed Pages frontend to the new backend: setting
    `VITE_INTERVIEW_SOURCE` / `VITE_API_BASE_URL` as GitHub repository
    Variables (per `.doc/deployment.md`) and confirming a redeploy picks them
    up.
  - Updating `.doc/deployment.md` and `.doc/architecture.md` with the real,
    concrete host details once live, replacing today's generic guidance.
- Out of scope:
  - Any change to `api/` application code, routes, or schema — this is
    infra/ops, not a feature. If a step below turns up a real code gap
    (there is one — see Assumptions), it's called out explicitly and kept to
    the minimum fix, same bar `.plan/014-2026-08-14-multi-env-deployment.md`
    used for its hook fix.
  - A separate `staging` host. Per `.doc/deployment.md`, staging and
    production share the same file/mode (`.env`, `NODE_ENV=production`) and
    differ only in values — this plan stands up one host; repeat it verbatim
    for a second tier later if one is ever wanted.
  - CI/CD automation for `api/` deploys (e.g. a GitHub Actions workflow that
    redeploys on push). Render already redeploys on push to the connected
    branch with zero extra config, so a custom workflow isn't needed to get
    this live.

## Assumptions
- **`npm start`'s `--env-file=.env` flag will not work on Render.**
  `api/package.json`'s `start` script is `node --env-file=.env dist/server.js`
  — it requires an actual file named `.env` in the working directory. Render
  injects configured environment variables straight into the process's
  environment; it does not write a `.env` file to disk. Run unmodified,
  `--env-file=.env` throws `ENOENT` before the server ever binds a port.
  This plan works around it by setting the service's **Start Command** to
  `node dist/server.js` (bypassing `npm start`) so the process reads
  `process.env` directly — a per-host deploy setting, not a code change.
  (A plain VPS where you manage the `.env` file yourself doesn't hit this —
  `npm start` works there unmodified.)
- **`CORS_ORIGIN`'s existing example value is still correct even though the
  repo was renamed.** `api/.env.production.example` sets
  `CORS_ORIGIN=https://ilanamost.github.io` — that's a bare origin (scheme +
  host), and a browser's `Origin` header never includes a path, so the Pages
  project's path segment (`/ai-interview-simulator/`, not the stale
  `/ai-dev/` the repo was once named) doesn't matter here. No fix needed,
  unlike `web/vite.config.ts`'s `base`, which [[021-2026-09-10-github-pages-rollout]]
  already had to correct because it *is* path-sensitive.
- **Secrets are filled in by hand, on the host, never by an agent.** Per
  `AGENTS.md` ("Never commit or expose secrets") and `.doc/deployment.md`,
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_ACCESS_SECRET`, and
  `JWT_REFRESH_SECRET` are generated fresh for this host and entered directly
  into Render's dashboard. This plan's steps say *which* variables to set and
  how to generate the secrets (`openssl rand -base64 48`), never what to set
  them to.
- **Auth cookies require real HTTPS, not just "the host says it's live."**
  `api/src/utils/auth-cookie.ts` issues `Secure` cookies whenever
  `NODE_ENV=production` (true on every deployed host per
  `.doc/deployment.md`). A host reachable only over plain `http://` will
  silently 401 every guarded request — login will appear to work (the
  response sets the cookie) but every subsequent request will look logged
  out, because the browser drops a `Secure` cookie sent over `http`. Render
  terminates HTTPS for you by default on its generated domain, so this is a
  non-issue for the recommended path; it's called out because it would
  matter a great deal on the plain-VPS alternative in the Open Question
  below.
- **`NODE_ENV=production` on the service also affects the build step, not
  just the running app — and breaks it by default.** Render runs the Build
  Command with the same environment variables set on the service, including
  the `NODE_ENV=production` this plan sets in step 4. `npm ci` treats
  `NODE_ENV=production` as an instruction to skip `devDependencies` —
  which strips out `typescript` and `@types/node`, both needed to compile
  (`api/tsconfig.json` has `"types": ["node"]`). Left as plain `npm ci`, the
  build fails with `TS2688: Cannot find type definition file for 'node'`
  (encountered in practice, not hypothetical). Fixed by forcing dev
  dependencies to install for the build step regardless: the Build Command
  in step 5 is `npm ci --include=dev && npm run build`, not `npm ci && npm
  run build`. This doesn't change runtime behavior — `NODE_ENV=production`
  still reaches the running process exactly as intended.
- **Render's free web service tier spins down when idle.** A free-tier
  service sleeps after ~15 minutes with no requests and cold-starts (roughly
  30-50s) on the next one. This affects Step 7's health check directly (the
  first hit after a deploy or a quiet period is slow — don't mistake that for
  a failed deploy) and, more importantly, means a real user's first request
  after idle time will feel slow too. Acceptable for getting this live and
  demoable; upgrade to a paid instance type later if consistent latency
  matters more than free hosting.
- **This plan assumes a managed platform, not a bare VPS** (see Open
  Questions) — a managed platform gets HTTPS, process supervision (restart on
  crash), and a provisioned Postgres instance for free, all of which a bare
  VPS would otherwise make this plan considerably longer (Nginx/Caddy config,
  certbot renewal, systemd unit, manual Postgres install and backups).

## Open Questions
- **Which host? — Decided: Render.** `.doc/deployment.md` deliberately names
  no specific provider; Render is the choice for this rollout (confirmed).
  It bundles a web service and a managed Postgres instance under one
  account, terminates HTTPS automatically on its generated domain, redeploys
  on push to the connected branch with no extra CI config, and exposes a
  Start Command override that covers the `--env-file` issue above without
  touching `package.json`. This plan's Steps are written directly against
  it. (Other options considered: Railway — near-identical shape, usage-based
  free tier instead of Render's time-based one; Fly.io — more manual
  (`fly.toml`, `flyctl deploy`); a plain VPS — most control, most manual work
  including your own TLS termination, see Assumptions.)
- **What domain does the API end up on?** Recommended default: Render's
  generated subdomain (e.g. `*.onrender.com`) — good enough for
  `VITE_API_BASE_URL` and for `CORS_ORIGIN` to name the Pages origin back.
  A custom domain (e.g. `api.<yourdomain>.com`) is a pure upgrade later and
  doesn't change any step below beyond the DNS/host-side config for it.

## Steps

### 1. Provision the host and database (Render)
1. Create a new Render **PostgreSQL** instance (Dashboard → New →
   PostgreSQL). Note both connection strings Render gives you: the
   **Internal Database URL** (for the `api/` service itself — Render's
   private network, no egress) and the **External Database URL** (for
   running `schema.sql` from your own machine in step 3, which isn't on that
   private network).
2. Create a new Render **Web Service** from the
   `ilanamost/ai-interview-simulator` GitHub repo, setting **Root Directory**
   to `api/` so Render builds/deploys only that subfolder.

### 2. Bootstrap the database
3. Run `api/schema.sql` against the new database once, before the app's
   first boot: `psql "$EXTERNAL_DATABASE_URL" -f api/schema.sql` (the
   **External** URL from step 1 — your machine can't reach the internal
   one). Confirm the idempotent `org` seed row exists afterward (`select *
   from org;`) per `.rule/database-rules.md`.

### 3. Configure the service's environment
4. In the Render service's **Environment** tab, set every key
   `api/.env.production.example` documents, with **real** values for this
   host — never the placeholder text:
   - `NODE_ENV=production`
   - `PORT` — leave unset. Render injects its own `PORT` and expects the
     process to bind to it; `api/src/server.ts` already calls
     `app.listen(env.PORT, ...)`, so this works with no code change as long
     as nothing here overrides it with a conflicting fixed value.
   - `DATABASE_URL` — the **Internal** Database URL from step 1 (the web
     service and database share Render's private network — use internal
     here, not the external one used for bootstrapping in step 3).
   - `ORG_ID=default`
   - `ANTHROPIC_API_KEY` — a production-only key, separate from any used
     locally, so spend/rate limits are tracked apart and revoking one never
     takes the other down.
   - `LLM_QUESTION_MODEL` / `LLM_EVAL_MODEL` — `claude-sonnet-5` unless
     there's a reason to change the default.
   - `CORS_ORIGIN=https://ilanamost.github.io` — the bare Pages origin (see
     Assumptions on why the path segment doesn't matter here).
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — two **different**, freshly
     generated secrets (`openssl rand -base64 48` each), unique to this
     host.
   - `ACCESS_TOKEN_TTL_MIN=15`, `REFRESH_TOKEN_TTL_DAYS=30` — defaults are
     fine unless there's a reason to change them.
5. Set the **Build Command** to `npm ci --include=dev && npm run build` (the
   `--include=dev` is required — see Assumptions) and override the **Start
   Command** to `node dist/server.js` (not the default `npm start`) — per
   Assumptions, `npm start`'s `--env-file=.env` flag fails on Render since it
   has no `.env` file on disk.

### 4. Deploy and verify
6. Trigger the first deploy (Render deploys automatically once the service
   and its variables are configured; otherwise use **Manual Deploy**). Watch
   the deploy logs for the `loadEnv` validation in `api/src/config/env.ts` —
   a missing/malformed variable fails fast with a named error there rather
   than a silent crash loop.
7. Once deployed, confirm the generated public URL (e.g.
   `https://<service>.onrender.com`) serves `GET /health` with `200 {
   "status": "ok" }`. Per Assumptions, the first request after a deploy or
   any idle period can take 30-50s (free-tier cold start) — retry once
   before treating a slow first response as a failure.
8. Exercise one real authenticated flow against the live URL (e.g. `curl` or
   Postman: `POST /api/auth/signup`, then a guarded route with the returned
   cookie) to confirm the `Secure` cookie round-trips correctly over the
   host's HTTPS — this is the scenario Assumptions flags as silently broken
   if HTTPS isn't actually terminated.

### 5. Wire the deployed frontend to the deployed backend
9. In the GitHub repo's Settings → Secrets and variables → Actions →
   Variables (not Secrets — neither value is sensitive, per
   `.doc/deployment.md`), set:
   - `VITE_INTERVIEW_SOURCE=http`
   - `VITE_API_BASE_URL=https://<service>.onrender.com` (the URL from step
     7)
10. Re-run `.github/workflows/deploy-pages.yml` (push touching `web/**`, or
    Actions → **Run workflow**) so the next Pages build inlines those
    variables — Vite bakes `VITE_*` values in at build time, so an existing
    build won't pick them up until it's rebuilt.
11. Load `https://ilanamost.github.io/ai-interview-simulator/`, run a full
    interview end to end (signup/login → setup → question → answer →
    evaluation → report), and confirm in the browser's Network tab that
    requests go to the Render URL and succeed — this is the first time the
    two deployed halves talk to each other for real.

### 6. Update the docs
12. `.doc/deployment.md`: replace the generic "Self-hosting `api/`" steps'
    framing with this plan's concrete, verified path (Render specifically),
    keeping the existing generic guidance as a fallback for "or any other
    Node 20+ host."
13. `.doc/architecture.md`: update the Context section (currently "`api/` has
    no provisioned host") and add a Change Log entry once the backend is
    actually live, naming Render and linking this plan.
14. `.doc/product-definition.md`: update the Operational Constraints bullet
    that currently says "`api/` has no provisioned host of its own."

## Validation
- `psql "$EXTERNAL_DATABASE_URL" -c "select * from org;"` against the new
  database returns the seeded row — proves `schema.sql` ran successfully.
- `curl -i https://<service>.onrender.com/health` returns `200` with
  `{"status":"ok"}` (allow for one slow/cold first request, see Assumptions).
- A `curl`/Postman signup → guarded-route round trip against the live URL
  succeeds (200, not 401) — proves the `Secure` cookie is actually being
  honored over real HTTPS, not just that the process is up.
- After wiring the frontend (steps 9-10): a full browser run of
  `https://ilanamost.github.io/ai-interview-simulator/` completes a real
  interview end to end with `VITE_INTERVIEW_SOURCE=http`, and the browser
  console/network tab shows no CORS errors and no failed requests.
- `cd api && npm run typecheck && npm run lint && npm test` still green
  beforehand — no application code is expected to change, so this is a
  pre-deploy sanity check, not new coverage.

## Risks
- **Cost.** Render bills once free-tier usage/time limits are exceeded; this
  plan doesn't commit to a specific budget — check Render's current pricing
  before provisioning, especially the Postgres instance (see next bullet).
- **Render's free PostgreSQL tier is time-limited, not just usage-limited.**
  Unlike a usage-based free tier, Render's free Postgres databases are
  deleted after a fixed period unless upgraded to a paid plan before that
  deadline — check the current limit in Render's dashboard/pricing page at
  provisioning time and set a reminder, or this deployment silently loses
  its database on a schedule nobody was tracking.
- **Secrets end up in a third-party dashboard.** Standard for any managed
  PaaS, but worth naming: Render's environment variable store is now a place
  real production secrets live outside this repo entirely. Rotate
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (which just invalidates every
  live session) rather than the database credentials if the host account is
  ever compromised.
- **The `--env-file` start-command workaround is host-config, easy to lose.**
  If the service is ever recreated or migrated to another host, the Start
  Command override (step 5) has to be re-applied manually — it lives in
  Render's dashboard, not in a committed file. Worth a one-line note in
  `.doc/deployment.md` (step 12) so a future host swap doesn't silently
  reintroduce the `ENOENT` crash.
- **Free-tier cold starts are a real UX cost, not just a verification
  nuisance.** Beyond slowing down Step 7's health check, every real user
  hitting the Pages frontend after 15+ minutes of no traffic will see a
  30-50s hang on their first request. Acceptable to ship with initially;
  worth revisiting (paid instance type) if that turns out to be a real
  adoption blocker.
- Same limitation every prior deployment plan in this repo has noted: none
  of steps 1-11 can be verified without actually provisioning real
  infrastructure and spending real API/DB calls — this can't be dry-run any
  further than the Assumptions section already reasons through.

## Rollout Order
1. Provision host + database (steps 1-2) and confirm the schema bootstrap
   (Validation's first bullet) before touching env vars, so a bad connection
   string is caught early.
2. Configure env vars and the start-command override (steps 4-5), deploy,
   and verify `/health` plus one authenticated round trip (steps 6-8) — get
   the backend fully working standalone before wiring anything to it.
3. Wire the frontend (steps 9-11) only after step 2 is fully green — pointing
   a live frontend at a backend that isn't verified yet just moves the
   debugging into the browser.
4. Update docs (steps 12-14) last, once the real host details are known and
   confirmed live, so the docs describe what's actually running rather than
   a plan.

## Rollback
Entirely reversible with no data-loss risk to anything that exists today:
this plan stands up new infrastructure and adds new repository Variables; it
changes no application code, no schema, and no existing GitHub Pages
behavior. If the deployment needs to be undone: unset the
`VITE_INTERVIEW_SOURCE`/`VITE_API_BASE_URL` repository Variables and rebuild
Pages (falls back to `mock` mode per `.doc/deployment.md`'s documented
default — the frontend keeps working as an offline demo), then tear down the
Render web service and its Postgres instance. No commit needs reverting
unless the doc updates (steps 12-14) already landed, in which case reverting
that commit restores the generic-only guidance.
