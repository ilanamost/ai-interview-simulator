# Voice Answers and Model Selection

Status: active
Owner: Ilana
Last updated: 2026-07-28

> **Progress.** Both parts implemented; all eight Open Questions went with their recommended
> answers. Part A shipped on `feat/model-selection` (committed); Part B is on `feat/voice-input`,
> cut from it. Automated validation passes: `api` 55 tests, `web` 89 tests, lint clean in both,
> `vue-tsc --noEmit` + production build clean.
>
> Three deviations from the steps as written:
> - **Step 9 (ambient types) was not needed.** The Web Speech surface is declared as ordinary
>   module-scoped interfaces inside `speech.service.ts` instead — no `.d.ts`, no global
>   declarations, no new `@types` package, and the fake used in tests type-checks against the
>   same exported interfaces.
> - **`api/.env.example` could not be updated** — `api/.gitignore:5` ignores it, so it is not
>   in the repo. The "env models are now fallbacks" note went into [.doc/architecture.md](../.doc/architecture.md)
>   instead. Worth deciding separately whether that gitignore line is intentional; `web/README.md`
>   links to the file as if it exists.
> - **Step 11's per-question cleanup** is done by keying `VoiceInput` on `questionId` rather than
>   by extending the existing `watch` — the remount runs the component's own `onBeforeUnmount`
>   abort, so there is one cleanup path instead of two.
>
> **Post-merge fix (2026-07-28, live smoke test against real Postgres + real Anthropic key).**
> Selecting `claude-haiku-4-5` broke every LLM call: `output_config.effort` is unconditionally
> set in `anthropic-llm.adapter.ts`, but Haiku 4.5 rejects that parameter outright (`400
> invalid_request_error: "This model does not support the effort parameter."`), which the
> adapter's `callModel` wrapper turns into a generic `502 UPSTREAM_UNAVAILABLE` — so the
> underlying cause was invisible from the client, only visible in the server log. Fixed with an
> `outputConfig(model, schema, effort)` helper that omits `effort` for `claude-haiku-4-5` and
> keeps it for `claude-opus-5` / `claude-sonnet-5`. 3 regression tests added (58 api tests total).
> Also required a manual schema migration on the pre-existing local Postgres — `schema.sql`'s
> `alter table ... add column if not exists model` only takes effect when the script is re-run;
> confirmed via a one-off script and cleaned up after.
>
> Live end-to-end verified for `claude-sonnet-5` and `claude-haiku-4-5` (create → question →
> answer → report → get, all correct statuses); Opus intentionally skipped to avoid spend, at
> the user's direction. Remaining manual checks: Chrome voice-input walkthrough, mic-denied
> path, Firefox mic-absence check.

## Goal
- Let the candidate answer by speaking as well as typing: a microphone control on the answer box that transcribes speech into the answer textarea, looking and behaving like the mic in the Claude Code composer (idle mic icon → "Listening…" state with a live waveform, cancel, and confirm).
- Let the user choose which Claude model runs the interview, instead of the model being fixed by `LLM_QUESTION_MODEL` / `LLM_EVAL_MODEL` on the server.

## Scope
### In scope
- **Voice input (frontend only).** A `SpeechSource` contract in `web/src/services/speech.service.ts` with a Web Speech API implementation, a `VoiceInput` component, and its wiring into [web/src/cmps/AnswerInput.vue](web/src/cmps/AnswerInput.vue).
- **Model selection (full stack).** A `model` field on `InterviewConfig`, a select on [web/src/views/SetupView.vue](web/src/views/SetupView.vue), zod allowlist validation on the API, a `model` column on `interview`, and per-interview model use in [api/src/services/llm/anthropic-llm.adapter.ts](api/src/services/llm/anthropic-llm.adapter.ts).
- Tests for both, per [.rule/testing-rules.md](.rule/testing-rules.md): happy path and failure path.
- Docs: [.doc/glossary.md](.doc/glossary.md) (new terms), [.doc/architecture.md](.doc/architecture.md), `web/README.md` (browser support + the privacy note below), `api/.env.example` (env models become fallbacks).

