import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  MAX_HISTORY_ENTRIES,
  MAX_PAGE_SIZE,
  REPORT_SORTS,
  clearHistory,
  createHttpReportHistorySource,
  createMockReportHistorySource,
  loadHistoryEntries
} from './report-history.service'
import { InterviewError } from './interview.service'
import type { ReportHistorySource } from './report-history.service'
import type { InterviewConfig, InterviewSession, Report } from '@/types/interview'

const BASE_URL = 'http://localhost:3001'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3, ...overrides }
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 'session-1',
    config: makeConfig(),
    createdAt: '2026-08-14T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: [],
    ...overrides
  }
}

function makeReport(overallGrade = 80): Report {
  return {
    overallGrade,
    headline: 'Headline',
    strengths: ['Clear'],
    improvements: ['Depth'],
    entries: []
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** The ids on one page, in the order the source put them there. */
async function pageIds(
  source: ReportHistorySource,
  query: Parameters<ReportHistorySource['list']>[0] = {}
): Promise<string[]> {
  return (await source.list(query)).items.map(item => item.id)
}

describe('mock report history source', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('lists a recorded interview as a summary of its session and report', async () => {
    const source = createMockReportHistorySource()
    source.record(makeSession(), makeReport(72))

    const { items, total } = await source.list()

    expect(items).toEqual([
      {
        id: 'session-1',
        config: makeConfig(),
        createdAt: '2026-08-14T10:00:00.000Z',
        overallGrade: 72
      }
    ])
    expect(total).toBe(1)
  })

  it('lists nothing at all before any interview has been finished', async () => {
    const source = createMockReportHistorySource()

    await expect(source.list()).resolves.toEqual({ items: [], total: 0 })
  })

  it('orders the list newest first, whatever order entries were recorded in', async () => {
    const source = createMockReportHistorySource()
    source.record(makeSession({ id: 'older', createdAt: '2026-08-10T09:00:00.000Z' }), makeReport())
    source.record(makeSession({ id: 'newest', createdAt: '2026-08-15T09:00:00.000Z' }), makeReport())
    source.record(makeSession({ id: 'middle', createdAt: '2026-08-12T09:00:00.000Z' }), makeReport())

    await expect(pageIds(source)).resolves.toEqual(['newest', 'middle', 'older'])
  })

  describe('filtering, matching the API filter semantics exactly', () => {
    /** One entry per distinguishing field, so each filter has something to exclude. */
    function seed() {
      const source = createMockReportHistorySource()

      source.record(
        makeSession({ id: 'a', createdAt: '2026-08-14T08:00:00.000Z', config: makeConfig() }),
        makeReport()
      )
      source.record(
        makeSession({
          id: 'b',
          createdAt: '2026-08-15T08:00:00.000Z',
          config: makeConfig({ jobTitle: 'backend' })
        }),
        makeReport()
      )
      source.record(
        makeSession({
          id: 'c',
          createdAt: '2026-08-15T09:00:00.000Z',
          config: makeConfig({ level: 'senior', type: 'behavioral' })
        }),
        makeReport()
      )

      return source
    }

    it('narrows to a single calendar day on date', async () => {
      await expect(pageIds(seed(), { date: '2026-08-14' })).resolves.toEqual(['a'])
    })

    it('narrows on job title alone', async () => {
      await expect(pageIds(seed(), { jobTitle: 'backend' })).resolves.toEqual(['b'])
    })

    it('narrows on experience level alone', async () => {
      await expect(pageIds(seed(), { level: 'senior' })).resolves.toEqual(['c'])
    })

    it('narrows on interview type alone', async () => {
      await expect(pageIds(seed(), { type: 'behavioral' })).resolves.toEqual(['c'])
    })

    it('combines several filters with AND', async () => {
      const ids = await pageIds(seed(), {
        date: '2026-08-15',
        jobTitle: 'frontend',
        level: 'senior',
        type: 'behavioral'
      })

      expect(ids).toEqual(['c'])
    })

    it('returns an empty page, not everything, when nothing matches', async () => {
      const page = await seed().list({ date: '2026-08-15', jobTitle: 'devops' })

      expect(page).toEqual({ items: [], total: 0 })
    })

    /** `total` counts the filtered set, so the pager sizes itself to the filter. */
    it('counts only what the filters matched, not the whole history', async () => {
      const page = await seed().list({ date: '2026-08-15' })

      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(2)
    })

    it('matches the UTC calendar day, the same day the API filters on', async () => {
      const source = createMockReportHistorySource()
      // Late-evening UTC: a local-time reading would file this under the 15th.
      source.record(makeSession({ id: 'late', createdAt: '2026-08-14T23:30:00.000Z' }), makeReport())

      await expect(pageIds(source, { date: '2026-08-14' })).resolves.toHaveLength(1)
      await expect(pageIds(source, { date: '2026-08-15' })).resolves.toHaveLength(0)
    })
  })

  /**
   * The mock has to order and slice exactly as the API's `ORDER BY ... LIMIT/OFFSET`
   * does, or the same interview would sit on a different page in each mode.
   */
  describe('ordering', () => {
    /** Dates and grades disagree, and 'mid-60'/'old-60' tie on grade so the tie-break shows. */
    function seedMixed() {
      const source = createMockReportHistorySource()
      const rows: Array<[string, string, number]> = [
        ['new-45', '2026-08-13T10:00:00.000Z', 45],
        ['top-90', '2026-08-12T10:00:00.000Z', 90],
        ['mid-60', '2026-08-11T10:00:00.000Z', 60],
        ['old-60', '2026-08-10T10:00:00.000Z', 60]
      ]

      for (const [id, createdAt, grade] of rows) {
        source.record(makeSession({ id, createdAt }), makeReport(grade))
      }

      return source
    }

    it.each([
      ['date-desc', ['new-45', 'top-90', 'mid-60', 'old-60']],
      ['date-asc', ['old-60', 'mid-60', 'top-90', 'new-45']],
      ['grade-desc', ['top-90', 'mid-60', 'old-60', 'new-45']],
      ['grade-asc', ['new-45', 'mid-60', 'old-60', 'top-90']]
    ] as const)('orders on %s', async (sort, expected) => {
      await expect(pageIds(seedMixed(), { sort })).resolves.toEqual([...expected])
    })

    it('falls back to newest first when no ordering is asked for', async () => {
      await expect(pageIds(seedMixed())).resolves.toEqual(await pageIds(seedMixed(), { sort: 'date-desc' }))
    })

    /** A grade tie broken by the older row would let a page boundary duplicate or skip one. */
    it('breaks a grade tie by the newer interview in both grade directions', async () => {
      const source = seedMixed()

      const desc = await pageIds(source, { sort: 'grade-desc' })
      const asc = await pageIds(source, { sort: 'grade-asc' })

      expect(desc.indexOf('mid-60')).toBeLessThan(desc.indexOf('old-60'))
      expect(asc.indexOf('mid-60')).toBeLessThan(asc.indexOf('old-60'))
    })

    it('keeps every row under every ordering, dropping and duplicating none', async () => {
      const source = seedMixed()

      for (const sort of REPORT_SORTS) {
        const ids = await pageIds(source, { sort, pageSize: MAX_PAGE_SIZE })
        expect([...ids].sort()).toEqual(['mid-60', 'new-45', 'old-60', 'top-90'])
      }
    })
  })

  describe('paging', () => {
    const DAY_MS = 86_400_000

    /** `p00`…`p24`, one per day, so the newest-first order is `p24` down to `p00`. */
    function seedPages(count = 25) {
      const source = createMockReportHistorySource()

      for (let i = 0; i < count; i++) {
        source.record(
          makeSession({
            id: `p${String(i).padStart(2, '0')}`,
            createdAt: new Date(Date.UTC(2026, 0, 1) + i * DAY_MS).toISOString()
          }),
          makeReport(i)
        )
      }

      return source
    }

    it('returns only the first page by default, with the full count beside it', async () => {
      const page = await seedPages().list()

      expect(page.items).toHaveLength(DEFAULT_PAGE_SIZE)
      expect(page.total).toBe(25)
      expect(page.items[0].id).toBe('p24')
    })

    it('cuts consecutive, non-overlapping pages out of one ordering', async () => {
      const source = seedPages()

      const first = await pageIds(source, { page: 1, pageSize: 10 })
      const second = await pageIds(source, { page: 2, pageSize: 10 })
      const third = await pageIds(source, { page: 3, pageSize: 10 })

      expect(first).toHaveLength(10)
      expect(second).toHaveLength(10)
      // 25 rows over three pages of ten: the last one is the remainder, not a full page.
      expect(third).toHaveLength(5)
      expect(new Set([...first, ...second, ...third]).size).toBe(25)
      expect(first[0]).toBe('p24')
      expect(third[4]).toBe('p00')
    })

    it('pages through the chosen ordering, not the default one', async () => {
      const source = seedPages()

      const first = await pageIds(source, { sort: 'date-asc', page: 1, pageSize: 3 })
      const second = await pageIds(source, { sort: 'date-asc', page: 2, pageSize: 3 })

      expect(first).toEqual(['p00', 'p01', 'p02'])
      expect(second).toEqual(['p03', 'p04', 'p05'])
    })

    it('reports the total independently of the page it was asked for', async () => {
      const source = seedPages()

      for (const page of [1, 2, 3, 99]) {
        await expect(source.list({ page, pageSize: 10 })).resolves.toMatchObject({ total: 25 })
      }
    })

    it('answers a page past the end with no rows rather than the last page', async () => {
      const page = await seedPages().list({ page: 99, pageSize: 10 })

      expect(page.items).toEqual([])
      expect(page.total).toBe(25)
    })

    it('counts every match even when one page holds them all', async () => {
      const page = await seedPages(4).list({ pageSize: 10 })

      expect(page.items).toHaveLength(4)
      expect(page.total).toBe(4)
    })

    it('pages the filtered set, not the whole history', async () => {
      const source = createMockReportHistorySource()
      for (let i = 0; i < 12; i++) {
        source.record(
          makeSession({ id: `f${i}`, config: makeConfig({ jobTitle: i < 3 ? 'devops' : 'frontend' }) }),
          makeReport()
        )
      }

      const page = await source.list({ jobTitle: 'devops', pageSize: 2 })

      expect(page.items).toHaveLength(2)
      expect(page.total).toBe(3)
    })

    /** A mock cannot answer 400, so an impossible page size clamps into range instead. */
    it.each([
      [0, 1],
      [-5, 1],
      [999, MAX_PAGE_SIZE],
      [Number.NaN, DEFAULT_PAGE_SIZE]
    ])('clamps a pageSize of %s rather than reading unbounded', async (pageSize, expected) => {
      const page = await seedPages(MAX_PAGE_SIZE).list({ pageSize })

      expect(page.items).toHaveLength(expected)
    })

    it.each([0, -3, Number.NaN])('reads the first page for a page of %s', async page => {
      const ids = await pageIds(seedPages(), { page, pageSize: 5 })

      expect(ids[0]).toBe('p24')
    })
  })

  describe('bounded growth', () => {
    it('keeps appending up to the cap without dropping anything', async () => {
      const source = createMockReportHistorySource()

      for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
        source.record(makeSession({ id: `s${i}` }), makeReport())
      }

      await expect(source.list()).resolves.toMatchObject({ total: MAX_HISTORY_ENTRIES })
    })

    it('drops the oldest entry once the cap is passed, and keeps the newest', async () => {
      const source = createMockReportHistorySource()

      for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
        source.record(makeSession({ id: `s${i}` }), makeReport())
      }

      // One page wide enough for the whole cap, so eviction is what decides the ids.
      const ids = await pageIds(source, { pageSize: MAX_PAGE_SIZE })
      expect(ids).toHaveLength(MAX_HISTORY_ENTRIES)
      expect(ids).toContain(`s${MAX_HISTORY_ENTRIES + 4}`)
      expect(ids).not.toContain('s0')
      expect(ids).not.toContain('s4')
      expect(ids).toContain('s5')
    })

    it('replaces rather than duplicates when the same interview is recorded twice', async () => {
      const source = createMockReportHistorySource()

      source.record(makeSession(), makeReport(40))
      source.record(makeSession(), makeReport(90))

      const { items, total } = await source.list()
      expect(total).toBe(1)
      expect(items[0].overallGrade).toBe(90)
    })

    it('keeps its own key, so the resumable snapshot and the history do not overwrite each other', async () => {
      const { saveSnapshot, loadSnapshot } = await import('./session-storage.service')
      const source = createMockReportHistorySource()

      saveSnapshot({ source: 'mock', session: makeSession({ id: 'live' }), report: null })
      source.record(makeSession({ id: 'past' }), makeReport())

      expect(loadSnapshot()?.session.id).toBe('live')
      await expect(source.list()).resolves.toMatchObject({ total: 1 })
    })
  })

  describe('detail', () => {
    it('returns the full recorded session and report for a known id', async () => {
      const source = createMockReportHistorySource()
      const session = makeSession({ asked: [], answers: [] })
      source.record(session, makeReport(65))

      const detail = await source.getDetail('session-1')

      expect(detail?.session.id).toBe('session-1')
      expect(detail?.report.overallGrade).toBe(65)
    })

    it('returns null for an id that was never recorded', async () => {
      const source = createMockReportHistorySource()
      source.record(makeSession(), makeReport())

      await expect(source.getDetail('nope')).resolves.toBeNull()
    })

    it('does not hand out a live reference that a later answer could rewrite', async () => {
      const source = createMockReportHistorySource()
      const session = makeSession()
      source.record(session, makeReport())

      session.config.jobTitle = 'devops'

      const detail = await source.getDetail('session-1')
      expect(detail?.session.config.jobTitle).toBe('frontend')
    })
  })

  describe('storage that cannot be trusted', () => {
    it('reads unparseable history as no history rather than throwing', async () => {
      localStorage.setItem('interview-history-v1', '{not json')

      await expect(createMockReportHistorySource().list()).resolves.toEqual({ items: [], total: 0 })
    })

    it('ignores entries written by an older, differently shaped version', async () => {
      localStorage.setItem(
        'interview-history-v1',
        JSON.stringify({ version: 0, entries: [{ session: makeSession(), report: makeReport() }] })
      )

      await expect(createMockReportHistorySource().list()).resolves.toEqual({ items: [], total: 0 })
    })

    it('forgets everything once the history is cleared', async () => {
      const source = createMockReportHistorySource()
      source.record(makeSession(), makeReport())

      clearHistory()

      expect(loadHistoryEntries()).toEqual([])
    })
  })
})

