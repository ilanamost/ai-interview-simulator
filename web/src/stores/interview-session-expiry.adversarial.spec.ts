import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInterviewStore } from '@/stores/interview.store'
import { useAuthStore } from '@/stores/auth.store'
import { createHttpInterviewSource } from '@/services/interview-http.service'
import { signIn } from '@/test/auth-fixture'
import type { InterviewConfig } from '@/types/interview'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

/**
 * QA independent proof for finding F2. The delivered specs cover each half
 * separately: `interview-http.service.spec.ts` drives the real source over a stubbed
 * `fetch` but never through the store, and `session-expiry.spec.ts` drives the store
 * but through a stub `InterviewSource` that throws `InterviewError('UNAUTHENTICATED')`
 * ready-made. Neither exercises the actual seam a user hits — a real HTTP 401
 * envelope, decoded by the real source, surfacing through the real store.
 *
 * These tests wire the genuine `createHttpInterviewSource` into the genuine store and
 * stub only `globalThis.fetch`, so nothing between the wire and the store is faked.
 */

const BASE_URL = 'http://localhost:3001'

const CONFIG: InterviewConfig = {
  jobTitle: 'frontend',
  level: 'mid',
  type: 'technical',
  questionCount: 5
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** Exactly what `require-auth` puts on the wire when the access token is gone. */
function unauthenticated(): Response {
  return jsonResponse(401, {
    error: { code: 'UNAUTHENTICATED', message: 'You must be signed in to do that.' },
    requestId: 'req-1'
  })
}

const SESSION = {
  id: 'session-1',
  config: CONFIG,
  createdAt: '2026-08-13T10:00:00.000Z',
  asked: [],
  answers: [],
  evaluations: []
}

const QUESTION = { id: 'q1', text: 'Explain the event loop.', topic: 'JS', isFollowUp: false, keywords: [] }

const EVALUATION = {
  questionId: 'q1',
  grade: 8,
  summary: 'Solid answer.',
  strengths: ['clear'],
  improvements: ['more depth'],
  needsFollowUp: false
}

const STORAGE_KEY = 'interview-session-v1'

describe('a real 401 reaching interview.store through the real HTTP source', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    signIn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Puts the store mid-interview: one question asked, awaiting an answer. */
  async function startInterview() {
    const store = useInterviewStore()
    store.setSource(createHttpInterviewSource(BASE_URL))

    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { question: QUESTION }))

    await store.start(CONFIG)
    expect(store.currentQuestion?.id).toBe('q1')
    fetchMock.mockReset()

    return store
  }

  it('recovers transparently when the refresh succeeds: the answer lands, the user never signs out', async () => {
    const store = await startInterview()
    const auth = useAuthStore()

    // POST /answer -> 401, POST /auth/refresh -> 200, POST /answer replayed -> 201.
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(jsonResponse(200, { user: auth.user }))
      .mockResolvedValueOnce(jsonResponse(201, { evaluation: EVALUATION }))

    await store.submitAnswer('my answer')

    expect(store.currentEvaluation?.grade).toBe(8)
    expect(store.status).toBe('reviewing')
    expect(store.error).toBeNull()
    // The whole point of the transparent path: still signed in, never bounced.
    expect(auth.isAuthenticated).toBe(true)

    const urls = fetchMock.mock.calls.map(call => call[0])
    expect(urls).toEqual([
      `${BASE_URL}/api/interview/session-1/answer`,
      `${BASE_URL}/api/auth/refresh`,
      `${BASE_URL}/api/interview/session-1/answer`
    ])
  })

  it('signs the user out when the refresh also fails, instead of stranding them on the question', async () => {
    const store = await startInterview()
    const auth = useAuthStore()

    fetchMock.mockResolvedValue(unauthenticated())

    await expect(store.submitAnswer('my answer')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    })

    // The exact failure from the first pass: signed out server-side, still "signed
    // in" client-side with no way forward.
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
  })

  it('keeps the interview in localStorage across the expiry, so signing back in resumes it', async () => {
    const store = await startInterview()

    fetchMock.mockResolvedValue(unauthenticated())
    await store.submitAnswer('my answer').catch(() => undefined)

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()

    const snapshot = JSON.parse(raw as string)
    expect(snapshot.session.id).toBe('session-1')
    expect(store.session?.id).toBe('session-1')
  })

  it('leaves the user on the question, not reset to setup, when the session dies', async () => {
    const store = await startInterview()

    fetchMock.mockResolvedValue(unauthenticated())
    await store.submitAnswer('my answer').catch(() => undefined)

    // Their place is preserved: same question, back in 'asking' rather than wiped.
    expect(store.currentQuestion?.id).toBe('q1')
    expect(store.status).toBe('asking')
  })

  it('does not sign the user out for an ordinary interview failure', async () => {
    const store = await startInterview()
    const auth = useAuthStore()

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { error: { code: 'EMPTY_ANSWER', message: 'Answer is empty.' } })
    )

    await store.submitAnswer('my answer').catch(() => undefined)

    expect(auth.isAuthenticated).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a mid-interview continue the same way, not only an answer submission', async () => {
    const store = await startInterview()
    const auth = useAuthStore()

    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(jsonResponse(200, { user: auth.user }))
      .mockResolvedValueOnce(jsonResponse(201, { evaluation: EVALUATION }))
    await store.submitAnswer('my answer')

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(jsonResponse(200, { user: auth.user }))
      .mockResolvedValueOnce(jsonResponse(200, { question: { ...QUESTION, id: 'q2' } }))

    await store.continueInterview()

    expect(store.currentQuestion?.id).toBe('q2')
    expect(auth.isAuthenticated).toBe(true)
  })
})