### Out of scope
- The **voice mode** control (the second, waveform icon in the reference screenshots). Only the microphone is in scope — explicitly excluded by the request.
- Server-side audio transcription. Anthropic's Messages API accepts text, images, and PDFs — **not audio** — so Claude cannot transcribe; a backend path would need a separate STT provider and key. Deferred, but the `SpeechSource` interface is shaped so it can be added without touching the component (Open Question 1).
- Text-to-speech (the interviewer reading questions aloud).
- Per-question model switching mid-interview. The model is chosen once, at setup, and is fixed for the interview.
- Separate question vs. evaluation models in the UI. One choice drives both; the two env vars stay as server-side fallbacks.
- Changing the mock source's behaviour — `mockInterviewSource` has no LLM, so it records the chosen model and otherwise ignores it.

## Assumptions
- Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) covers Chrome and Edge. Firefox and older Safari do not support it; the mic control is hidden there via feature detection rather than showing a broken button.
- The API requires a secure context. `http://localhost:5173` counts as secure, so local dev is unaffected; any non-localhost HTTP deployment would silently lose the feature.
- In Chrome, recognition is **not** on-device — audio is sent to Google's servers for transcription. This contradicts the spirit of the existing "Nothing you paste leaves your browser" hint on the setup form, so the UI must disclose it (Step 3).
- `web/` already depends on `lucide-vue-next` ([.rule/ui-rules.md](.rule/ui-rules.md)); `Mic`, `Check`, and `X` come from there. The listening waveform is CSS, not an icon.
- TypeScript's bundled `lib.dom` may not declare `SpeechRecognition` for `typescript ~5.6`. If `vue-tsc` complains, a minimal ambient declaration file is added rather than pulling in a new `@types` package.
- Model IDs and pricing verified against the current Claude model catalogue on 2026-07-28: `claude-opus-5` ($5/$25 per MTok), `claude-sonnet-5` ($3/$15, introductory $2/$10 through 2026-08-31), `claude-haiku-4-5` ($1/$5). These are exact IDs — never append a date suffix.
- Response shapes stay 1:1 between [web/src/types/interview.ts](web/src/types/interview.ts) and [api/src/types/interview.ts](api/src/types/interview.ts), as [002-2026-07-26-interview-integration.md](002-2026-07-26-interview-integration.md) assumed. `model` is added to both.

## Open Questions
> Please answer inline (edit after each `A:`). A recommended answer is pre-filled; unanswered questions proceed with the recommendation.

1. **Ship voice input behind a swappable `SpeechSource` interface, or call the Web Speech API directly from the component?**
   - Recommended: the interface, mirroring `InterviewSource` in [web/src/services/interview.service.ts](web/src/services/interview.service.ts). It costs ~15 extra lines now, lets tests inject a stub instead of monkey-patching `window`, and makes a future backend-transcription source a one-line swap. This matches the answer already given ("Web Speech now, backend later").
   - A: _(unanswered — proceeding with recommended default)_
2. **Where exactly does the mic sit?**
   - Recommended: in the answer card's existing meta footer row — mic on the left, word count and the Ctrl+Enter hint on the right — directly under the textarea, matching the reference screenshots. The request said "on top of the Your answer box"; if that meant *above the card*, say so and it moves.
   - A: _(unanswered — proceeding with recommended default)_
3. **While listening, should the submit button stay live?**
   - Recommended: no — disable submit until listening ends, so a half-captured sentence can't be submitted. The ✓ button is the way out, exactly as in the reference UI.
   - A: _(unanswered — proceeding with recommended default)_
4. **What does the ✗ (cancel) button do to text captured during this listening turn?**
   - Recommended: discard it and restore the textarea to its pre-listening snapshot. Anything already typed by hand before the mic was pressed survives. ✓ keeps everything.
   - A: _(unanswered — proceeding with recommended default)_
5. **Surface the chosen model anywhere after setup (interview header, report, PDF)?**
   - Recommended: no, not in this workstream. The value is persisted, so it can be surfaced later without a migration, and leaving it out keeps [web/src/services/report-pdf.service.ts](web/src/services/report-pdf.service.ts) and its spec untouched.
   - A: _(unanswered — proceeding with recommended default)_
6. **Is `model` required or optional on `InterviewConfig`?**
   - Recommended: optional (`model?: LlmModel`), defaulted server-side to `claude-sonnet-5`. Keeps every existing spec, the mock source, and already-persisted `interview` rows valid, and keeps the API usable by a client that doesn't send it.
   - A: _(unanswered — proceeding with recommended default)_
7. **One branch or two?**
   - Recommended: two, per [.rule/versioning-rules.md](.rule/versioning-rules.md) ("one plan or workstream per branch"). `feat/model-selection` first (it touches api, schema, and web), then `feat/voice-input` (web only). They share no files except `web/src/cmps/AnswerInput.vue`'s footer row and the docs.
   - A: _(unanswered — proceeding with recommended default)_
