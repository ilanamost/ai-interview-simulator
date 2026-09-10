# Persist Interview Session Across Reload

Status: active
Owner: Ilana
Last updated: 2026-07-28

## Goal
- Make an in-progress (or just-finished) interview survive a browser refresh: the user lands back on the same question/evaluation/report instead of being bounced to `SetupView` with a lost session.

## Scope
- In scope:
  - `web/` only. Persist enough state client-side to rehydrate `web/src/stores/interview.store.ts` on page load, in both `VITE_INTERVIEW_SOURCE` modes (`mock` and `http`).
  - A storage layer (`web/src/services/session-storage.service.ts` or similar) wrapping `localStorage`, with a versioned key so a future shape change doesn't crash on old data.
  - Rehydration wiring in `web/src/main.ts` (or a Pinia plugin) that runs before the router's first navigation, since `router/index.ts:27-34` guards already check `store.hasSession` / `store.report`.
  - Clearing the persisted snapshot when the user explicitly abandons/restarts (`reset()`), and on stale/expired/invalid data.
- Out of scope:
  - Any `api/` change. The Stage 2 backend already persists everything server-side; this plan reuses `GET /api/interview/:id` (`api/src/routes/interview.routes.ts:46`, already implemented, currently uncalled — see `.doc/architecture.md`'s Data Flow note) rather than adding new endpoints.
  - Multi-tab sync, cross-device resume, or "resume an old finished interview from a history list." This is single most-recent-session resume only.
  - Changing the follow-up/report domain logic itself.

## Assumptions
- Single user, single browser, local dev — matches `.doc/product-definition.md`'s operational constraints. No auth, so nothing sensitive (no API keys, no PII beyond the user's own practice answers) ends up in storage.
- `InterviewSession` (`web/src/types/interview.ts:85-93`) already contains everything needed to reconstruct where the user is: `asked`, `answers`, `evaluations` are pushed in lockstep such that `asked.length === answers.length` means "answered, waiting on continue" (`reviewing`) and `asked.length === answers.length + 1` means "waiting on an answer" (`asking`). `currentQuestion` / `currentEvaluation` therefore don't need separate persistence — they can be re-derived from `session` + `report` on load.
- In `http` mode, the Postgres row behind `session.id` is the real source of truth, not the browser copy. Client storage there should hold a **pointer** (session id + source mode) and re-fetch via `GET /api/interview/:id`, rather than trusting a possibly-stale local snapshot.
- In `mock` mode there is no server, so the full `session` (+ `report`, once produced) must be the thing persisted — it's the only copy that exists.

## Open Questions
Resolved 2026-07-28 — implemented with the recommended defaults below (1–3), and doc updates (4) applied to `.doc/product-definition.md` and `.doc/architecture.md`.

1. **localStorage vs sessionStorage — recommendation: `localStorage`.**
   - `sessionStorage` is cleared the moment the tab/window closes, which reintroduces the exact loss the user is asking to fix (accidental tab close, crash, browser restart) — it only protects against the in-tab refresh case.
   - `localStorage` survives all of that, at the cost of a session lingering if the user never finishes it. That's addressed below with a `createdAt`-based expiry (propose 24h) and an explicit clear on `reset()` / starting a new interview.
   - Confirm: is `localStorage` acceptable, or is there a reason (shared/kiosk machine, privacy concern) to prefer the narrower `sessionStorage` behavior instead?
