import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  Answer,
  Evaluation,
  InterviewConfig,
  InterviewSession,
  Question,
  Report
} from '@/types/interview'
import { InterviewError, interviewSource, type InterviewSource } from '@/services/interview.service'
import { fetchInterviewSession } from '@/services/interview-http.service'
import { clearSnapshot, loadSnapshot, saveSnapshot } from '@/services/session-storage.service'
import { recordCompletedInterview } from '@/services/report-history.service'
import { ENCOURAGEMENT_INTERVAL, isSuccessfulGrade } from '@/services/gamification.service'
import { useAuthStore } from '@/stores/auth.store'
import { env } from '@/config/env'

/**
 * `asking`     — a question is on screen waiting for an answer
 * `evaluating` — the answer is with the source
 * `reviewing`  — the evaluation is on screen, waiting for the user to continue
 * `complete`   — no questions left, report is ready
 */
export type InterviewStatus = 'idle' | 'starting' | 'asking' | 'evaluating' | 'reviewing' | 'complete'

function toUserMessage(err: unknown): string {
  if (err instanceof InterviewError) return err.message
  return 'Something failed while running the interview. Please try again.'
}

/**
 * An `UNAUTHENTICATED` that reaches this far already survived the source's
 * refresh-and-retry, so the session is genuinely gone. Clear it, or the header keeps
 * showing an avatar and the user sits on a question they can no longer submit —
 * apparently signed in, unable to proceed. `App.vue` watches that flag and moves them
 * to `/login`. The interview state itself is left alone: it is snapshotted, so
 * signing back in resumes where they were.
 */
function signOutIfSessionExpired(err: unknown) {
  if (err instanceof InterviewError && err.code === 'UNAUTHENTICATED') useAuthStore().expire()
}

/**
 * Re-derives where the user was from the session alone, so a reload doesn't need
 * `currentQuestion`/`currentEvaluation` persisted separately. `asked`/`answers` are
 * always pushed in lockstep (see `submitAnswer`/`loadNextQuestion`), so their lengths
 * alone say whether the last question is still open or already reviewed.
 */
export function deriveSessionState(
  session: InterviewSession,
  report: Report | null
): { status: InterviewStatus; currentQuestion: Question | null; currentEvaluation: Evaluation | null } {
  if (report) return { status: 'complete', currentQuestion: null, currentEvaluation: null }

  const lastQuestion = session.asked[session.asked.length - 1] ?? null
  if (!lastQuestion) return { status: 'idle', currentQuestion: null, currentEvaluation: null }

  if (session.answers.length < session.asked.length) {
    return { status: 'asking', currentQuestion: lastQuestion, currentEvaluation: null }
  }

  const lastEvaluation = session.evaluations[session.evaluations.length - 1] ?? null
  return { status: 'reviewing', currentQuestion: lastQuestion, currentEvaluation: lastEvaluation }
}