8. **What do both branches cut from?**
   - Recommended: `feat/interview-integration`, since `master` still lacks Stage 2 and Stage 3. Flagged as a rebase risk below rather than blocking on the merge.
   - A: _(unanswered — proceeding with recommended default)_

## Steps

### Part A — Model selection

1. **Shared types.** Add to both [web/src/types/interview.ts](web/src/types/interview.ts) and [api/src/types/interview.ts](api/src/types/interview.ts), keeping them mirrored:
   ```ts
   export const LLM_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const
   export type LlmModel = (typeof LLM_MODELS)[number]
   export const DEFAULT_LLM_MODEL: LlmModel = 'claude-sonnet-5'
   ```
   and `model?: LlmModel` to `InterviewConfig` in both files, documented as "which Claude model generates questions and grades answers; falls back to the server default when unset."

2. **Labels.** Add `LLM_MODEL_LABEL` to [web/src/services/label.service.ts](web/src/services/label.service.ts) — `Opus 5 — most capable`, `Sonnet 5 — balanced (default)`, `Haiku 4.5 — fastest`. Wording lives with the other labels, not in the type file.

3. **Setup UI.** Add a fifth `.field` to the `.field-grid` in [web/src/views/SetupView.vue](web/src/views/SetupView.vue), bound to `config.model`, initialised to `DEFAULT_LLM_MODEL`. No new CSS — `field-grid` already auto-fits at `minmax(13rem, 1fr)`.

4. **Persistence.** In [api/schema.sql](api/schema.sql), `alter table interview add column if not exists model text;` — idempotent, additive, and nullable so existing rows stay valid ([.rule/database-rules.md](.rule/database-rules.md)). In [api/src/repositories/interview.repository.ts](api/src/repositories/interview.repository.ts): add `model` to `InterviewRow`, to both `select` lists, and to the `insert`; map `row.model ?? undefined` in `toConfig`.

5. **Validation.** In [api/src/routes/interview.routes.ts](api/src/routes/interview.routes.ts), add `model: z.enum(LLM_MODELS).optional()` to `createInterviewSchema`. The schema is `.strict()`, so an unknown model is a 400 validation error rather than a string forwarded to the provider — this is the security boundary; never pass a client-supplied model string through unvalidated.

6. **Use the model per interview.** `InterviewConfig` is already passed into every `LlmAdapter` input as `input.config`, so **no adapter interface change is needed**. In [api/src/services/llm/anthropic-llm.adapter.ts](api/src/services/llm/anthropic-llm.adapter.ts), replace `model: options.questionModel` with `model: input.config.model ?? options.questionModel` in `generateBaseQuestion` and `generateFollowUp`, and `options.evalModel` likewise in `evaluateAnswer`. `LLM_QUESTION_MODEL` / `LLM_EVAL_MODEL` keep their meaning as the fallback when the interview has no model.

7. **Tests (Part A).**
   - [api/src/repositories/interview.repository.spec.ts](api/src/repositories/interview.repository.spec.ts): `model` round-trips through create/get; a null column maps to `undefined`.
   - [api/src/services/llm/anthropic-llm.adapter.spec.ts](api/src/services/llm/anthropic-llm.adapter.spec.ts): a config carrying `claude-opus-5` reaches `client.messages.parse` as `model`; a config with no model falls back to the configured env default.
   - Route validation: `POST /api/interview` with `model: 'gpt-4'` → 400 with the documented `error.code` shape; with a valid model → 201.
   - [web/src/views/interview-flow.spec.ts](web/src/views/interview-flow.spec.ts) or a SetupView spec: the select defaults to `claude-sonnet-5` and the chosen value reaches `store.start`.

### Part B — Voice input