describe('http report history source', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads one page out of the interviews-and-total envelope from GET /api/interview', async () => {
    const summary = {
      id: 's1',
      config: makeConfig(),
      createdAt: '2026-08-14T10:00:00.000Z',
      overallGrade: 80
    }
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [summary], total: 37 }))

    const result = await createHttpReportHistorySource(BASE_URL).list()

    // `total` is the whole filtered set, not this page — the pager is built from it.
    expect(result).toEqual({ items: [summary], total: 37 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/interview`)
  })

  it('sends every active filter as a query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await createHttpReportHistorySource(BASE_URL).list({
      date: '2026-08-14',
      jobTitle: 'backend',
      level: 'senior',
      type: 'system-design'
    })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/interview')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      date: '2026-08-14',
      jobTitle: 'backend',
      level: 'senior',
      type: 'system-design'
    })
  })

  it('sends the ordering and the page alongside the filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await createHttpReportHistorySource(BASE_URL).list({
      jobTitle: 'backend',
      sort: 'grade-asc',
      page: 3,
      pageSize: 10
    })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      jobTitle: 'backend',
      sort: 'grade-asc',
      page: '3',
      pageSize: '10'
    })
  })

  /** An omitted paging value takes the server's own default rather than a guessed one. */
  it('omits sort, page and pageSize entirely when none was chosen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await createHttpReportHistorySource(BASE_URL).list({ jobTitle: 'data' })

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/interview?jobTitle=data`)
  })

  /** `?jobTitle=` is a 400 on this API, not "no filter" — an unset filter must be absent. */
  it('omits an unset filter entirely rather than sending it empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await createHttpReportHistorySource(BASE_URL).list({ jobTitle: 'data', sort: 'date-desc' })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.has('date')).toBe(false)
    expect(url.searchParams.has('level')).toBe(false)
    expect(url.searchParams.has('type')).toBe(false)
  })

  it('carries credentials, or every list call would 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await createHttpReportHistorySource(BASE_URL).list()

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('reports an empty page as a successful nothing, not a failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { interviews: [], total: 0 }))

    await expect(createHttpReportHistorySource(BASE_URL).list({ page: 9 })).resolves.toEqual({
      items: [],
      total: 0
    })
  })

  it('builds a detail from the two existing single-interview endpoints', async () => {
    const session = makeSession({ id: 'abc' })
    const report = makeReport(91)
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/report') ? jsonResponse(200, report) : jsonResponse(200, session)
      )
    )

    const detail = await createHttpReportHistorySource(BASE_URL).getDetail('abc')

    expect(detail).toEqual({ session, report })
    expect(fetchMock.mock.calls.map(call => call[0]).sort()).toEqual([
      `${BASE_URL}/api/interview/abc`,
      `${BASE_URL}/api/interview/abc/report`
    ])
  })

  it('reads a NOT_FOUND detail as null, so the view can show a clear empty state', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No interview found.' } })
    )

    await expect(createHttpReportHistorySource(BASE_URL).getDetail('gone')).resolves.toBeNull()
  })

  it('reads an interview with nothing evaluated as null too', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { error: { code: 'NO_EVALUATION', message: 'Nothing evaluated yet.' } })
    )

    await expect(createHttpReportHistorySource(BASE_URL).getDetail('empty')).resolves.toBeNull()
  })

  it('surfaces a real failure rather than pretending the report is missing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom.' } })
    )

    await expect(createHttpReportHistorySource(BASE_URL).getDetail('x')).rejects.toBeInstanceOf(
      InterviewError
    )
  })

  it('maps a failed list into an InterviewError carrying the backend code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Bad date.' } })
    )

    await expect(createHttpReportHistorySource(BASE_URL).list({ date: 'nope' })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR', message: 'Bad date.' }
    )
  })

  it('records nothing locally: the server already persisted the interview', async () => {
    createHttpReportHistorySource(BASE_URL).record(makeSession(), makeReport())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('interview-history-v1')).toBeNull()
  })
})