2. Expiry window for an abandoned persisted session — proposing 24 hours from `session.createdAt`, after which rehydration is skipped and storage is cleared. Adjust if you want shorter/longer.
3. In `http` mode, if `GET /api/interview/:id` 404s (e.g., local Postgres was reset since the last run), should the app silently drop back to `SetupView` (proposed), or surface a toast explaining the old session is gone?
4. `.doc/product-definition.md` currently lists Stage 1 as explicitly "no persistence: a page refresh ends the session by design," and `.doc/architecture.md` repeats this. Per this repo's doc update-trigger rules, this plan should update both once implemented — confirm that's wanted as part of this change (proposed: yes, since it's a real scope change, not just an implementation detail).

## Steps
1. **Storage service** — add `web/src/services/session-storage.service.ts`:
   - `save(snapshot)` / `load()` / `clear()` around a single versioned `localStorage` key (e.g. `interview-session-v1`).
   - Snapshot shape: `{ version, source: 'mock' | 'http', session: InterviewSession, report: Report | null, savedAt: string }`.
   - `load()` returns `null` (not throw) on missing key, JSON parse failure, version mismatch, or expiry — every caller treats "nothing to resume" as the default path. Wrap `localStorage` calls in try/catch (private browsing / quota can throw) and treat failures the same as "nothing to resume," per `.rule/error-handling-rules.md`'s fail-safe-to-client-UX guidance — this is a UX nicety, never a hard failure.
2. **Derive status/currentQuestion/currentEvaluation from a session** — add a pure helper (e.g. in the store or a small util) that takes `(session, report)` and returns `{ status, currentQuestion, currentEvaluation }` using the invariant in Assumptions. Reuse it both for rehydration and (optionally) to simplify `loadNextQuestion`/`submitAnswer`'s existing manual state juggling — but don't refactor that path beyond what's needed, per repo conventions against unrequested cleanup.
3. **Persist on change** — in `interview.store.ts`, after every mutation that changes `session`/`report` (`start`, `submitAnswer`, `continueInterview`/`loadNextQuestion`, `finish`), call `save()` with the current snapshot. A single `watch([session, report], ..., { deep: true })` near the store's setup is simplest and keeps call sites untouched.
4. **Clear on reset** — `reset()` already zeroes the in-memory state; make it also call `clear()` so starting a new interview doesn't leave the old one resumable.
5. **Rehydrate on boot**:
   - `mock` mode: read the snapshot, restore `session`/`report` into the store, derive `status`/`currentQuestion`/`currentEvaluation` via step 2's helper, done — no network call.
   - `http` mode: read the snapshot for the session id only, call `GET /api/interview/:id` (already implemented server-side; add a `getSession(id)` method to `interview-http.service.ts`'s `InterviewSource` or a small standalone fetch — check whether `InterviewSource` is the right seam or a separate one-off call, since `getSession` isn't part of the existing contract) to get the authoritative session, then derive state the same way. On any fetch error/404, `clear()` and leave the store empty (falls through to `SetupView` per existing router guards) — see Open Question 3 for whether to also toast.
   - Wire this to run in `main.ts` before `app.mount`, or as a Pinia plugin (`store.$onAction`/init hook) — whichever keeps `router`'s existing `beforeEach` guards (`router/index.ts:27-34`) working unchanged, since they already gate on `store.hasSession` / `store.report`.
6. **Update the stale "nothing is persisted" comment** in `router/index.ts:26` and the Stage 1 claims in `.doc/product-definition.md` / `.doc/architecture.md` once behavior changes (see Open Question 4).

## Validation
- New unit tests for the storage service: save/load/clear round-trip, version-mismatch → `null`, expired `savedAt` → `null`, corrupted JSON → `null`.
- New unit tests for the derive-state helper: asking mid-question, reviewing after an answer, complete with a report, plus the follow-up case (`isFollowUp` question doesn't bump `answeredCount`/`totalCount`).
- Store tests: refresh-simulation — construct a store, drive it to each status, snapshot via the storage service, build a fresh store instance from that snapshot, assert identical `status`/`currentQuestion`/`currentEvaluation`/`progress`.
- Router test: hitting `/interview` or `/report` directly with a valid persisted snapshot no longer redirects to `/`.
- Manual pass in both `mock` and `http` source modes (`.rule/testing-rules.md` calls for persistence-critical paths to be covered, but a real browser refresh is the one thing the test suite can't simulate): start an interview, answer at least once, refresh mid-question and mid-review, and once more after the report — confirm the exact screen and content survive each time.

## Risks
- **Drift between local snapshot and server state in `http` mode** (e.g., another process/tab mutated the same interview) — mitigated by treating the server response from `GET /api/interview/:id` as authoritative on every rehydrate rather than trusting the cached snapshot's `session` contents.
- **Stale localStorage after a schema change** to `InterviewSession`/`Report` — mitigated by the `version` field; bump it on any breaking shape change so old entries are ignored instead of crashing rehydration.
- **Abandoned sessions never clean up** if the user simply stops using the app — mitigated by the expiry window (Open Question 2) and by `reset()` clearing on next start.
- **Storage exceptions (quota, private-mode restrictions)** — mitigated by try/catch around every `localStorage` call, degrading to "no persistence this run" rather than breaking the app.

## Rollout Order
1. Storage service + derive-state helper + their unit tests (no store wiring yet — inert).
2. Wire `save`/`clear` into the store's existing mutation points.
3. Wire rehydration into app boot for `mock` mode; verify with manual refresh testing.
4. Add `getSession`/`GET /api/interview/:id` call and wire rehydration for `http` mode; verify against a local `api/` + Postgres instance.
5. Update `router/index.ts` comment and the two docs (Open Question 4).

## Rollback
- Each piece is additive and isolated: removing the `watch()` call in the store (step 3 of Steps) and the boot-time rehydration call (step 5) fully reverts to current refresh-loses-everything behavior with no data-shape changes to roll back. The storage service file can simply be deleted; nothing else depends on it.
