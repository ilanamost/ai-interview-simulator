import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useInterviewStore } from '@/stores/interview.store'
import { InterviewError, type InterviewSource } from '@/services/interview.service'
import type { Evaluation, InterviewSession, Question, Report } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'
import { stubMatchMedia } from '@/test/theme-fixture'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

// The header's theme toggle asks the browser for the system color scheme, which jsdom
// does not implement — stub it before anything mounts `App`.
beforeEach(() => {
  stubMatchMedia()
})

/**
 * QA adversarial pass for plan 009. `auth.store.ts`'s `expire()` lost its own
 * `toast.error` in this branch and the plan never named a new home for it, so the only
 * thing standing between a user and a *silent* sign-out is the assumption that every
 * caller rethrows into a view that toasts.
 *
 * `expire()` has exactly one caller — `interview.store.ts`'s `signOutIfSessionExpired`
 * — which fires from four store actions: `start`, `submitAnswer`, `continueInterview`
 * and `finish`. These tests drive all four through the real UI and assert the user is
 * told exactly once: never zero (a silent sign-out) and never twice (the old store
 * toast stacking on the view's).
 */

const EXPIRED = () => new InterviewError('UNAUTHENTICATED', 'You must be signed in to do that.')

const CONFIG = { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 } as const

function makeQuestion(id = 'q1'): Question {
  return { id, text: `Question ${id}`, topic: 'Topic', isFollowUp: false, keywords: [] }
}

function makeEvaluation(questionId: string): Evaluation {
  return {
    questionId,
    grade: 80,
    summary: 'Summary',
    strengths: ['Strength'],
    improvements: ['Improvement'],
    needsFollowUp: false
  }
}

/** Serves the interview normally until `failOn`, where the session turns out to be gone. */
function makeExpiringSource(failOn: 'start' | 'evaluate' | 'next' | 'report'): InterviewSource {
  let served = 0

  return {
    async startInterview(config): Promise<InterviewSession> {
      if (failOn === 'start') throw EXPIRED()
      return {
        id: 'session-1',
        config,
        createdAt: '2026-08-13T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      }
    },
    async getNextQuestion() {
      served += 1
      // The first question always lands, so the user reaches the interview screen.
      if (served === 1) return makeQuestion()
      if (failOn === 'next') throw EXPIRED()
      // For the report case, running out of questions is what triggers `finish()`.
      return null
    },
    async evaluateAnswer(_session, question) {
      if (failOn === 'evaluate') throw EXPIRED()
      return makeEvaluation(question.id)
    },
    async getReport(): Promise<Report> {
      if (failOn === 'report') throw EXPIRED()
      return { overallGrade: 80, headline: 'Headline', strengths: [], improvements: [], entries: [] }
    }
  }
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await flushPromises()
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  throw new Error(`Timed out waiting for: ${label}`)
}

async function mountSignedIn(failOn: 'start' | 'evaluate' | 'next' | 'report') {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  signIn()

  const store = useInterviewStore()
  store.setSource(makeExpiringSource(failOn))

  router.push('/practice')
  await router.isReady()
  await flushPromises()

  return { wrapper, router, store, auth: useAuthStore() }
}

/** Gets the user from the setup form onto a rendered question. */
async function reachFirstQuestion(
  wrapper: Awaited<ReturnType<typeof mountSignedIn>>['wrapper'],
  router: Awaited<ReturnType<typeof mountSignedIn>>['router']
) {
  await wrapper.get('form').trigger('submit')
  await waitFor(() => router.currentRoute.value.path === '/interview', 'interview screen')
  await waitFor(() => wrapper.find('textarea').exists(), 'first question')
}

async function answerCurrentQuestion(
  wrapper: Awaited<ReturnType<typeof mountSignedIn>>['wrapper'],
  text = 'An answer I spent fifteen minutes on'
) {
  await wrapper.get('textarea').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

function advanceButton(wrapper: Awaited<ReturnType<typeof mountSignedIn>>['wrapper']) {
  return wrapper.findAll('button').find(b => /Next question|See your report/.test(b.text()))
}

describe('a session that expires now that the store no longer toasts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('tells the user exactly once when starting an interview finds the session gone', async () => {
    const { wrapper, auth } = await mountSignedIn('start')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    // Zero would be the regression this plan risks: signed out with no explanation.
    expect(vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('tells the user exactly once when submitting an answer finds the session gone', async () => {
    const { wrapper, router, auth } = await mountSignedIn('evaluate')
    await reachFirstQuestion(wrapper, router)

    await answerCurrentQuestion(wrapper)

    expect(vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('tells the user exactly once when loading the next question finds the session gone', async () => {
    const { wrapper, router, auth } = await mountSignedIn('next')
    await reachFirstQuestion(wrapper, router)
    await answerCurrentQuestion(wrapper)

    await waitFor(() => advanceButton(wrapper) !== undefined, 'advance button')
    await advanceButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('tells the user exactly once when building the report finds the session gone', async () => {
    const { wrapper, router, auth } = await mountSignedIn('report')
    await reachFirstQuestion(wrapper, router)
    await answerCurrentQuestion(wrapper)

    await waitFor(() => advanceButton(wrapper) !== undefined, 'advance button')
    await advanceButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(auth.isAuthenticated).toBe(false)
  })

  /**
   * The one user-visible copy change in this ticket. `expire()` still puts the
   * sign-in-again wording on `auth.error` for any screen that wants it, but what the
   * user actually reads mid-interview is now the InterviewError's own message.
   */
  it('says what went wrong, and keeps the sign-in-again copy on auth.error', async () => {
    const { wrapper, router, auth } = await mountSignedIn('evaluate')
    await reachFirstQuestion(wrapper, router)

    await answerCurrentQuestion(wrapper)

    expect(toast.error).toHaveBeenCalledWith('You must be signed in to do that.')
    expect(auth.error).toBe('Your session has expired. Please sign in again.')
  })

  /**
   * Several in-flight calls can fail together. `expire()` is idempotent on the auth
   * state, but each failing call still surfaces its own error to its own caller — this
   * pins how many messages that actually produces.
   */
  it('does not stack a toast per in-flight call when several fail at once', async () => {
    setActivePinia(createPinia())
    signIn()
    const auth = useAuthStore()
    const store = useInterviewStore()
    store.setSource(makeExpiringSource('evaluate'))

    await store.start(CONFIG)
    const first = store.submitAnswer('One').catch(() => {})
    const second = store.submitAnswer('Two').catch(() => {})
    await Promise.all([first, second])

    // The store itself must stay silent however many calls fail.
    expect(toast.error).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(false)
  })
})
