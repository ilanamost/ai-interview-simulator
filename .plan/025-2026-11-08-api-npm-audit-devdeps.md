# 025 — Clear remaining `api/` npm audit findings

Status: done
Owner: Ilana
Last updated: 2026-11-08

Task: backlog item "Fix the issue: 12 vulnerabilities (10 moderate, 2 critical)…" — treated as `stack:full` (the work is entirely in `api/`).
Branch: `fix/api-npm-audit-devdeps`
Follows: PR #9 `fix/api-npm-audit` (earlier partial fix; 12 findings remain).

## Goal
`npm audit` in `api/` reports 0 vulnerabilities, with `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` still passing.

## Scope
In scope (`api/` only):
- `api/package.json` and `api/package-lock.json` dependency versions.
- Minimal config or test-code changes forced by those upgrades (e.g. `eslint.config.*`, `vitest.config.*`).

Out of scope: `web/`, application source behaviour, API contract, DB schema, deploy automation.

Current findings (`npm audit`, 2026-11-08) — **all dev dependencies**; `npm audit --omit=dev` = 0:
| Package | Severity | Fix |
|---|---|---|
| `vitest` (direct), `tinypool`, `@vitest/mocker` | critical / critical / moderate | `vitest@5.1.0` (major) |
| `eslint` (direct), `minimatch`, `@eslint/config-array` | moderate | `eslint@9.39.5` (npm reports this as a major change from the installed 10.x) |
| `typescript-eslint` (direct) and `@typescript-eslint/*` | moderate | non-breaking per npm |

## Assumptions
- Render's build installs dev dependencies (it needs `tsc`), so the audit warning shows on every deploy even though the runtime has no findings.
- vitest 5 keeps `vitest run`, `describe/it/expect` and the supertest tests working with little or no change.
- The `eslint@9.39.5` suggestion may be an artefact of npm's advisory data; a newer 10.x or `typescript-eslint` update might clear it instead. The agent verifies before downgrading.

## Open Questions
1. If clearing the eslint findings needs a **downgrade** from eslint 10 to 9, is that acceptable?
   - Recommended: **Yes**, only if no 10.x release clears the advisory; the dev tooling is not shipped.
2. If any finding cannot be cleared without breaking tests, may the agent stop and report instead of using `npm audit fix --force` blindly?
   - Recommended: **Yes**.

## Steps
1. Baseline: record `npm audit`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` results in `.orchestrate/backend-agent-report.md`.
2. Run `npm audit fix` (non-breaking) and re-check.
3. Bump `vitest` to the fixed 5.x release; fix any config or test-API fallout.
4. Resolve the eslint / `typescript-eslint` / `minimatch` chain (prefer a fixed 10.x or updated `typescript-eslint`; fall back to eslint 9.39.5 per Open Question 1); fix lint-config fallout.
5. Remove any `overrides` in `package.json` that are no longer needed; keep `qs` override only if still required.
6. Regenerate `package-lock.json`; confirm `npm ci` works from a clean `node_modules`.
7. Write the API contract note: "no contract change" in `.orchestrate/api-contract.yaml` (unchanged).

## Validation
QA checklist (each item provable by a command, run in `api/`):
- [ ] `npm audit` → `found 0 vulnerabilities`.
- [ ] `npm audit --omit=dev` → `found 0 vulnerabilities`.
- [ ] `npm ci && npm test` → all tests pass, same test count as the baseline.
- [ ] `npm run lint` → exits 0 with `--max-warnings 0`.
- [ ] `npm run typecheck` and `npm run build` → exit 0; `dist/server.js` is produced.
- [ ] `git diff --stat` touches only `api/package.json`, `api/package-lock.json` and minimal config/test files; no `web/` changes and no source behaviour changes.
- [ ] `web/` suite untouched (not run unless `web/` files changed).

## Risks
- vitest 3→5 may change config options, mocking or snapshot behaviour → fix per migration notes, never delete tests.
- eslint downgrade or flat-config changes may surface new lint errors → fix them minimally.
- Node version on Render may be older than vitest 5 requires → check `engines` in the new versions against Render's Node version and note any needed `NODE_VERSION` bump.

## Rollout Order
1. Backend agent on this branch → 2. QA agent → 3. human review of the Linear QA ticket → 4. user-approved commit and PR → 5. Render redeploys on merge and the audit warning should disappear from the build log.

## Rollback
Revert the commit (or restore `api/package.json` and `api/package-lock.json` from `master`) and run `npm ci`. No data, schema or API changes are involved.