8. **Speech service** — new `web/src/services/speech.service.ts`:
   ```ts
   export interface SpeechHandlers {
     onTranscript(text: string, isFinal: boolean): void
     onError(error: SpeechError): void
     onEnd(): void
   }
   export interface SpeechSession { stop(): void; abort(): void }
   export interface SpeechSource {
     isSupported(): boolean
     start(handlers: SpeechHandlers): SpeechSession
   }
   export class SpeechError extends Error { constructor(readonly code: string, message: string) }
   export function createWebSpeechSource(lang?: string): SpeechSource
   export const speechSource: SpeechSource = createWebSpeechSource()
   ```
   The Web Speech implementation sets `continuous = true` and `interimResults = true` so partial text appears while speaking, and maps raw browser error codes to user-safe `SpeechError`s ([.rule/error-handling-rules.md](.rule/error-handling-rules.md): typed code + actionable message, no raw provider detail):

   | Browser error | `code` | Message |
   | --- | --- | --- |
   | unsupported | `NOT_SUPPORTED` | Voice input is not available in this browser. Type your answer instead. |
   | `not-allowed`, `service-not-allowed` | `MIC_DENIED` | Microphone access was blocked. Allow it in your browser settings to answer by voice. |
   | `no-speech` | `NO_SPEECH` | We did not hear anything. Try again, closer to the mic. |
   | `audio-capture` | `NO_MIC` | No microphone was found. Check your device and try again. |
   | `network` | `SPEECH_NETWORK` | Speech transcription is unreachable right now. Type your answer instead. |
   | `aborted` | `ABORTED` | *(swallowed — user-initiated cancel is not an error)* |

   The source is not stateless in the way `InterviewSource` is — a live `SpeechRecognition` is inherently stateful — so it hands the caller an explicit `SpeechSession` handle and holds no module-level state itself. Document that deviation from [.rule/coding-rules.md](.rule/coding-rules.md) in the file header.

9. **Ambient types.** If `vue-tsc` does not resolve `SpeechRecognition`, add `web/src/types/speech-recognition.d.ts` with the minimal surface used (`SpeechRecognition`, `SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent`, and the `window.webkitSpeechRecognition` fallback). No new dependency.

10. **`VoiceInput` component** — new `web/src/cmps/VoiceInput.vue`:
    - Props: `disabled: boolean`, `source?: SpeechSource` (defaults to `speechSource`, so tests inject a stub without mocking modules — the same pattern the store uses for `InterviewSource`).
    - Emits: `transcript: [text: string]` on each final chunk, `commit: []` on ✓, `cancel: []` on ✗.
    - Renders nothing when `source.isSupported()` is false.
    - **Idle:** a `btn btn-ghost` mic button, `aria-label="Answer by voice"`, disabled while the parent is busy.
    - **Listening:** the row swaps to `Listening…`, a CSS-animated dot/bar waveform, an ✗ (cancel) and a ✓ (confirm) button — the layout in the reference screenshots. `aria-live="polite"` announces the state change.
    - Errors surface via `toast.error(err.message)` ([.rule/ui-rules.md](.rule/ui-rules.md)) and return to idle.
    - Cleans up on `onBeforeUnmount` — an abandoned `SpeechRecognition` keeps the mic indicator lit otherwise.

11. **Wire into the answer box.** In [web/src/cmps/AnswerInput.vue](web/src/cmps/AnswerInput.vue), place `VoiceInput` at the left of the existing `.meta` row. On `transcript`, append to `text` with a single space separator so typed and spoken text mix cleanly. Snapshot `text` when listening starts; on `cancel`, restore the snapshot (Open Question 4). While listening, `canSubmit` is false (Open Question 3). Refocus the textarea after ✓ so the user can keep typing. The existing `watch` on `questionId` must also stop any live session when the next question arrives.

12. **Styling.** New `web/src/styles/cmps/voice.css`, imported from `web/src/styles/cmps/index.css`, using existing tokens from `web/src/styles/setup/variables.css` (`--clr-accent`, `--sp-*`, `--radius-md`, `--transition`) — no hardcoded colours ([.rule/style-rules.md](.rule/style-rules.md)). The waveform animation respects `@media (prefers-reduced-motion: reduce)` by holding the bars static.

13. **Privacy disclosure.** A one-line hint under the answer box while listening: *"Your speech is transcribed by your browser, which may send audio to its provider."* This is required — [web/src/views/SetupView.vue](web/src/views/SetupView.vue) currently promises "Nothing you paste leaves your browser", and in Chrome, audio does.

