import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_HISTORY_ENTRIES,
  MAX_PAGE_SIZE,
  clearHistory,
  createHttpReportHistorySource,
  createMockReportHistorySource,
  loadHistoryEntries
} from './report-history.service'
import { clearSnapshot, loadSnapshot, saveSnapshot } from './session-storage.service'
import type {
  ReportHistoryQuery,
  ReportHistorySource
} from './report-history.service'
import type { InterviewConfig, InterviewSession, Report } from '@/types/interview'

/*
 * QA adversarial pass on mock-mode history (plan 013, named risk #1).
 *
 * report-history.service.spec.ts proves the new entry gets added. This file asks the
 * other, harder question: do the OLD ones survive — intact, in order, and untouched by
 * the resumable-session snapshot that lives one key away.
 */

const BASE_URL = 'http://localhost:3001'
const HISTORY_KEY = 'interview-history-v1'
const SNAPSHOT_KEY = 'interview-session-v1'

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

/**
 * The ids on one page. Defaults to a page wide enough for anything these tests seed, so
 * a case about eviction or filtering is never accidentally a case about paging.
 */
async function pageIds(source: ReportHistorySource, query: ReportHistoryQuery = {}): Promise<string[]> {
  const { items } = await source.list({ pageSize: MAX_PAGE_SIZE, ...query })
  return items.map(item => item.id)
}

