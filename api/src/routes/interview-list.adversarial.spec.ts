import { describe, expect, it, vi } from 'vitest'
import { ORG, buildHarness, makeInterviewService, signUp } from '../test/app-harness.js'
import type { InterviewService } from '../services/interview.service.js'
import type { InterviewSummary } from '../types/interview.js'

/*
 * QA adversarial pass on GET /api/interview (plan 013).
 *
 * app.spec.ts already proves the happy path and the obvious 400s. This file only
 * tries to break the list: reach another org's rows, smuggle a filter past the
 * strict schema, or make the query parser hand the repository something that is
 * not a plain string.
 */

function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id: 'interview-1',
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 },
    createdAt: '2026-07-18T10:00:00.000Z',
    overallGrade: 82,
    ...overrides
  }
}

/** The paged shape the repository answers with, as of plan 018. */
function makePage(items: InterviewSummary[] = [], total = items.length) {
  return { items, total }
}

async function authenticatedApp(interviewService: InterviewService, org: string = ORG) {
  const { app } = buildHarness({ interviewService, org })
  const { agent } = await signUp(app)
  return { app, agent }
}

describe('GET /api/interview cannot be steered off its own org', () => {
  it('takes org from the access cookie, never from the query string', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service, 'org-a')

    // `org` is not in the schema, so .strict() must reject it outright rather than
    // letting it through to be read as a filter.
    const res = await agent.get('/api/interview?org=org-b')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it('gives two deployments two different orgs, with no leakage between them', async () => {
    const rowsByOrg: Record<string, InterviewSummary[]> = {
      'org-a': [makeSummary({ id: 'a-only' })],
      'org-b': [makeSummary({ id: 'b-only' })]
    }
    const listInterviews = vi.fn(async (org: string) => makePage(rowsByOrg[org] ?? []))

    const a = await authenticatedApp(makeInterviewService({ listInterviews }), 'org-a')
    const b = await authenticatedApp(makeInterviewService({ listInterviews }), 'org-b')

    const resA = await a.agent.get('/api/interview')
    const resB = await b.agent.get('/api/interview')

    expect(resA.body.interviews.map((i: InterviewSummary) => i.id)).toEqual(['a-only'])
    expect(resB.body.interviews.map((i: InterviewSummary) => i.id)).toEqual(['b-only'])
    expect(listInterviews.mock.calls.map(call => call[0])).toEqual(['org-a', 'org-b'])
  })

  /** Paging must not become a second way to address rows — org still comes from the cookie. */
  it('still isolates orgs when the request is paged and sorted', async () => {
    const rowsByOrg: Record<string, InterviewSummary[]> = {
      'org-a': [makeSummary({ id: 'a-page-2' })],
      'org-b': [makeSummary({ id: 'b-page-2' })]
    }
    const listInterviews = vi.fn(async (org: string) => makePage(rowsByOrg[org] ?? [], 40))

    const a = await authenticatedApp(makeInterviewService({ listInterviews }), 'org-a')
    const b = await authenticatedApp(makeInterviewService({ listInterviews }), 'org-b')

    const query = 'page=2&pageSize=1&sort=grade-desc'
    const resA = await a.agent.get(`/api/interview?${query}`)
    const resB = await b.agent.get(`/api/interview?${query}`)

    expect(resA.body).toEqual({ interviews: [makeSummary({ id: 'a-page-2' })], total: 40 })
    expect(resB.body).toEqual({ interviews: [makeSummary({ id: 'b-page-2' })], total: 40 })
    // Each call is handed its own org plus the same page window — never another org's.
    expect(listInterviews.mock.calls).toEqual([
      ['org-a', { page: 2, pageSize: 1, sort: 'grade-desc' }],
      ['org-b', { page: 2, pageSize: 1, sort: 'grade-desc' }]
    ])
  })

  it('cannot be steered to another org by an org-shaped pagination parameter', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service, 'org-a')

    // `.strict()` has to keep rejecting unknown keys now that the schema is larger.
    for (const query of ['page=1&org=org-b', 'pageSize=10&orgId=org-b', 'sort=date-desc&tenant=b']) {
      const res = await agent.get(`/api/interview?${query}`)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it('reaches no service at all without an access cookie, filters or not', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { app } = buildHarness({ interviewService: service })
    const request = (await import('supertest')).default

    const bare = await request(app).get('/api/interview')
    const filtered = await request(app).get('/api/interview?jobTitle=backend')

    expect(bare.status).toBe(401)
    expect(filtered.status).toBe(401)
    expect(service.listInterviews).not.toHaveBeenCalled()
  })
})