14. **Tests (Part B).**
    - `web/src/services/speech.service.spec.ts`: `isSupported()` false when `window.SpeechRecognition` is absent (jsdom's default); with a fake recognition class installed — interim vs. final results map correctly, each browser error code maps to the right `SpeechError.code`, and `abort()` does not surface an error.
    - `web/src/cmps/VoiceInput.spec.ts`: renders nothing when unsupported; mic click enters the listening state; ✓ emits `commit` and stops the session; ✗ emits `cancel` and aborts; the mic is disabled while `disabled` is true.
    - [web/src/cmps/AnswerInput.spec.ts](web/src/cmps/AnswerInput.spec.ts): a transcript appends to already-typed text; cancel restores the pre-listening text; submit is blocked while listening. All six existing tests must still pass unchanged.

### Docs (both parts)

15. Add `model`, `SpeechSource`, and `transcript` to [.doc/glossary.md](.doc/glossary.md) before broad usage; note the model choice and the browser-transcription hop in [.doc/architecture.md](.doc/architecture.md); document browser support, the mic permission, and the privacy note in `web/README.md`; note in `api/.env.example` that `LLM_QUESTION_MODEL` / `LLM_EVAL_MODEL` are now fallbacks for interviews that specify no model.

## Validation
- `npm run test` and `npm run lint` pass in both `web/` and `api/`, with no existing spec modified except the intentional additions in Step 14.
- `npm run build` (`vue-tsc --noEmit`) passes in `web/` — this is what catches a missing `SpeechRecognition` declaration.
- Manual, Chrome: start an interview with each of the three models; speak an answer; confirm live interim text, that ✓ keeps it and ✗ discards it, that mixing typing and speech works, and that the answer submits and grades normally.
- Manual, permission denied: block the mic at the browser prompt and confirm a toast with the `MIC_DENIED` message, not a console error or a stuck listening state.
- Manual, Firefox: confirm the mic control is absent and the answer box is otherwise unchanged.
- DB: after a run, `select model from interview order by created_at desc limit 1` matches what was chosen at setup, and an interview created without a model still runs on the env default.
- With `VITE_INTERVIEW_SOURCE=mock`, setup still completes end to end — the model select is inert but harmless.

## Risks
- **Browser coverage.** Web Speech is Chrome/Edge only. Mitigated by feature detection (hide, don't break), but Firefox and some Safari users simply have no voice input until a backend source lands.
- **Privacy.** Chrome ships audio to Google for transcription. Mitigated by the Step 13 disclosure; it is a genuine behaviour change for an app that currently makes a "nothing leaves your browser" claim.
- **Transcription accuracy on technical vocabulary.** Interview answers are full of jargon ("idempotent", "CQRS", "n+1") that general-purpose recognition mangles. The transcript lands in an editable textarea precisely so the user can fix it before submitting — do not auto-submit on ✓.
- **LLM spend.** Opus 5 is 5× Haiku 4.5 per token, and every question and every evaluation is a live call, so a 5-question interview on Opus is a real cost multiple. The label wording flags the tradeoff; there is no per-user budget cap in this plan.
- **Model allowlist drift.** `LLM_MODELS` is duplicated across `web/` and `api/` (as the existing enums already are). A model retired upstream keeps validating locally and fails at the provider as a 502 via `AppError.upstreamUnavailable`. Accepted — the alternative is a shared package, which is out of proportion here.
- **Stateful service.** `SpeechSource` is the first service in the codebase that owns a live browser object. The `SpeechSession` handle keeps the caller in control, but a component that forgets `onBeforeUnmount` cleanup leaves the mic hot — hence the explicit test.
- **Rebase.** Both branches cut from `feat/interview-integration`, which is not on `master` (Open Question 8). If it merges with changes, both need a rebase before review.

## Rollout Order
1. Branch `feat/model-selection` from `feat/interview-integration`; implement Steps 1–7; bootstrap the `alter table` against the local Postgres before running the API.
2. Verify Part A end to end (all three models, plus the no-model fallback), then request review.
3. Branch `feat/voice-input` from the same base; implement Steps 8–14.
4. Verify Part B in Chrome and in Firefox, then request review.
5. Update the docs (Step 15) on whichever branch merges second, so the glossary and architecture notes land together.

## Rollback
- **Voice input** is additive and frontend-only: reverting `feat/voice-input` removes `speech.service.ts`, `VoiceInput.vue`, `voice.css`, and the footer-row wiring, and leaves the typed-answer flow exactly as it is today. Nothing persists, so there is no data to unwind.
- **Model selection** reverts in two pieces: reverting the branch restores the env-driven model, and the `interview.model` column can be left in place — it is nullable and additive, so an older build ignores it. Drop it only if the column must go; `toConfig` tolerates null either way.
- Neither feature touches the Pinia store's public surface or the `InterviewSource` contract, so [web/src/stores/interview.store.ts](web/src/stores/interview.store.ts) and the views' data flow are unaffected by either rollback.
