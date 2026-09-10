import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { ORG, buildHarness, makeInterviewService, signUp } from './test/app-harness.js'
import { ACCESS_TOKEN_COOKIE } from './utils/auth-cookie.js'
import { AppError } from './utils/app-error.js'
import type { InterviewConfig, InterviewSession, InterviewSummary } from './types/interview.js'
import type { InterviewService } from './services/interview.service.js'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2, ...overrides }
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 'interview-1',
    config: makeConfig(),
    createdAt: '2026-07-18T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: [],
    ...overrides
  }
}

/** Every interview route now sits behind require-auth, so tests sign up first. */
async function authenticatedApp(interviewService: InterviewService, org: string = ORG) {
  const { app } = buildHarness({ interviewService, org })
  const { agent } = await signUp(app)
  return { app, agent }
}

describe('POST /api/interview', () => {
  it('creates an interview and returns 201 with the session', async () => {
    const session = makeSession()
    const service = makeInterviewService({ startInterview: vi.fn().mockResolvedValue(session) })
    const { agent } = await authenticatedApp(service)

    const res = await agent.post('/api/interview').send({
      jobTitle: 'frontend',
      level: 'mid',
      type: 'technical',
      questionCount: 2
    })

    expect(res.status).toBe(201)
    expect(res.body).toEqual(session)
    expect(service.startInterview).toHaveBeenCalledWith(ORG, {
      jobTitle: 'frontend',
      level: 'mid',
      type: 'technical',
      questionCount: 2
    })
  })

  it('returns a 400 validation error for an invalid jobTitle', async () => {
    const { agent } = await authenticatedApp(makeInterviewService())

    const res = await agent.post('/api/interview').send({
      jobTitle: 'astronaut',
      level: 'mid',
      type: 'technical',
      questionCount: 2
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.requestId).toEqual(expect.any(String))
  })

  it('rejects unexpected fields in the body', async () => {
    const { agent } = await authenticatedApp(makeInterviewService())

    const res = await agent.post('/api/interview').send({
      jobTitle: 'frontend',
      level: 'mid',
      type: 'technical',
      questionCount: 2,
      hacker: true
    })

    expect(res.status).toBe(400)
  })

  it('passes an allowlisted model through to the service', async () => {
    const service = makeInterviewService({
      startInterview: vi.fn().mockResolvedValue(makeSession())
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.post('/api/interview').send({
      jobTitle: 'frontend',
      level: 'mid',
      type: 'technical',
      questionCount: 2,
      model: 'claude-opus-5'
    })

    expect(res.status).toBe(201)
    expect(service.startInterview).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ model: 'claude-opus-5' })
    )
  })

  it('rejects a model outside the allowlist before it can reach the provider', async () => {
    const service = makeInterviewService()
    const { agent } = await authenticatedApp(service)

    const res = await agent.post('/api/interview').send({
      jobTitle: 'frontend',
      level: 'mid',
      type: 'technical',
      questionCount: 2,
      model: 'gpt-4'
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(service.startInterview).not.toHaveBeenCalled()
  })

  it('rejects a questionCount below 1', async () => {
    const { agent } = await authenticatedApp(makeInterviewService())

    const res = await agent
      .post('/api/interview')
      .send({ jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 0 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/interview', () => {
  function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
    return {
      id: 'interview-1',
      config: makeConfig(),
      createdAt: '2026-07-18T10:00:00.000Z',
      overallGrade: 82,
      ...overrides
    }
  }

  /** The paged shape the repository answers with, as of plan 018. */
  function makePage(items: InterviewSummary[] = [], total = items.length) {
    return { items, total }
  }

  it('returns 200 with the summaries under an `interviews` key, plus the total', async () => {
    const summary = makeSummary()
    const service = makeInterviewService({
      listInterviews: vi.fn().mockResolvedValue(makePage([summary]))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interviews: [summary], total: 1 })
  })

  it('returns an empty array rather than a 404 when nothing matches', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interviews: [], total: 0 })
  })

  it('returns at most pageSize rows, and a total that counts past them', async () => {
    // The client sizes its pager from `total`, so it must be the filtered count and
    // never be capped at the page it happens to be looking at.
    const page = Array.from({ length: 3 }, (_, i) => makeSummary({ id: `interview-${i}` }))
    const service = makeInterviewService({
      listInterviews: vi.fn().mockResolvedValue(makePage(page, 27))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview?page=2&pageSize=3')

    expect(res.status).toBe(200)
    expect(res.body.interviews).toHaveLength(3)
    expect(res.body.interviews.length).toBeLessThanOrEqual(3)
    expect(res.body.total).toBe(27)
  })

  it('answers 200 with an empty page and the true total past the last page', async () => {
    const service = makeInterviewService({
      listInterviews: vi.fn().mockResolvedValue(makePage([], 12))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview?page=99&pageSize=10')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interviews: [], total: 12 })
  })

  it('calls the service with the authenticated org and no filters when none are sent', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service, 'acme-org')

    await agent.get('/api/interview')

    // Nothing sent, nothing forwarded: page and pageSize default in the repository.
    expect(service.listInterviews).toHaveBeenCalledWith('acme-org', {})
  })

  it('forwards every filter to the service', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(
      '/api/interview?date=2026-08-14&jobTitle=backend&level=senior&type=behavioral'
    )

    expect(res.status).toBe(200)
    expect(service.listInterviews).toHaveBeenCalledWith(ORG, {
      date: '2026-08-14',
      jobTitle: 'backend',
      level: 'senior',
      type: 'behavioral'
    })
  })

  it('forwards sort, page and pageSize, with the numbers coerced from the query string', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview?sort=grade-asc&page=3&pageSize=25')

    expect(res.status).toBe(200)
    expect(service.listInterviews).toHaveBeenCalledWith(ORG, {
      sort: 'grade-asc',
      page: 3,
      pageSize: 25
    })
  })

  it.each(['date-desc', 'date-asc', 'grade-desc', 'grade-asc'])(
    'accepts %s as a sort value',
    async sort => {
      const listInterviews = vi.fn().mockResolvedValue(makePage())
      const service = makeInterviewService({ listInterviews })
      const { agent } = await authenticatedApp(service)

      const res = await agent.get(`/api/interview?sort=${sort}`)

      expect(res.status).toBe(200)
      expect(service.listInterviews).toHaveBeenCalledWith(ORG, { sort })
    }
  )

  it.each([
    ['a wrongly ordered date', 'date=14-08-2026'],
    ['a date that is not a real day', 'date=2026-02-30'],
    ['a date with a time on it', 'date=2026-08-14T10:00:00Z'],
    ['a job title outside the enum', 'jobTitle=astronaut'],
    ['a level outside the enum', 'level=principal'],
    ['a type outside the enum', 'type=whiteboard'],
    ['an unknown filter', 'sortBy=grade'],
    ['a legacy limit parameter', 'limit=10'],
    ['a legacy offset parameter', 'offset=20'],
    ['a sort value outside the enum', 'sort=grade'],
    ['a page of zero', 'page=0'],
    ['a negative page', 'page=-1'],
    ['a fractional page', 'page=1.5'],
    ['a page that is not a number', 'page=two'],
    ['an empty page', 'page='],
    ['a page smuggled in as an array', 'page[]=2'],
    ['a pageSize of zero', 'pageSize=0'],
    ['a pageSize past the ceiling', 'pageSize=999'],
    ['a negative pageSize', 'pageSize=-10']
  ])('rejects %s with a 400 and never calls the service', async (_label, query) => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(`/api/interview?${query}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  // Risk called out in .plan/013: '/' and '/:id' share a prefix. Confirmed, not assumed.
  it('is not shadowed by GET /:id, and does not shadow it either', async () => {
    const service = makeInterviewService({
      listInterviews: vi.fn().mockResolvedValue(makePage([makeSummary()])),
      getInterview: vi.fn().mockResolvedValue(makeSession())
    })
    const { agent } = await authenticatedApp(service)

    const list = await agent.get('/api/interview')

    expect(list.body).toEqual({ interviews: [makeSummary()], total: 1 })
    expect(service.getInterview).not.toHaveBeenCalled()

    const detail = await agent.get('/api/interview/interview-1')

    expect(detail.body).toEqual(makeSession())
    expect(service.getInterview).toHaveBeenCalledWith(ORG, 'interview-1')
    expect(service.listInterviews).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/interview/:id', () => {
  it('returns 404 with the stable error shape when the interview does not exist', async () => {
    const service = makeInterviewService({
      getInterview: vi.fn().mockRejectedValue(AppError.notFound('No interview found with id x.'))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview/missing')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No interview found with id x.' },
      requestId: expect.any(String)
    })
  })
})

describe('GET /api/interview/:id/question', () => {
  it('wraps the next question (or null) under a `question` key', async () => {
    const service = makeInterviewService({ getNextQuestion: vi.fn().mockResolvedValue(null) })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview/interview-1/question')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ question: null })
  })
})

describe('POST /api/interview/:id/answer', () => {
  it('returns 201 with the evaluation on success', async () => {
    const evaluation = {
      questionId: 'q1',
      grade: 80,
      summary: 'Solid',
      strengths: [],
      improvements: [],
      needsFollowUp: false
    }
    const service = makeInterviewService({ submitAnswer: vi.fn().mockResolvedValue(evaluation) })
    const { agent } = await authenticatedApp(service)

    const res = await agent
      .post('/api/interview/interview-1/answer')
      .send({ questionId: 'q1', text: 'my answer' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ evaluation })
    expect(service.submitAnswer).toHaveBeenCalledWith(ORG, 'interview-1', 'q1', 'my answer')
  })

  it('returns 400 when the answer text is empty (schema-level, before the service is called)', async () => {
    const service = makeInterviewService()
    const { agent } = await authenticatedApp(service)

    const res = await agent
      .post('/api/interview/interview-1/answer')
      .send({ questionId: 'q1', text: '' })

    expect(res.status).toBe(400)
    expect(service.submitAnswer).not.toHaveBeenCalled()
  })

  it('maps a CONFLICT domain error to a 409', async () => {
    const service = makeInterviewService({
      submitAnswer: vi
        .fn()
        .mockRejectedValue(AppError.conflict('This question has already been answered.'))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent
      .post('/api/interview/interview-1/answer')
      .send({ questionId: 'q1', text: 'again' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})

describe('GET /api/interview/:id/report', () => {
  it('maps a NO_EVALUATION domain error to a 422', async () => {
    const service = makeInterviewService({
      getReport: vi
        .fn()
        .mockRejectedValue(
          AppError.domain('NO_EVALUATION', 'There are no answers to report on yet.')
        )
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview/interview-1/report')

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('NO_EVALUATION')
  })
})

describe('interview routes are guarded by require-auth', () => {
  it('rejects every interview route without an access cookie and never calls the service', async () => {
    const service = makeInterviewService()
    const { app } = buildHarness({ interviewService: service })

    const responses = await Promise.all([
      request(app).post('/api/interview').send(makeConfig()),
      request(app).get('/api/interview'),
      request(app).get('/api/interview/interview-1'),
      request(app).get('/api/interview/interview-1/question'),
      request(app).post('/api/interview/interview-1/answer').send({ questionId: 'q1', text: 'a' }),
      request(app).get('/api/interview/interview-1/report')
    ])

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    }
    expect(service.startInterview).not.toHaveBeenCalled()
    expect(service.listInterviews).not.toHaveBeenCalled()
    expect(service.getInterview).not.toHaveBeenCalled()
    expect(service.getNextQuestion).not.toHaveBeenCalled()
    expect(service.submitAnswer).not.toHaveBeenCalled()
    expect(service.getReport).not.toHaveBeenCalled()
  })

  it('rejects a tampered access cookie', async () => {
    const service = makeInterviewService()
    const { app } = buildHarness({ interviewService: service })

    const res = await request(app)
      .get('/api/interview/interview-1/question')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=not.a.jwt`)

    expect(res.status).toBe(401)
    expect(service.getNextQuestion).not.toHaveBeenCalled()
  })
})

describe('org scoping', () => {
  it('scopes interview calls to the authenticated user org, not a static config value', async () => {
    const service = makeInterviewService({
      getNextQuestion: vi.fn().mockResolvedValue(null)
    })
    const { agent } = await authenticatedApp(service, 'acme-org')

    await agent.get('/api/interview/interview-1/question')

    expect(service.getNextQuestion).toHaveBeenCalledWith('acme-org', 'interview-1')
  })

  it('gives each org its own scope, with no org ever leaking into the other', async () => {
    const serviceA = makeInterviewService({
      getInterview: vi.fn().mockResolvedValue(makeSession())
    })
    const serviceB = makeInterviewService({
      getInterview: vi.fn().mockResolvedValue(makeSession())
    })
    const { agent: agentA } = await authenticatedApp(serviceA, 'org-a')
    const { agent: agentB } = await authenticatedApp(serviceB, 'org-b')

    await agentA.get('/api/interview/interview-1')
    await agentB.get('/api/interview/interview-1')

    expect(serviceA.getInterview).toHaveBeenCalledWith('org-a', 'interview-1')
    expect(serviceA.getInterview).not.toHaveBeenCalledWith('org-b', 'interview-1')
    expect(serviceB.getInterview).toHaveBeenCalledWith('org-b', 'interview-1')
    expect(serviceB.getInterview).not.toHaveBeenCalledWith('org-a', 'interview-1')
  })

  // A token minted for another org's deployment is rejected outright — see
  // require-auth.spec.ts "rejects an org-a token against an org-b deployment".
})

describe('error handling and cross-cutting concerns', () => {
  it('returns a 404 with the stable shape for an unknown route', async () => {
    const { app } = buildHarness()

    const res = await request(app).get('/api/nope')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('never leaks internal error details for an unexpected (non-AppError) failure', async () => {
    const service = makeInterviewService({
      getInterview: vi.fn().mockRejectedValue(new Error('db connection string leaked'))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview/interview-1')

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('db connection string leaked')
  })

  it('sets a unique x-request-id header on every response', async () => {
    const { agent } = await authenticatedApp(
      makeInterviewService({ getNextQuestion: vi.fn().mockResolvedValue(null) })
    )

    const [first, second] = await Promise.all([
      agent.get('/api/interview/i1/question'),
      agent.get('/api/interview/i2/question')
    ])

    expect(first.headers['x-request-id']).toEqual(expect.any(String))
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id'])
  })

  it('answers /health without authentication', async () => {
    const { app } = buildHarness()

    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
