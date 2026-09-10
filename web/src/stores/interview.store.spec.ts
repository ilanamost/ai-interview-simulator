import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { deriveSessionState, useInterviewStore } from './interview.store'
import { InterviewError, type InterviewSource } from '@/services/interview.service'
import { loadSnapshot } from '@/services/session-storage.service'
import { loadHistoryEntries } from '@/services/report-history.service'
import { ENCOURAGEMENT_INTERVAL, SUCCESS_GRADE_THRESHOLD } from '@/services/gamification.service'
import type { Evaluation, InterviewConfig, InterviewSession, Question, Report } from '@/types/interview'

const CONFIG: InterviewConfig = {
  jobTitle: 'frontend',
  level: 'mid',
  type: 'technical',
  questionCount: 2
}

function makeQuestion(id: string, isFollowUp = false): Question {
  return { id, text: `Question ${id}`, topic: 'Topic', isFollowUp, keywords: [] }
}

function makeEvaluation(questionId: string, grade: number, needsFollowUp = false): Evaluation {
  return {
    questionId,
    grade,
    summary: 'Summary',
    strengths: ['Strength'],
    improvements: ['Improvement'],
    needsFollowUp
  }
}

/** Minimal source returning a scripted sequence, so the store is tested in isolation. */
function makeStubSource(options: {
  questions?: (Question | null)[]
  evaluations?: Evaluation[]
  report?: Report
  failOn?: 'start' | 'evaluate' | 'next' | 'report'
}): InterviewSource {
  const questions = [...(options.questions ?? [])]
  const evaluations = [...(options.evaluations ?? [])]

  return {
    async startInterview(config) {
      if (options.failOn === 'start') throw new InterviewError('BOOM', 'Could not start.')
      return {
        id: 'session-1',
        config,
        createdAt: '2026-07-18T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      }
    },
    async getNextQuestion() {
      if (options.failOn === 'next') throw new InterviewError('BOOM', 'Could not load.')
      return questions.length ? (questions.shift() as Question | null) : null
    },
    async evaluateAnswer(_session, question) {
      if (options.failOn === 'evaluate') throw new InterviewError('BOOM', 'Could not evaluate.')
      return evaluations.shift() ?? makeEvaluation(question.id, 80)
    },
    async getReport() {
      if (options.failOn === 'report') throw new InterviewError('BOOM', 'Could not report.')
      return (
        options.report ?? {
          overallGrade: 80,
          headline: 'Headline',
          strengths: [],
          improvements: [],
          entries: []
        }
      )
    }
  }
}

describe('interview store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts idle with nothing loaded', () => {
    const store = useInterviewStore()

    expect(store.status).toBe('idle')
    expect(store.hasSession).toBe(false)
    expect(store.report).toBeNull()
  })

  it('moves to asking with the first question after start', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))

    await store.start(CONFIG)

    expect(store.status).toBe('asking')
    expect(store.currentQuestion?.id).toBe('q1')
    expect(store.hasSession).toBe(true)
  })

  it('moves to reviewing and records the answer after a submit', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource({
        questions: [makeQuestion('q1')],
        evaluations: [makeEvaluation('q1', 75)]
      })
    )
    await store.start(CONFIG)

    await store.submitAnswer('My answer')

    expect(store.status).toBe('reviewing')
    expect(store.currentEvaluation?.grade).toBe(75)
    expect(store.session?.answers).toHaveLength(1)
  })

  it('advances to the next question on continue', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1'), makeQuestion('q2')] }))
    await store.start(CONFIG)
    await store.submitAnswer('My answer')

    await store.continueInterview()

    expect(store.status).toBe('asking')
    expect(store.currentQuestion?.id).toBe('q2')
    expect(store.currentEvaluation).toBeNull()
  })

  it('completes and builds a report when no questions remain', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
    await store.start(CONFIG)
    await store.submitAnswer('My answer')

    await store.continueInterview()

    expect(store.status).toBe('complete')
    expect(store.report?.overallGrade).toBe(80)
    expect(store.currentQuestion).toBeNull()
  })

  it('excludes follow-ups from the answered count', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource({
        questions: [makeQuestion('q1'), makeQuestion('q1-f', true)],
        evaluations: [makeEvaluation('q1', 40, true), makeEvaluation('q1-f', 60)]
      })
    )
    await store.start(CONFIG)
    await store.submitAnswer('Weak answer')
    await store.continueInterview()
    await store.submitAnswer('Follow-up answer')

    expect(store.currentQuestion?.isFollowUp).toBe(true)
    expect(store.answeredCount).toBe(1)
    expect(store.session?.answers).toHaveLength(2)
  })

  it('reports progress as a percentage of base questions', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1'), makeQuestion('q2')] }))
    await store.start(CONFIG)

    expect(store.progress).toBe(0)
    await store.submitAnswer('My answer')
    expect(store.progress).toBe(50)
  })

  it('averages evaluations into a running grade', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource({
        questions: [makeQuestion('q1'), makeQuestion('q2')],
        evaluations: [makeEvaluation('q1', 60), makeEvaluation('q2', 80)]
      })
    )
    await store.start(CONFIG)
    await store.submitAnswer('First')
    await store.continueInterview()
    await store.submitAnswer('Second')

    expect(store.runningGrade).toBe(70)
  })

  it('surfaces a user-safe message and stays idle when starting fails', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ failOn: 'start' }))

    await expect(store.start(CONFIG)).rejects.toBeInstanceOf(InterviewError)

    expect(store.status).toBe('idle')
    expect(store.hasSession).toBe(false)
    expect(store.error).toBe('Could not start.')
  })

  it('keeps the user on the question when evaluation fails', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')], failOn: 'evaluate' }))
    await store.start(CONFIG)

    await expect(store.submitAnswer('My answer')).rejects.toBeInstanceOf(InterviewError)

    expect(store.status).toBe('asking')
    expect(store.currentQuestion?.id).toBe('q1')
    expect(store.session?.answers).toHaveLength(0)
    expect(store.error).toBe('Could not evaluate.')
  })

  it('clears everything on reset', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
    await store.start(CONFIG)

    store.reset()

    expect(store.status).toBe('idle')
    expect(store.session).toBeNull()
    expect(store.currentQuestion).toBeNull()
  })

  it('persists the session to storage as it progresses, and clears it on reset', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource({ questions: [makeQuestion('q1')], evaluations: [makeEvaluation('q1', 75)] })
    )

    await store.start(CONFIG)
    expect(loadSnapshot()?.session.asked).toHaveLength(1)

    await store.submitAnswer('My answer')
    expect(loadSnapshot()?.session.answers).toHaveLength(1)

    store.reset()
    expect(loadSnapshot()).toBeNull()
  })

  describe('recording a finished interview into the reports history', () => {
    it('records the interview once its report is built', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
      await store.start(CONFIG)
      await store.submitAnswer('My answer')

      await store.continueInterview()

      const entries = loadHistoryEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].session.id).toBe('session-1')
      expect(entries[0].report.overallGrade).toBe(80)
    })

    it('records nothing while the interview is still in progress', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1'), makeQuestion('q2')] }))
      await store.start(CONFIG)
      await store.submitAnswer('My answer')

      expect(loadHistoryEntries()).toHaveLength(0)
    })

    it('records nothing when the report itself could not be built', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')], failOn: 'report' }))
      await store.start(CONFIG)
      await store.submitAnswer('My answer')

      await expect(store.continueInterview()).rejects.toBeInstanceOf(InterviewError)

      expect(loadHistoryEntries()).toHaveLength(0)
    })

    /** Starting over clears the resumable snapshot — it must not clear the history too. */
    it('keeps the recorded interview after the store is reset', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
      await store.start(CONFIG)
      await store.submitAnswer('My answer')
      await store.continueInterview()

      store.reset()

      expect(loadHistoryEntries()).toHaveLength(1)
    })
  })

  /**
   * The popup is meant to read as a milestone, so what matters is that it fires on the
   * interval and only counts answers the user actually did well on.
   */
  describe('encouragement milestones', () => {
    const GOOD = 85
    const WEAK = 40

    /** Enough questions and evaluations to answer `grades` in a row without follow-ups. */
    function makeRun(grades: number[]) {
      return makeStubSource({
        questions: grades.map((_, i) => makeQuestion(`q${i + 1}`)),
        evaluations: grades.map((grade, i) => makeEvaluation(`q${i + 1}`, grade))
      })
    }

    async function answerAll(store: ReturnType<typeof useInterviewStore>, count: number) {
      for (let i = 0; i < count; i++) {
        await store.submitAnswer(`Answer ${i + 1}`)
        if (i < count - 1) await store.continueInterview()
      }
    }

    it('stays quiet until the interval is reached', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun([GOOD, GOOD]))
      await store.start(CONFIG)

      await answerAll(store, ENCOURAGEMENT_INTERVAL - 1)

      expect(store.encouragementTrigger).toBe(0)
    })

    it('fires once on the interval-th successful answer', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun(Array(ENCOURAGEMENT_INTERVAL).fill(GOOD)))
      await store.start(CONFIG)

      await answerAll(store, ENCOURAGEMENT_INTERVAL)

      expect(store.encouragementTrigger).toBe(1)
    })

    it('fires again after another full interval of successful answers', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun(Array(ENCOURAGEMENT_INTERVAL * 2).fill(GOOD)))
      await store.start(CONFIG)

      await answerAll(store, ENCOURAGEMENT_INTERVAL * 2)

      expect(store.encouragementTrigger).toBe(2)
    })

    it('never fires on a run of unsuccessful answers', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun(Array(ENCOURAGEMENT_INTERVAL * 2).fill(WEAK)))
      await store.start(CONFIG)

      await answerAll(store, ENCOURAGEMENT_INTERVAL * 2)

      expect(store.encouragementTrigger).toBe(0)
    })

    /** A weak answer between two good ones must not itself count toward the milestone. */
    it('counts only the successful answers toward the interval', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun([GOOD, WEAK, GOOD]))
      await store.start(CONFIG)

      await store.submitAnswer('Strong')
      expect(store.encouragementTrigger).toBe(1)

      await store.continueInterview()
      await store.submitAnswer('Weak')
      expect(store.encouragementTrigger).toBe(1) // unchanged by the weak answer

      await store.continueInterview()
      await store.submitAnswer('Strong again')

      expect(store.encouragementTrigger).toBe(2)
    })

    it('treats the grade threshold itself as a successful answer', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun(Array(ENCOURAGEMENT_INTERVAL).fill(SUCCESS_GRADE_THRESHOLD)))
      await store.start(CONFIG)

      await answerAll(store, ENCOURAGEMENT_INTERVAL)

      expect(store.encouragementTrigger).toBe(1)
    })

    it('does not let a reset interview leak state into the next one', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun([GOOD]))
      await store.start(CONFIG)
      await store.submitAnswer('Strong')
      expect(store.encouragementTrigger).toBe(1)

      store.reset()
      store.setSource(makeRun([GOOD]))
      await store.start(CONFIG)
      await store.submitAnswer('Strong')

      // A fresh interview's first successful answer earns its own milestone too.
      expect(store.encouragementTrigger).toBe(2)
    })

    /** Monotonic on purpose: the view watches it for changes, not for an absolute count. */
    it('keeps the counter monotonic across a reset so the view still sees a change', async () => {
      const store = useInterviewStore()
      store.setSource(makeRun(Array(ENCOURAGEMENT_INTERVAL).fill(GOOD)))
      await store.start(CONFIG)
      await answerAll(store, ENCOURAGEMENT_INTERVAL)

      store.reset()

      expect(store.encouragementTrigger).toBe(1)
    })

    it('does not fire when the evaluation itself failed', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')], failOn: 'evaluate' }))
      await store.start(CONFIG)

      await expect(store.submitAnswer('Strong')).rejects.toBeInstanceOf(InterviewError)

      expect(store.encouragementTrigger).toBe(0)
    })
  })

  it('resumes a mid-question session from storage without a network call', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
    await store.start(CONFIG)

    // Simulate a refresh: a brand new store instance, same storage.
    setActivePinia(createPinia())
    const resumed = useInterviewStore()
    await resumed.rehydrate()

    expect(resumed.status).toBe('asking')
    expect(resumed.currentQuestion?.id).toBe('q1')
    expect(resumed.hasSession).toBe(true)
  })

  it('resumes a reviewing session from storage with its last evaluation', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource({ questions: [makeQuestion('q1')], evaluations: [makeEvaluation('q1', 75)] })
    )
    await store.start(CONFIG)
    await store.submitAnswer('My answer')

    setActivePinia(createPinia())
    const resumed = useInterviewStore()
    await resumed.rehydrate()

    expect(resumed.status).toBe('reviewing')
    expect(resumed.currentEvaluation?.grade).toBe(75)
  })

  it('resumes a completed session straight to its report', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
    await store.start(CONFIG)
    await store.submitAnswer('My answer')
    await store.continueInterview()

    setActivePinia(createPinia())
    const resumed = useInterviewStore()
    await resumed.rehydrate()

    expect(resumed.status).toBe('complete')
    expect(resumed.report?.overallGrade).toBe(80)
  })

  it('does nothing on rehydrate when nothing was persisted', async () => {
    const store = useInterviewStore()

    await store.rehydrate()

    expect(store.status).toBe('idle')
    expect(store.hasSession).toBe(false)
  })

  describe('rehydrating an http-sourced session', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset()
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('re-fetches the session from the server rather than trusting the local copy', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
      await store.start(CONFIG)
      // Overwrite the auto-saved mock snapshot to look like it came from the http source.
      const { saveSnapshot } = await import('@/services/session-storage.service')
      saveSnapshot({ source: 'http', session: store.session!, report: null })

      const serverSession = {
        ...store.session!,
        answers: [{ questionId: 'q1', text: 'answer', submittedAt: '2026-07-28T10:01:00.000Z' }],
        evaluations: [makeEvaluation('q1', 70)]
      }
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => serverSession })

      setActivePinia(createPinia())
      const resumed = useInterviewStore()
      await resumed.rehydrate()

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/interview/${store.session!.id}`),
        expect.anything()
      )
      expect(resumed.status).toBe('reviewing')
      expect(resumed.currentEvaluation?.grade).toBe(70)
    })

    it('clears the snapshot and resumes to nothing when the server no longer has the interview', async () => {
      const store = useInterviewStore()
      store.setSource(makeStubSource({ questions: [makeQuestion('q1')] }))
      await store.start(CONFIG)
      const { saveSnapshot, loadSnapshot: reload } = await import('@/services/session-storage.service')
      saveSnapshot({ source: 'http', session: store.session!, report: null })

      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'NOT_FOUND', message: 'Gone.' } })
      })

      setActivePinia(createPinia())
      const resumed = useInterviewStore()
      await resumed.rehydrate()

      expect(resumed.hasSession).toBe(false)
      expect(reload()).toBeNull()
    })
  })
})

describe('deriveSessionState', () => {
  const baseSession: InterviewSession = {
    id: 's1',
    config: CONFIG,
    createdAt: '2026-07-28T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: []
  }

  it('reports idle when nothing has been asked yet', () => {
    const result = deriveSessionState(baseSession, null)

    expect(result).toEqual({ status: 'idle', currentQuestion: null, currentEvaluation: null })
  })

  it('reports asking when the last question has no answer yet', () => {
    const session = { ...baseSession, asked: [makeQuestion('q1')] }

    const result = deriveSessionState(session, null)

    expect(result.status).toBe('asking')
    expect(result.currentQuestion?.id).toBe('q1')
    expect(result.currentEvaluation).toBeNull()
  })

  it('reports reviewing when the last question has been answered', () => {
    const session = {
      ...baseSession,
      asked: [makeQuestion('q1')],
      answers: [{ questionId: 'q1', text: 'answer', submittedAt: '2026-07-28T10:01:00.000Z' }],
      evaluations: [makeEvaluation('q1', 90)]
    }

    const result = deriveSessionState(session, null)

    expect(result.status).toBe('reviewing')
    expect(result.currentQuestion?.id).toBe('q1')
    expect(result.currentEvaluation?.grade).toBe(90)
  })

  it('reports complete whenever a report is present, regardless of session shape', () => {
    const report: Report = {
      overallGrade: 88,
      headline: 'Headline',
      strengths: [],
      improvements: [],
      entries: []
    }

    const result = deriveSessionState(baseSession, report)

    expect(result).toEqual({ status: 'complete', currentQuestion: null, currentEvaluation: null })
  })
})
