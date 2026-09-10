import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpInterviewSource } from './interview-http.service'
import { InterviewError } from './interview.service'
import type { Answer, InterviewConfig, InterviewSession, Question } from '@/types/interview'

const BASE_URL = 'http://localhost:3001'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

function makeConfig(): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 }
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 'session-1',
    config: makeConfig(),
    createdAt: '2026-07-26T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: [],
    ...overrides
  }
}

function makeQuestion(): Question {
  return { id: 'q1', text: 'Explain X', topic: 'Topic', isFollowUp: false, keywords: ['x'] }
}

function makeAnswer(): Answer {
  return { questionId: 'q1', text: 'my answer', submittedAt: '2026-07-26T10:01:00.000Z' }
}

describe('createHttpInterviewSource', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts an interview by posting the config and returning the bare session', async () => {
    const session = makeSession()
    fetchMock.mockResolvedValue(jsonResponse(201, session))
    const source = createHttpInterviewSource(BASE_URL)

    const result = await source.startInterview(makeConfig())

    expect(result).toEqual(session)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/interview`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(makeConfig())
  })

  it('unwraps the question envelope from GET /:id/question', async () => {
    const question = makeQuestion()
    fetchMock.mockResolvedValue(jsonResponse(200, { question }))
    const source = createHttpInterviewSource(BASE_URL)

    const result = await source.getNextQuestion(makeSession())

    expect(result).toEqual(question)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/interview/session-1/question`)
  })

  it('returns null once the backend reports no question left', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { question: null }))
    const source = createHttpInterviewSource(BASE_URL)

    const result = await source.getNextQuestion(makeSession())

    expect(result).toBeNull()
  })

  it('unwraps the evaluation envelope from POST /:id/answer', async () => {
    const evaluation = {
      questionId: 'q1',
      grade: 80,
      summary: 'Good',
      strengths: ['clear'],
      improvements: [],
      needsFollowUp: false
    }
    fetchMock.mockResolvedValue(jsonResponse(201, { evaluation }))
    const source = createHttpInterviewSource(BASE_URL)

    const result = await source.evaluateAnswer(makeSession(), makeQuestion(), makeAnswer())

    expect(result).toEqual(evaluation)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/interview/session-1/answer`)
    expect(JSON.parse(init.body)).toEqual({ questionId: 'q1', text: 'my answer' })
  })

  it('returns the bare report from GET /:id/report', async () => {
    const report = {
      overallGrade: 75,
      headline: 'Close to ready',
      strengths: [],
      improvements: [],
      entries: []
    }
    fetchMock.mockResolvedValue(jsonResponse(200, report))
    const source = createHttpInterviewSource(BASE_URL)

    const result = await source.getReport(makeSession())

    expect(result).toEqual(report)
  })

  it('maps a non-2xx response into an InterviewError carrying the backend code and message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No interview found.' } })
    )
    const source = createHttpInterviewSource(BASE_URL)

    await expect(source.getReport(makeSession())).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'No interview found.'
    })
    await expect(source.getReport(makeSession())).rejects.toBeInstanceOf(InterviewError)
  })

  it('maps a network failure into a NETWORK_ERROR InterviewError', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))
    const source = createHttpInterviewSource(BASE_URL)

    await expect(source.getReport(makeSession())).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })
  })

  /**
   * The access token expires after ~15 minutes and a single question routinely takes
   * longer to answer than that, so an expired token mid-interview is ordinary use.
   * The user must not lose their place over it.
   */
  describe('an access token that expired mid-interview', () => {
    const expired = () =>
      jsonResponse(401, {
        error: { code: 'UNAUTHENTICATED', message: 'You must be signed in to do that.' }
      })

    it('rotates the session and replays the answer, so the user never notices', async () => {
      const evaluation = {
        questionId: 'q1',
        grade: 80,
        summary: 'Good',
        strengths: [],
        improvements: [],
        needsFollowUp: false
      }
      fetchMock
        .mockResolvedValueOnce(expired())
        .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
        .mockResolvedValueOnce(jsonResponse(201, { evaluation }))
      const source = createHttpInterviewSource(BASE_URL)

      const result = await source.evaluateAnswer(makeSession(), makeQuestion(), makeAnswer())

      expect(result).toEqual(evaluation)
      expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
        `${BASE_URL}/api/interview/session-1/answer`,
        `${BASE_URL}/api/auth/refresh`,
        `${BASE_URL}/api/interview/session-1/answer`
      ])
    })

    it('replays the method and body intact, so the answer is not lost on the retry', async () => {
      fetchMock
        .mockResolvedValueOnce(expired())
        .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
        .mockResolvedValueOnce(jsonResponse(201, { evaluation: {} }))
      const source = createHttpInterviewSource(BASE_URL)

      await source.evaluateAnswer(makeSession(), makeQuestion(), makeAnswer())

      const [, retryInit] = fetchMock.mock.calls[2]
      expect(retryInit.method).toBe('POST')
      expect(JSON.parse(retryInit.body)).toEqual({ questionId: 'q1', text: 'my answer' })
      expect(retryInit.credentials).toBe('include')
    })

    it('carries credentials on the refresh itself, or the rotation cookie is dropped', async () => {
      fetchMock
        .mockResolvedValueOnce(expired())
        .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
        .mockResolvedValueOnce(jsonResponse(200, { question: null }))
      const source = createHttpInterviewSource(BASE_URL)

      await source.getNextQuestion(makeSession())

      expect(fetchMock.mock.calls[1][1].credentials).toBe('include')
    })

    it('gives up as UNAUTHENTICATED when the refresh is rejected too, without retrying', async () => {
      fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(expired())
      const source = createHttpInterviewSource(BASE_URL)

      await expect(source.getReport(makeSession())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      })
      // The original call, one refresh, and nothing more — no retry loop.
      expect(fetchMock.mock.calls.length).toBe(2)
    })

    it('stops after a single retry when the replayed call is refused as well', async () => {
      fetchMock
        .mockResolvedValueOnce(expired())
        .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
        .mockResolvedValueOnce(expired())
      const source = createHttpInterviewSource(BASE_URL)

      await expect(source.getReport(makeSession())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      })
      expect(fetchMock.mock.calls.length).toBe(3)
    })

    it('does not burn a refresh on a failure that has nothing to do with the session', async () => {
      // A 409 on an already-answered question is the server's real answer.
      fetchMock.mockResolvedValue(
        jsonResponse(409, { error: { code: 'CONFLICT', message: 'Already answered.' } })
      )
      const source = createHttpInterviewSource(BASE_URL)

      await expect(
        source.evaluateAnswer(makeSession(), makeQuestion(), makeAnswer())
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(fetchMock.mock.calls.length).toBe(1)
    })

    it('treats a 401 that is not UNAUTHENTICATED as final', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Nope.' } })
      )
      const source = createHttpInterviewSource(BASE_URL)

      await expect(source.getReport(makeSession())).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS'
      })
      expect(fetchMock.mock.calls.length).toBe(1)
    })
  })
})