/** Distinct enough that a mix-up between two entries is visible, not plausible. */
function seedEntry(source: ReportHistorySource, index: number) {
  source.record(
    makeSession({
      id: `past-${index}`,
      createdAt: `2026-06-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
      config: makeConfig({ questionCount: index + 1 })
    }),
    makeReport(index)
  )
}

describe('recording a new interview does not disturb the ones already recorded', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('leaves every earlier entry byte-for-byte intact', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 5; i++) seedEntry(source, i)

    const before = loadHistoryEntries()

    source.record(makeSession({ id: 'brand-new' }), makeReport(99))

    const after = loadHistoryEntries()
    // The five originals must be the same objects, in the same order, with the new
    // one appended — not re-serialized, re-ordered, or partially rewritten.
    expect(after.slice(0, 5)).toEqual(before)
    expect(after).toHaveLength(6)
    expect(after[5].session.id).toBe('brand-new')
  })

  it('keeps all ten after ten interviews in a row, each with its own grade', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 10; i++) seedEntry(source, i)

    const { items, total } = await source.list({ pageSize: MAX_PAGE_SIZE })

    expect(total).toBe(10)
    expect(items).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      const found = items.find(item => item.id === `past-${i}`)
      expect(found?.overallGrade).toBe(i)
      expect(found?.config.questionCount).toBe(i + 1)
    }
  })

  it('can still open every earlier entry in full detail afterwards', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 6; i++) seedEntry(source, i)
    source.record(makeSession({ id: 'latest' }), makeReport(100))

    for (let i = 0; i < 6; i++) {
      const detail = await source.getDetail(`past-${i}`)
      expect(detail?.report.overallGrade).toBe(i)
      expect(detail?.session.config.questionCount).toBe(i + 1)
    }
  })

  it('survives a storage failure mid-write with the earlier history still readable', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 3; i++) seedEntry(source, i)

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })

    // A failed record is silent by design — but it must not take the history with it.
    expect(() => source.record(makeSession({ id: 'doomed' }), makeReport())).not.toThrow()

    setItem.mockRestore()
    await expect(pageIds(source)).resolves.toEqual(['past-2', 'past-1', 'past-0'])
  })
})

describe('the cap evicts the oldest, never the newest or an arbitrary one', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('drops entries strictly in the order they were recorded', async () => {
    const source = createMockReportHistorySource()
    // Ten past the cap, so eviction has to happen repeatedly rather than once.
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 10; i++) {
      source.record(makeSession({ id: `s${i}` }), makeReport())
    }

    const stored = loadHistoryEntries().map(entry => entry.session.id)
    const expected = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => `s${i + 10}`)

    // Exactly the last 50 recorded, in recording order: the ten oldest, and only
    // those ten, are gone.
    expect(stored).toEqual(expected)
  })

  it('never exceeds the cap however many interviews are finished', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < MAX_HISTORY_ENTRIES * 3; i++) {
      source.record(makeSession({ id: `s${i}` }), makeReport())
      expect(loadHistoryEntries().length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES)
    }

    await expect(source.list()).resolves.toMatchObject({ total: MAX_HISTORY_ENTRIES })
  })

  it('keeps the newest entry even when it is the one that triggered the eviction', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
      source.record(makeSession({ id: `s${i}` }), makeReport())
    }

    source.record(makeSession({ id: 'the-one-just-finished' }), makeReport(93))

    const detail = await source.getDetail('the-one-just-finished')
    expect(detail?.report.overallGrade).toBe(93)
    expect(await source.getDetail('s0')).toBeNull()
  })

  it('does not let display order decide eviction order', async () => {
    const source = createMockReportHistorySource()
    // Recorded oldest-createdAt last: the list shows it bottom, but it was recorded
    // most recently, so eviction must spare it.
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
      source.record(makeSession({ id: `s${i}`, createdAt: '2026-08-14T10:00:00.000Z' }), makeReport())
    }
    source.record(makeSession({ id: 'old-date-new-record', createdAt: '2020-01-01T00:00:00.000Z' }), makeReport())

    const ids = await pageIds(source)
    expect(ids[ids.length - 1]).toBe('old-date-new-record')
    expect(ids).not.toContain('s0')
  })
})

describe('history and the resumable snapshot are two independent keys', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses two different keys, and only those two', () => {
    const source = createMockReportHistorySource()
    source.record(makeSession({ id: 'past' }), makeReport())
    saveSnapshot({ source: 'mock', session: makeSession({ id: 'live' }), report: null })

    expect(Object.keys(localStorage).sort()).toEqual([HISTORY_KEY, SNAPSHOT_KEY].sort())
  })

  it('does not lose history when the live snapshot is written repeatedly', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 4; i++) seedEntry(source, i)

    // The store watches the live session and re-saves the snapshot on every change.
    for (let i = 0; i < 20; i++) {
      saveSnapshot({ source: 'mock', session: makeSession({ id: `live-${i}` }), report: null })
    }

    await expect(source.list()).resolves.toMatchObject({ total: 4 })
  })

  it('does not lose history when the live snapshot is cleared', async () => {
    const source = createMockReportHistorySource()
    for (let i = 0; i < 4; i++) seedEntry(source, i)
    saveSnapshot({ source: 'mock', session: makeSession({ id: 'live' }), report: null })

    // "Run another interview" clears the snapshot; history must be untouched.
    clearSnapshot()

    await expect(source.list()).resolves.toMatchObject({ total: 4 })
    expect(loadSnapshot()).toBeNull()
  })

  it('does not lose the live snapshot when history is cleared', () => {
    const source = createMockReportHistorySource()
    source.record(makeSession({ id: 'past' }), makeReport())
    saveSnapshot({ source: 'mock', session: makeSession({ id: 'live' }), report: null })

    clearHistory()

    expect(loadSnapshot()?.session.id).toBe('live')
  })

  it('reads no history out of a snapshot written into the wrong key', async () => {
    // A shape mix-up must degrade to "no history", never to a crash on /reports.
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ version: 1, source: 'mock', session: makeSession(), report: makeReport() })
    )

    await expect(createMockReportHistorySource().list()).resolves.toEqual({ items: [], total: 0 })
  })

  it('drops a single malformed entry without losing its well-formed neighbours', async () => {
    const good = { session: makeSession({ id: 'good' }), report: makeReport(), savedAt: 'x' }
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ version: 1, entries: [{ nonsense: true }, good, null] })
    )

    await expect(pageIds(createMockReportHistorySource())).resolves.toEqual(['good'])
  })
})

/*
 * Mock/http parity: the store and every view are written against ReportHistorySource
 * alone, so the two implementations have to answer the same logical question the same
 * way. Each case runs against both.
 */
describe('the two sources answer the same scenario the same way', () => {
  const fetchMock = vi.fn()

  const SCENARIO = [
    { id: 'a', createdAt: '2026-08-14T08:00:00.000Z', config: makeConfig() },
    { id: 'b', createdAt: '2026-08-15T08:00:00.000Z', config: makeConfig({ jobTitle: 'backend' }) },
    {
      id: 'c',
      createdAt: '2026-08-15T09:00:00.000Z',
      config: makeConfig({ level: 'senior', type: 'behavioral' })
    }
  ]

  /** `a` and `c` tie, so every one of the four orderings comes out distinguishable. */
  const GRADE: Record<string, number> = { a: 40, b: 90, c: 40 }

  type Row = { createdAt: string; overallGrade: number }

  /** What the API's ORDER BY has to do, written out so parity is checked, not assumed. */
  const SERVER_ORDER: Record<string, (x: Row, y: Row) => number> = {
    'date-desc': (x, y) => y.createdAt.localeCompare(x.createdAt),
    'date-asc': (x, y) => x.createdAt.localeCompare(y.createdAt),
    'grade-desc': (x, y) => y.overallGrade - x.overallGrade || y.createdAt.localeCompare(x.createdAt),
    'grade-asc': (x, y) => x.overallGrade - y.overallGrade || y.createdAt.localeCompare(x.createdAt)
  }

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockSource(): ReportHistorySource {
    const source = createMockReportHistorySource()
    for (const entry of SCENARIO) source.record(makeSession(entry), makeReport(GRADE[entry.id]))
    return source
  }

  /**
   * The http source's server, answering the same scenario with the real filter, ordering
   * and paging rules — including `total` counting the filtered set, not the page.
   */
  function httpSource(): ReportHistorySource {
    fetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url)

      if (parsed.pathname === '/api/interview') {
        const filters = Object.fromEntries(parsed.searchParams) as Record<string, string>
        const matching = SCENARIO.filter(
          entry =>
            (!filters.date || entry.createdAt.slice(0, 10) === filters.date) &&
            (!filters.jobTitle || entry.config.jobTitle === filters.jobTitle) &&
            (!filters.level || entry.config.level === filters.level) &&
            (!filters.type || entry.config.type === filters.type)
        )
          .map(entry => ({
            id: entry.id,
            config: entry.config,
            createdAt: entry.createdAt,
            overallGrade: GRADE[entry.id]
          }))
          .sort(SERVER_ORDER[filters.sort ?? 'date-desc'])

        // ORDER BY over the whole filtered set, then LIMIT/OFFSET — never the reverse.
        const size = Number(filters.pageSize ?? 10)
        const start = (Number(filters.page ?? 1) - 1) * size

        return {
          ok: true,
          status: 200,
          json: async () => ({ interviews: matching.slice(start, start + size), total: matching.length })
        } as Response
      }

      const id = parsed.pathname.split('/')[3]
      const entry = SCENARIO.find(item => item.id === id)
      if (!entry) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { code: 'NOT_FOUND', message: 'No interview found.' } })
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () =>
          parsed.pathname.endsWith('/report') ? makeReport(GRADE[entry.id]) : makeSession(entry)
      } as Response
    })

    return createHttpReportHistorySource(BASE_URL)
  }

  const sources: Array<[string, () => ReportHistorySource]> = [
    ['mock', mockSource],
    ['http', httpSource]
  ]

  it.each([
    ['no filter at all', {}, ['c', 'b', 'a']],
    ['a single calendar day', { date: '2026-08-14' }, ['a']],
    ['a day with two interviews on it', { date: '2026-08-15' }, ['c', 'b']],
    ['a job title', { jobTitle: 'backend' }, ['b']],
    ['an experience level', { level: 'senior' }, ['c']],
    ['an interview type', { type: 'behavioral' }, ['c']],
    ['every filter at once', { date: '2026-08-15', jobTitle: 'frontend', level: 'senior', type: 'behavioral' }, ['c']],
    ['a filter combination nothing matches', { jobTitle: 'devops' }, []],
    ['a contradictory combination', { jobTitle: 'backend', level: 'senior' }, []]
  ] as Array<[string, ReportHistoryQuery, string[]]>)(
    'both sources return the same ids for %s',
    async (_label, query, expected) => {
      for (const [name, make] of sources) {
        const { items, total } = await make().list(query)
        expect(items.map(item => item.id), `${name} source`).toEqual(expected)
        expect(total, `${name} source total`).toBe(expected.length)
      }
    }
  )

  /**
   * The plan's named risk: if the SQL ORDER BY and the mock's comparator disagree, a page
   * boundary shows a duplicate or skips a row. `a` and `c` tie on grade, so the tie-break
   * is doing the work in both grade directions.
   */
  it.each([
    ['date-desc', ['c', 'b', 'a']],
    ['date-asc', ['a', 'b', 'c']],
    ['grade-desc', ['b', 'c', 'a']],
    ['grade-asc', ['c', 'a', 'b']]
  ] as Array<[ReportHistoryQuery['sort'], string[]]>)(
    'both sources order %s identically, tie-break included',
    async (sort, expected) => {
      for (const [name, make] of sources) {
        const { items } = await make().list({ sort })
        expect(items.map(item => item.id), `${name} source`).toEqual(expected)
      }
    }
  )

  /** One row per page over the same ordering: every page must agree, not just the first. */
  it('both sources cut the same rows onto the same pages', async () => {
    for (const [name, make] of sources) {
      const source = make()

      for (const [page, expected] of [[1, ['b']], [2, ['c']], [3, ['a']], [4, []]] as const) {
        const result = await source.list({ sort: 'grade-desc', page, pageSize: 1 })

        expect(result.items.map(item => item.id), `${name} source page ${page}`).toEqual([...expected])
        // `total` is the filtered set on every page, never the size of the page itself.
        expect(result.total, `${name} source page ${page} total`).toBe(3)
      }
    }
  })

  it('both sources page the filtered set rather than the whole history', async () => {
    for (const [name, make] of sources) {
      const result = await make().list({ date: '2026-08-15', page: 2, pageSize: 1 })

      expect(result.items.map(item => item.id), `${name} source`).toEqual(['b'])
      expect(result.total, `${name} source`).toBe(2)
    }
  })

  it('both return null, not a throw, for an id that does not exist', async () => {
    for (const [name, make] of sources) {
      const source = make()
      await expect(source.getDetail('never-existed'), name).resolves.toBeNull()
    }
  })

  it('both return null for an id that is empty, weird, or path-shaped', async () => {
    for (const [name, make] of sources) {
      const source = make()
      for (const id of ['', '../../etc/passwd', '%00', 'x'.repeat(500)]) {
        await expect(source.getDetail(id), `${name} / ${JSON.stringify(id.slice(0, 20))}`).resolves.toBeNull()
      }
    }
  })

  it('both return a detail whose grade matches the grade its list row showed', async () => {
    for (const [name, make] of sources) {
      const source = make()
      const [row] = (await source.list({ jobTitle: 'backend' })).items
      const detail = await source.getDetail(row.id)

      expect(detail?.report.overallGrade, name).toBe(row.overallGrade)
    }
  })

  it('both survive being asked the same question ten times over', async () => {
    for (const [name, make] of sources) {
      const source = make()
      const results = await Promise.all(
        Array.from({ length: 10 }, () => source.list({ date: '2026-08-15' }))
      )

      for (const result of results) {
        expect(result.items.map(item => item.id), name).toEqual(['c', 'b'])
      }
    }
  })
})