describe('the query parser cannot smuggle a non-string past validateQuery', () => {
  /** Express parses `a=1&a=2` into an array and `a[b]=1` into an object — neither is a filter. */
  it.each([
    ['a repeated filter parsed as an array', 'jobTitle=frontend&jobTitle=backend'],
    ['a repeated date parsed as an array', 'date=2026-08-14&date=2026-08-15'],
    ['a bracketed operator object', 'date[$gt]=2020-01-01'],
    ['a bracketed array', 'level[]=senior'],
    ['a nested object on an enum', 'type[a][b]=technical']
  ])('rejects %s with a 400 and never queries', async (_label, query) => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(`/api/interview?${query}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it('rejects an absurdly long filter value without reaching the database', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(`/api/interview?jobTitle=${'a'.repeat(10000)}`)

    expect(res.status).toBe(400)
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it.each([
    ['a null byte on an enum', 'level=senior%00'],
    ['whitespace padding on an enum', 'type=%20technical'],
    ['a date padded with whitespace', 'date=%202026-08-14'],
    ['an empty filter, which is not "no filter"', 'jobTitle='],
    ['an empty date', 'date=']
  ])('rejects %s', async (_label, query) => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(`/api/interview?${query}`)

    expect(res.status).toBe(400)
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it('does not let a prototype-shaped key pollute Object.prototype', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service)

    await agent.get('/api/interview?__proto__[polluted]=yes')
    await agent.get('/api/interview?constructor[prototype][polluted]=yes')

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('hands the service only the keys the caller actually sent, never an extra one', async () => {
    const listInterviews = vi.fn().mockResolvedValue(makePage())
    const { agent } = await authenticatedApp(makeInterviewService({ listInterviews }))

    await agent.get('/api/interview?date=2026-08-14&jobTitle=backend')

    // An omitted page or pageSize stays omitted here — the repository owns the defaults.
    const query = listInterviews.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(query).sort()).toEqual(['date', 'jobTitle'])
    for (const value of Object.values(query)) expect(typeof value).toBe('string')
  })

  it('hands the repository real numbers for page and pageSize, never the raw strings', async () => {
    // The repository arithmetics the offset: a string would make `(page - 1) * size`
    // silently wrong (or NaN) rather than fail.
    const listInterviews = vi.fn().mockResolvedValue(makePage())
    const { agent } = await authenticatedApp(makeInterviewService({ listInterviews }))

    await agent.get('/api/interview?page=4&pageSize=25&sort=grade-asc')

    const query = listInterviews.mock.calls[0][1] as Record<string, unknown>
    expect(query).toEqual({ page: 4, pageSize: 25, sort: 'grade-asc' })
    expect(typeof query.page).toBe('number')
    expect(typeof query.pageSize).toBe('number')
  })

  it('leaks nothing about the schema internals in the 400 body', async () => {
    const { agent } = await authenticatedApp(makeInterviewService({ listInterviews: vi.fn() }))

    const res = await agent.get('/api/interview?jobTitle=astronaut')
    const body = JSON.stringify(res.body)

    expect(body).not.toContain('interview.repository')
    expect(body).not.toContain('select ')
    expect(body).not.toContain('avg(')
  })

  it('leaks no SQL from a rejected sort value either', async () => {
    const { agent } = await authenticatedApp(makeInterviewService({ listInterviews: vi.fn() }))

    const res = await agent.get('/api/interview?sort=i.created_at%3B%20drop%20table%20interview--')
    const body = JSON.stringify(res.body)

    expect(res.status).toBe(400)
    expect(body).not.toContain('order by')
    expect(body).not.toContain('limit')
  })
})

/*
 * Paging is the one place where a bad number does real damage: an unbounded pageSize is
 * a free way to pull an org's whole history in one request, and a clamped one silently
 * answers a different question than the client asked. Both are rejected outright.
 */
describe('the page window cannot be pushed out of range', () => {
  it.each([
    ['a pageSize past the ceiling', 'pageSize=999'],
    ['a wildly oversized pageSize', 'pageSize=100000'],
    ['a pageSize of zero', 'pageSize=0'],
    ['a negative pageSize', 'pageSize=-1'],
    ['a fractional pageSize', 'pageSize=10.5'],
    ['a pageSize in scientific notation', 'pageSize=1e3'],
    ['a hex pageSize', 'pageSize=0x20'],
    ['a page of zero', 'page=0'],
    ['a negative page', 'page=-5'],
    ['a fractional page', 'page=2.5'],
    ['a page that is not a number', 'page=NaN'],
    ['an infinite page', 'page=Infinity'],
    ['an empty page', 'page='],
    ['an empty pageSize', 'pageSize='],
    ['a whitespace-padded page', 'page=%202'],
    ['a page parsed as an array', 'page=1&page=2'],
    ['a bracketed page array', 'page[]=2'],
    ['a bracketed pageSize object', 'pageSize[$gt]=1'],
    ['an empty sort, which is not "no sort"', 'sort='],
    ['a sort outside the enum', 'sort=grade'],
    ['a legacy sortBy', 'sortBy=grade-desc'],
    ['a legacy limit', 'limit=100'],
    ['a legacy offset', 'offset=100'],
    ['a legacy per_page', 'per_page=100']
  ])('rejects %s with a 400 and never queries', async (_label, query) => {
    const service = makeInterviewService({ listInterviews: vi.fn() })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get(`/api/interview?${query}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(service.listInterviews).not.toHaveBeenCalled()
  })

  it('rejects rather than clamps, so a caller never gets a page size it did not ask for', async () => {
    const service = makeInterviewService({ listInterviews: vi.fn().mockResolvedValue(makePage()) })
    const { agent } = await authenticatedApp(service)

    const rejected = await agent.get('/api/interview?pageSize=51')
    const accepted = await agent.get('/api/interview?pageSize=50')

    expect(rejected.status).toBe(400)
    expect(accepted.status).toBe(200)
    // 50 is the ceiling and it is honoured exactly — not silently reduced.
    expect(service.listInterviews).toHaveBeenCalledTimes(1)
    expect(service.listInterviews).toHaveBeenCalledWith(ORG, { pageSize: 50 })
  })

  it('accepts a page far past the end as a 200, not an error', async () => {
    // The client needs the true `total` back to correct itself; a 400 or 404 here
    // would strand it on a page it can never leave.
    const service = makeInterviewService({
      listInterviews: vi.fn().mockResolvedValue(makePage([], 3))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview?page=100000')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ interviews: [], total: 3 })
  })
})

describe('repeated and concurrent list reads', () => {
  it('answers twenty rapid concurrent reads identically, each scoped to its own org', async () => {
    const listInterviews = vi.fn(async (org: string) => makePage([makeSummary({ id: `${org}-1` })]))
    const { agent } = await authenticatedApp(makeInterviewService({ listInterviews }), 'org-a')

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => agent.get('/api/interview?jobTitle=frontend'))
    )

    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ interviews: [makeSummary({ id: 'org-a-1' })], total: 1 })
    }
    expect(listInterviews).toHaveBeenCalledTimes(20)
    expect(listInterviews.mock.calls.every(call => call[0] === 'org-a')).toBe(true)
  })

  /** A failing list must surface as the standard error shape, not a hung or naked 500. */
  it('turns an unexpected repository failure into a clean 500 with no internals', async () => {
    const service = makeInterviewService({
      listInterviews: vi.fn().mockRejectedValue(new Error('connection string leaked'))
    })
    const { agent } = await authenticatedApp(service)

    const res = await agent.get('/api/interview')

    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('connection string leaked')
  })
})
