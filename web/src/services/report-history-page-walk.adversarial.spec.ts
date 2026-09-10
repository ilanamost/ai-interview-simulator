import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpReportHistorySource,
  createMockReportHistorySource
} from './report-history.service'
import type {
  ReportHistorySort,
  ReportHistorySource
} from './report-history.service'
import type { InterviewConfig, InterviewSession, Report } from '@/types/interview'

/*
 * QA adversarial pass (plan 018) on the failure the plan names first: a row that appears
 * on two pages, or on none, because the ordering is not a total order.
 *
 * report-history.adversarial.spec.ts already walks three rows at pageSize 1. That set is
 * too small for the interesting case: it has one tie pair and every page boundary falls
 * outside it. This walks a set whose ties STRADDLE the boundaries — nine rows at pageSize
 * 2 leaves a tied pair split across pages 1/2 and again across 3/4 — and checks the
 * property that actually matters rather than a hand-written expected order: concatenating
 * every page must reproduce the full set exactly once, with nothing repeated and nothing
 * lost, under all four orderings and in both sources.
 */

const BASE_URL = 'http://localhost:3001'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3, ...overrides }
}

function makeSession(id: string, createdAt: string): InterviewSession {
  return { id, config: makeConfig(), createdAt, asked: [], answers: [], evaluations: [] }
}

function makeReport(overallGrade: number): Report {
  return { overallGrade, headline: 'H', strengths: [], improvements: [], entries: [] }
}

/**
 * Nine interviews over four distinct grades, so most rows are tied with at least one
 * other and the tie-break carries the ordering rather than decorating it. Dates are
 * distinct, which is what makes a total order possible at all.
 */
const SCENARIO = [
  { id: 'r1', createdAt: '2026-08-01T09:00:00.000Z', grade: 70 },
  { id: 'r2', createdAt: '2026-08-02T09:00:00.000Z', grade: 70 },
  { id: 'r3', createdAt: '2026-08-03T09:00:00.000Z', grade: 70 },
  { id: 'r4', createdAt: '2026-08-04T09:00:00.000Z', grade: 85 },
  { id: 'r5', createdAt: '2026-08-05T09:00:00.000Z', grade: 85 },
  { id: 'r6', createdAt: '2026-08-06T09:00:00.000Z', grade: 91 },
  { id: 'r7', createdAt: '2026-08-07T09:00:00.000Z', grade: 91 },
  { id: 'r8', createdAt: '2026-08-08T09:00:00.000Z', grade: 91 },
  { id: 'r9', createdAt: '2026-08-09T09:00:00.000Z', grade: 100 }
]

const PAGE_SIZE = 2
const SORTS: ReportHistorySort[] = ['date-desc', 'date-asc', 'grade-desc', 'grade-asc']

/** The server's ordering, as `GET /interview` documents it. Ties break newest-first. */
const SERVER_ORDER: Record<ReportHistorySort, (a: typeof SCENARIO[number], b: typeof SCENARIO[number]) => number> = {
  'date-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
  'date-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
  'grade-desc': (a, b) => b.grade - a.grade || b.createdAt.localeCompare(a.createdAt),
  'grade-asc': (a, b) => a.grade - b.grade || b.createdAt.localeCompare(a.createdAt)
}

function mockSource(): ReportHistorySource {
  const source = createMockReportHistorySource()
  for (const row of SCENARIO) {
    source.record(makeSession(row.id, row.createdAt), makeReport(row.grade))
  }
  return source
}

function httpSource(): ReportHistorySource {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url).searchParams
      const ordered = [...SCENARIO].sort(SERVER_ORDER[(params.get('sort') ?? 'date-desc') as ReportHistorySort])
      const size = Number(params.get('pageSize') ?? 10)
      const start = (Number(params.get('page') ?? 1) - 1) * size

      return {
        ok: true,
        status: 200,
        json: async () => ({
          interviews: ordered.slice(start, start + size).map(row => ({
            id: row.id,
            config: makeConfig(),
            createdAt: row.createdAt,
            overallGrade: row.grade
          })),
          total: ordered.length
        })
      } as Response
    })
  )

  return createHttpReportHistorySource(BASE_URL)
}

const sources: Array<[string, () => ReportHistorySource]> = [
  ['mock', mockSource],
  ['http', httpSource]
]

/** Every page from 1 until the pager would stop, flattened in the order a user sees them. */
async function walkAllPages(source: ReportHistorySource, sort: ReportHistorySort): Promise<string[]> {
  const first = await source.list({ sort, page: 1, pageSize: PAGE_SIZE })
  const pageCount = Math.max(1, Math.ceil(first.total / PAGE_SIZE))
  const seen = first.items.map(item => item.id)

  for (let page = 2; page <= pageCount; page++) {
    const result = await source.list({ sort, page, pageSize: PAGE_SIZE })
    seen.push(...result.items.map(item => item.id))
  }

  return seen
}

describe('paging through a history whose ties straddle the page boundaries', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(SORTS)('shows every row exactly once across all pages, under %s', async sort => {
    for (const [name, make] of sources) {
      const walked = await walkAllPages(make(), sort)

      expect(walked, `${name}: a row was repeated or lost`).toHaveLength(SCENARIO.length)
      expect(new Set(walked).size, `${name}: a row appeared on two pages`).toBe(SCENARIO.length)
      expect([...walked].sort(), `${name}: a row was skipped entirely`).toEqual(
        SCENARIO.map(row => row.id).sort()
      )
    }
  })

  it.each(SORTS)('puts the same row in the same slot in both sources, under %s', async sort => {
    const [mockWalk, httpWalk] = await Promise.all([
      walkAllPages(mockSource(), sort),
      walkAllPages(httpSource(), sort)
    ])

    expect(httpWalk).toEqual(mockWalk)
  })

  it.each(SORTS)('never straddles a boundary with an unstable pair, under %s', async sort => {
    // The last row of one page and the first of the next are the pair a broken tie-break
    // swaps. Reading page N twice must not move them, and page N+1 must not repeat them.
    for (const [name, make] of sources) {
      const source = make()

      for (let page = 1; page < Math.ceil(SCENARIO.length / PAGE_SIZE); page++) {
        const [once, twice, next] = [
          await source.list({ sort, page, pageSize: PAGE_SIZE }),
          await source.list({ sort, page, pageSize: PAGE_SIZE }),
          await source.list({ sort, page: page + 1, pageSize: PAGE_SIZE })
        ]

        expect(twice.items.map(i => i.id), `${name} page ${page} re-read`).toEqual(
          once.items.map(i => i.id)
        )
        for (const row of next.items) {
          expect(once.items.map(i => i.id), `${name} page ${page + 1} repeated a row`).not.toContain(
            row.id
          )
        }
      }
    }
  })

  it('answers a page past the last one with an empty page and the true total', async () => {
    for (const [name, make] of sources) {
      const result = await make().list({ sort: 'grade-desc', page: 99, pageSize: PAGE_SIZE })

      // Not an error and not a silent clamp back to the last page: an empty page with a
      // real total is what lets a client notice it overshot and correct itself.
      expect(result.items, `${name}`).toEqual([])
      expect(result.total, `${name}`).toBe(SCENARIO.length)
    }
  })
})
