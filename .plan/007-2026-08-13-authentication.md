Status: done
Owner: dev-loop orchestrator
Last updated: 2026-08-13

# Authentication (stack:full)

## Goal
Add email/password authentication so the app has real users: signup, login, logout,
a user-settings page (name, email, password, profile image), a header settings menu,
and a login/signup gate for unauthenticated visitors. Backlog source:
`.plan/000-backlog.md` item 1. Product scope updated in
[.doc/product-definition.md](../.doc/product-definition.md) to bring auth in scope
(it previously listed auth as out of scope — see this plan's approval as the record
of that scope change).

## Scope
- `stack:full` — touches both `api/` and `web/`.
- In scope:
  - `api/`: `user` table + `user_session` table (for refresh-token revocation),
    password hashing, JWT access/refresh issuance, `/api/auth/*` and `/api/user*`
    routes, an auth middleware applied to every existing route (interviews are now
    owned by an authenticated user, not the static `ORG_ID`).
  - `web/`: Pinia `auth` store + `auth` service (HTTP calls to the new routes, per
    the store-owns-API-calls pattern backlog item 2 will formalize repo-wide —
    applied here only to the new auth code, not retrofitted onto
    `interview.store.ts`), `LoginView`/signup form, `UserSettingsView` with profile
    image upload, header "settings" menu (User settings, Logout), router guard that
    redirects unauthenticated visitors to `/login`, avatar shown in the header with
    a round border.
- Out of scope (explicitly deferred, do not implement here):
  - Retrofitting `interview.store.ts` / `interview.service.ts` to the store-owns-API
    pattern — that's backlog item 2, a separate plan.
  - OAuth/social login, email verification, "forgot password" flow — backlog only
    asked for email+password signup/login/logout/settings.
  - Multi-org / multi-tenant UI — the app still runs a single `org`; `user` rows
    just carry the `org` column that already exists on every other table.
  - Rate limiting / brute-force lockout on login — noted as a Risk, not built now.

## Assumptions
- Local dev only, per `.doc/product-definition.md` operational constraints — no
  production deployment in this stage. Cookies therefore run `Secure: NODE_ENV ===
  'production'`, `SameSite=Lax` (a `Secure` + `SameSite=None` cookie cannot be sent
  over plain `http://localhost`, which is how both dev servers run today).
  Confirmed by adopting this as the design (this plan's answer to the open question
  below), not left open.
- Single default `org` continues to seed itself in `schema.sql`; every signed-up
  user is created under that `org` (`ORG_ID` env var), matching
  `.doc/architecture.md`'s note that only the *source* of `org` changes later
  (env constant → authenticated request), not the schema.
- Profile images are small (avatar, not a gallery) — stored inline rather than
  standing up file storage. See the open question below for the size cap.

## Open Questions
1. **Token delivery: HttpOnly cookies carrying JWTs, or a bearer token in
   `localStorage`?**
   Recommended: **HttpOnly, Secure (prod) cookies**, one for a short-lived access
   token (15 min) and one for a longer-lived refresh token (30 days), matching the
   backlog's own "Preferred for web apps" note and `.rule/security-rules.md`
   ("never rely on client-side storage of tokens the JS can read" —
   `localStorage` is readable by any injected script, cookies with `HttpOnly` are
   not). The frontend never touches the raw token.
2. **Do the existing `/api/interview` routes require auth now, or stay open?**
   Recommended: **require auth**, resolving `org` from the authenticated user
   instead of the static `ORG_ID` constant. `.rule/security-rules.md` says
   "Enforce authentication on every endpoint except explicitly public routes" —
   leaving interview data open while shipping "auth" would be a half-measure and a
   real hole (any unauthenticated caller could still read/write interview data).
   `ORG_ID` remains as the org every signup lands in; it just stops being read
   per-request.
3. **Profile image storage: filesystem, object storage, or inline in the DB?**
   Recommended: **inline as a data URL in `user.avatar_url` (text column)**, capped
   at 2MB before base64 encoding, rejected with `400` above that. No new storage
   infra needed for a local-dev-only stage; revisit if/when the app gets a real
   deployment target.
