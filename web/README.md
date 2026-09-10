# Interview Web (Stage 1)

Vue 3 frontend for the AI Interview Simulator. Stage 1 runs entirely in the browser:
there is no backend and no LLM. A deterministic mock behind the `InterviewSource`
contract supplies questions and grades answers, so the whole flow is demoable offline.

Requires Node 18+ (developed on Node 24).

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 44 unit, component, and full-flow tests
npm run lint     # eslint, including the no-trailing-semicolon rule
npm run build    # vue-tsc typecheck + production build
```

## How it fits together

```
SetupView ──> interview.store ──> InterviewSource ──> question-bank
                    │                                  answer-grader
                    ▼
             InterviewView ──> ReportView
```

- `types/interview.ts` — shared domain shapes; Stage 2 reuses them verbatim.
- `services/interview.service.ts` — the `InterviewSource` contract plus the mock.
- `services/answer-grader.ts` — rule-based scoring: keyword coverage 45%, depth 30%,
  reasoning/example/tradeoff signals 25%. Identical input always yields an identical grade.
- `stores/interview.store.ts` — owns the session and the
  `idle → asking → evaluating → reviewing → complete` state machine.

A base answer scoring under 70 earns exactly one follow-up. Follow-ups add depth but do
not count toward the question total, so progress always reads against base questions.

Nothing is persisted: refreshing the page ends the session, and the route guards send you
back to setup rather than showing an empty interview.

## Stage 2

`services/interview-http.service.ts` implements the same `InterviewSource` contract as the
mock, calling the four `api/` REST endpoints and unwrapping their response envelopes
(`{ question }`, `{ evaluation }`). Non-2xx responses and network/timeout failures are both
mapped to `InterviewError` so the store's existing error handling needs no changes.

Which source is live is decided once, at module load, by `VITE_INTERVIEW_SOURCE` (see
`.env.example`): `mock` (default) keeps today's offline demo, `http` calls the real API at
`VITE_API_BASE_URL`. Flipping it back to `mock` with no code changes is the rollback path if
the API is ever unavailable. All LLM calls happen server-side so no API key reaches the bundle.

```bash
cp .env.example .env
# then edit .env: VITE_INTERVIEW_SOURCE=http, VITE_API_BASE_URL=http://localhost:3001
```

## Answering by voice

The answer box carries a microphone next to the word count. Pressing it swaps the row for a
"Listening…" bar with a live partial transcript, a ✗ to throw the turn away, and a ✓ to keep
it. Settled phrases land in the textarea as you speak, so you can mix typing and talking, and
fix anything the transcription got wrong before submitting. Submit is disabled while the mic
is open, so half a spoken sentence can never be sent.

`services/speech.service.ts` defines a `SpeechSource` contract — the same swap-a-source idea
as `InterviewSource` — with a Web Speech API implementation behind it. Only the service knows
about the browser API, so a backend transcription source can replace it without the component
changing. (Anthropic's API takes text, images, and PDFs, not audio, so that path would need a
separate transcription provider.)

**Browser support.** Web Speech is Chrome and Edge only, and needs a secure context
(`localhost` counts). Everywhere else `isSupported()` is false and the mic simply does not
render — the typed flow is untouched.

**Privacy.** In Chrome, recognition is not on-device: audio is sent to Google's servers for
transcription. The listening state says so, and it is worth knowing that this is the one part
of the app where something leaves the browser in `mock` mode.

### Running the backend

The API lives in [`../api`](../api) — a separate Node/Express/TypeScript project with its
own `package.json`. It persists to PostgreSQL and calls Anthropic Claude server-side to
generate questions and grade answers.

Requires a local PostgreSQL instance and an Anthropic API key.

```bash
cd ../api
npm install

cp .env.example .env
# then edit .env and set at minimum:
#   DATABASE_URL=postgres://<user>:<password>@localhost:5432/<database>
#   ANTHROPIC_API_KEY=sk-ant-...

# bootstrap the schema (creates tables + seeds the default org; safe to re-run)
psql "$DATABASE_URL" -f schema.sql

npm run dev      # http://localhost:3001
npm test         # 48 tests — DB and LLM are both mocked, no network/DB needed to test
npm run lint     # eslint, including the no-trailing-semicolon rule
npm run typecheck
npm run build    # tsc -> dist/, then `npm start` runs the compiled server
```

**Re-run `schema.sql` after pulling.** It is idempotent (`create table if not exists`,
`add column if not exists`), so re-running it is always safe, but it only takes effect when
you actually run it — a schema change in a pulled commit does nothing to an existing local
database until `psql "$DATABASE_URL" -f schema.sql` is run again. If an API call starts
returning a database error after a pull, this is the first thing to try. This applies to any
environment: a teammate's machine or a future deploy needs the same re-run, not just the
machine the schema change was written on.

By default the API serves one hardcoded org (`ORG_ID=default` in `.env`) since neither
stage has auth yet, and expects the frontend dev server's origin (`CORS_ORIGIN`, defaults
to `http://localhost:5173`). See [`../api/.env.example`](../api/.env.example) for every
configurable variable, including which Claude model handles question generation vs.
evaluation (`LLM_QUESTION_MODEL` / `LLM_EVAL_MODEL`, both default to `claude-sonnet-5`).

### Running both together

Two terminals, no orchestration tooling:

```bash
# terminal 1
cd api && npm run dev     # http://localhost:3001

# terminal 2
cd web && npm run dev     # http://localhost:5173, VITE_INTERVIEW_SOURCE=http in web/.env
```