export const useInterviewStore = defineStore('interview', () => {
  // The source is swappable so tests can inject a stub and Stage 2 can inject HTTP.
  const source = ref<InterviewSource>(interviewSource)

  const session = ref<InterviewSession | null>(null)
  const currentQuestion = ref<Question | null>(null)
  const currentEvaluation = ref<Evaluation | null>(null)
  const report = ref<Report | null>(null)
  const status = ref<InterviewStatus>('idle')
  const error = ref<string | null>(null)

  /**
   * Successful answers since the last celebration. Internal — not returned from the
   * setup function, and deliberately outside the snapshot watcher below: a refresh
   * mid-interview losing progress toward a decorative popup is inconsequential, and
   * this codebase already treats this class of state as best-effort.
   */
  const successSinceEncouragement = ref(0)

  /**
   * Bumped once per fired celebration. The view watches this counter rather than a
   * boolean so two celebrations in a row each still register as a change. Never reset
   * — it is monotonic, and zeroing it on a new interview would collide with its own
   * starting value and need an extra "is this the first render" guard at the call site.
   */
  const encouragementTrigger = ref(0)

  const hasSession = computed(() => session.value !== null)
  const isBusy = computed(() => status.value === 'starting' || status.value === 'evaluating')

  /** Follow-ups are extra depth on a question already counted, so they do not add to the total. */
  const answeredCount = computed(
    () => session.value?.answers.filter(a => !isFollowUpId(a.questionId)).length ?? 0
  )
  const totalCount = computed(() => session.value?.config.questionCount ?? 0)

  const progress = computed(() => {
    if (totalCount.value === 0) return 0
    return Math.min(100, Math.round((answeredCount.value / totalCount.value) * 100))
  })

  const runningGrade = computed(() => {
    const evaluations = session.value?.evaluations ?? []
    if (evaluations.length === 0) return null
    return Math.round(evaluations.reduce((sum, e) => sum + e.grade, 0) / evaluations.length)
  })

  function isFollowUpId(questionId: string): boolean {
    return session.value?.asked.find(q => q.id === questionId)?.isFollowUp ?? false
  }

  function setSource(next: InterviewSource) {
    source.value = next
  }

  // Keep the last-known session resumable across a refresh. Skipped while there's
  // nothing to save so a fresh app boot doesn't immediately overwrite a snapshot
  // it hasn't rehydrated yet.
  watch(
    [session, report],
    ([nextSession, nextReport]) => {
      if (nextSession) saveSnapshot({ source: env.interviewSource, session: nextSession, report: nextReport })
    },
    { deep: true }
  )

  function reset() {
    session.value = null
    currentQuestion.value = null
    currentEvaluation.value = null
    report.value = null
    status.value = 'idle'
    error.value = null
    successSinceEncouragement.value = 0
    clearSnapshot()
  }

  function applySnapshotState(nextSession: InterviewSession, nextReport: Report | null) {
    session.value = nextSession
    report.value = nextReport
    const derived = deriveSessionState(nextSession, nextReport)
    status.value = derived.status
    currentQuestion.value = derived.currentQuestion
    currentEvaluation.value = derived.currentEvaluation
  }

  /**
   * Resume the last session on app boot, if one was left mid-flight. `http` mode
   * re-fetches the session from the server (the real source of truth — see
   * `.doc/architecture.md`) rather than trusting the local copy; `mock` mode has no
   * server, so the local snapshot is all there is.
   */
  async function rehydrate() {
    const snapshot = loadSnapshot()
    if (!snapshot) return

    if (snapshot.source === 'http') {
      try {
        const fresh = await fetchInterviewSession(env.apiBaseUrl, snapshot.session.id)
        if (!fresh) {
          clearSnapshot()
          return
        }
        applySnapshotState(fresh, snapshot.report)
      } catch {
        // Server unreachable or errored — nothing safe to resume.
        clearSnapshot()
      }
      return
    }

    applySnapshotState(snapshot.session, snapshot.report)
  }

  async function start(config: InterviewConfig) {
    reset()
    status.value = 'starting'

    try {
      session.value = await source.value.startInterview(config)
      await loadNextQuestion()
    } catch (err) {
      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      status.value = 'idle'
      session.value = null
      throw err
    }
  }

  /** Fetch the next question, or finish the interview when the source has none left. */
  async function loadNextQuestion() {
    if (!session.value) return

    const question = await source.value.getNextQuestion(session.value)

    if (!question) {
      await finish()
      return
    }

    session.value.asked.push(question)
    currentQuestion.value = question
    currentEvaluation.value = null
    status.value = 'asking'
  }

  async function submitAnswer(text: string) {
    if (!session.value || !currentQuestion.value) return

    const question = currentQuestion.value
    const answer: Answer = {
      questionId: question.id,
      text,
      submittedAt: new Date().toISOString()
    }

    status.value = 'evaluating'
    error.value = null

    try {
      const evaluation = await source.value.evaluateAnswer(session.value, question, answer)

      session.value.answers.push(answer)
      session.value.evaluations.push(evaluation)
      currentEvaluation.value = evaluation
      status.value = 'reviewing'

      // The one point a fresh grade exists, so the one place the milestone can be counted.
      // Follow-ups are excluded so the celebration cadence tracks the same "answer" the
      // progress bar counts — `answeredCount` already excludes them for the same reason.
      if (!isFollowUpId(question.id) && isSuccessfulGrade(evaluation.grade)) {
        successSinceEncouragement.value++

        if (successSinceEncouragement.value >= ENCOURAGEMENT_INTERVAL) {
          successSinceEncouragement.value = 0
          encouragementTrigger.value++
        }
      }
    } catch (err) {
      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      // Stay on the question so the user can fix and resubmit rather than losing their place.
      status.value = 'asking'
      throw err
    }
  }

  /** Advance from the evaluation to the next question (or the report). */
  async function continueInterview() {
    if (!session.value || status.value !== 'reviewing') return

    error.value = null

    try {
      await loadNextQuestion()
    } catch (err) {
      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      status.value = 'reviewing'
      throw err
    }
  }

  async function finish() {
    if (!session.value) return

    try {
      const built = await source.value.getReport(session.value)

      report.value = built
      // The interview is only "history" once it actually produced a report, which is
      // the same rule `/reports` uses server-side. No-op under `http`: the server
      // already has it durably, so recording it again would only risk a second copy.
      recordCompletedInterview(session.value, built)

      currentQuestion.value = null
      currentEvaluation.value = null
      status.value = 'complete'
    } catch (err) {
      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      throw err
    }
  }

  return {
    session,
    currentQuestion,
    currentEvaluation,
    report,
    status,
    error,
    encouragementTrigger,
    hasSession,
    isBusy,
    answeredCount,
    totalCount,
    progress,
    runningGrade,
    setSource,
    reset,
    rehydrate,
    start,
    submitAnswer,
    continueInterview,
    finish
  }
})