4. **Signup/login as one combined route or two?**
   Recommended: **one route, `/login`**, with a toggle between "Sign in" and
   "Create account" (backlog says "a new route... that will have all the fields
   needed for the login/signup process" — singular route, both flows).

## Steps

### Backend (`api/`)
1. Add dependencies: `bcrypt`, `jsonwebtoken`, `cookie-parser` (+ `@types/*` in
   devDependencies).
2. `api/schema.sql`: add `user` table (`id text primary key`, `org text not null
   references org(id)`, `email text not null`, `password_hash text not null`,
   `name text not null`, `avatar_url text null`, `created_at`, `updated_at`,
   `deleted_at`), unique index on `lower(email)`. Add `user_session` table (`id`,
   `user_id references user(id)`, `org`, `refresh_token_hash text not null`,
   `expires_at timestamptz not null`, `revoked_at timestamptz null`,
   `created_at`) with an index on `user_id`. Follow `.rule/database-rules.md`
   conventions already used by `interview`/`question` (idempotent `create table if
   not exists`, `org`-scoped, indexed FK columns).
3. `api/src/config/env.ts`: add `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (required,
   no default — fail fast per existing `loadEnv` pattern), `ACCESS_TOKEN_TTL_MIN`
   (default 15), `REFRESH_TOKEN_TTL_DAYS` (default 30).
4. `api/src/repositories/user.repository.ts` and
   `api/src/repositories/user-session.repository.ts` — parameterized queries only,
   every query scoped by `org`, mirroring `interview.repository.ts`.
5. `api/src/services/auth/password.service.ts` (bcrypt hash/verify, cost factor
   12) and `api/src/services/auth/token.service.ts` (sign/verify access + refresh
   JWTs).
6. `api/src/services/auth.service.ts`: `signup`, `login`, `logout`, `refresh`,
   `getCurrentUser`, `updateProfile` (name/email/password/avatar — password change
   re-hashes and revokes all other `user_session` rows for that user, per
   `.rule/security-rules.md` "Invalidate sessions/tokens on logout, password
   change"). Reject signup on duplicate email with `409 EMAIL_TAKEN`. Wrong
   credentials on login return `401 INVALID_CREDENTIALS` (never reveal whether the
   email exists).
7. `api/src/middleware/require-auth.ts`: reads the access-token cookie, verifies
   the JWT, sets `req.user`/`req.org`; `401 UNAUTHENTICATED` when missing/invalid/
   expired. Mirrors `error-handler.ts`'s `AppError` pattern.
8. `api/src/routes/auth.routes.ts`: `POST /api/auth/signup`, `POST
   /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh` (all public
   — these are the "explicitly public routes" the auth middleware doesn't guard).
9. `api/src/routes/user.routes.ts`: `GET /api/user`, `PATCH /api/user`, guarded by
   `require-auth`.
10. `api/src/app.ts`: register `cookie-parser`; apply `require-auth` to
    `/api/interview` and `/api/user`; mount `/api/auth` (public) and `/api/user`.
    Update `CreateAppOptions`/callers (`server.ts`, existing `app.spec.ts` setup)
    so `org` is resolved from `req.org` inside routes rather than passed in as a
    static option — check `interview.routes.ts` for where `org` is currently
    threaded through and switch that source.
11. Zod `.strict()` validation on every new route body, matching
    `interview.routes.ts`'s existing pattern.

### Frontend (`web/`)
12. `web/src/types/user.ts`: `User` shape (`id`, `email`, `name`, `avatarUrl`) —
    mirrors the backend response, no password/token fields ever present client-side.
13. `web/src/services/auth.service.ts`: HTTP calls to `/api/auth/*` and
    `/api/user`, `credentials: 'include'` on every request so cookies travel;
    maps non-2xx into a typed error the same way
    `interview-http.service.ts` maps into `InterviewError`.
14. `web/src/stores/auth.store.ts`: Pinia store owning `user`/`isAuthenticated`;
    actions `signup`, `login`, `logout`, `fetchMe`, `updateProfile` all call
    through `auth.service.ts` (no component makes a raw `fetch`); each action
    catches service errors and surfaces a `vue-sonner` toast, per
    `.claude/rules/ui-and-styling.md` and `.rule/error-handling-rules.md`
    ("user-safe, clear messages").
15. `web/src/main.ts`: await `useAuthStore().fetchMe()` before mounting (same
    pattern as `useInterviewStore().rehydrate()`), so the router's first guard
    check already knows auth state.
16. `web/src/router/index.ts`: add `{ path: '/login', name: 'login' }` (public)
    and `{ path: '/settings', name: 'settings' }` (`meta: { requiresAuth: true }`).
    Add `requiresAuth: true` to every existing route except `/login`. Guard:
    unauthenticated + `requiresAuth` → redirect to `login`; authenticated + on
    `login` → redirect to `home`.
17. `web/src/views/LoginView.vue`: single route, toggle between sign-in and
    create-account forms (per Open Question 4); calls `auth.store`.
18. `web/src/views/UserSettingsView.vue`: form for name/email/password + optional
    image upload (client-side resize/guard before base64-encoding, matching the
    2MB cap from Open Question 3); calls `auth.store.updateProfile`.
19. New `web/src/cmps/SettingsMenu.vue`: header dropdown, `Settings` trigger icon,
    menu items "User settings" and "Logout" each with a `lucide-vue-next` icon
    (reuse `Settings`/`LogOut` naming — check no existing icon name collision in
    `web/src/cmps/`).
20. `web/src/App.vue`: render `SettingsMenu` in `.app-header` when authenticated;
    show the user's avatar (round border) next to it when `avatarUrl` is set,
    otherwise a default user icon.
21. New stylesheet `web/src/styles/cmps/menu.css` (or extend an existing cmp file
    if a dropdown pattern already exists) — imported from
    `web/src/styles/cmps/index.css`, tokens from `variables.css`, no inline
    styles, per `.claude/rules/ui-and-styling.md`.
22. Update `.doc/architecture.md`'s "Auth and Org Boundaries" section once
    implemented (currently says "None in Stage 1 or Stage 2") — required by that
    doc's own Update Triggers ("Update this file when API routes, auth
    boundaries... change").

## Validation
- `cd api && npm run typecheck && npm run lint && npm test` — new tests cover:
  signup (success, duplicate email), login (success, wrong password, unknown
  email), logout (revokes the session — a reused refresh token after logout is
  rejected), refresh (valid/expired/revoked token), `require-auth` rejecting
  missing/invalid/expired tokens on both `/api/interview` and `/api/user`,
  profile update (name/email/password/avatar, including that a password change
  revokes other sessions), and that `/api/interview` responses are scoped to the
  authenticated user's `org`.
- `cd web && npm test && npx vue-tsc --noEmit && npm run lint` — new tests cover:
  `auth.store` actions (success + error-toast paths), router guard redirects
  (unauthenticated → `/login`, authenticated visiting `/login` → `/`), login/signup
  form validation, settings form submission, avatar upload size rejection, and
  `SettingsMenu` rendering/interaction (open menu, click Logout clears store state).
- Manual/QA pass against `.doc/product-definition.md` acceptance criteria: a fresh
  visitor lands on `/login`, not the home page; after signup they land on home;
  header shows the settings icon and (after uploading one) the round avatar;
  logout returns them to `/login` and a subsequent back-navigation to `/` also
  redirects to `/login` (session actually cleared, not just UI-hidden).

## Risks
- Applying `require-auth` to `/api/interview` is a breaking change to every
  existing interview integration test and to manual `VITE_INTERVIEW_SOURCE=http`
  testing — the backend agent must update `app.spec.ts`/route tests to
  authenticate first, and the frontend agent must ensure the store's HTTP calls
  carry cookies (`credentials: 'include'`) or those flows silently start 401ing.
- No login rate limiting in this pass (see Scope) — a follow-up backlog item
  should add it before any real deployment; flagged here so it isn't forgotten.
- Cookie `SameSite`/`Secure` behavior differs between local http dev and a future
  https deployment; the conditional in Assumptions must not silently regress when
  `NODE_ENV` handling changes elsewhere.

## Rollout Order
1. Backend: schema + repositories + services + middleware + routes + tests (steps
   1–11), landed and green before frontend starts consuming it.
2. Frontend: types + service + store + views + router + header (steps 12–22),
   built against the now-real API (no mock needed — the existing `mock`/`http`
   `InterviewSource` split doesn't apply to auth; there is one implementation).
3. QA pass against acceptance criteria and both test suites.

## Rollback
- Frontend and backend changes are additive (new tables, new routes, new files);
  no destructive migration. If the feature needs to be pulled, revert the
  `feat/authentication` branch's merge commit — `require-auth` is only wired onto
  routes in `app.ts`, so removing that one wiring point (plus the router guard in
  `web/src/router/index.ts`) fully re-opens the pre-auth behavior without a schema
  rollback.
