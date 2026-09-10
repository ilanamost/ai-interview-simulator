import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_REPORT_SORT,
  PAGE_SIZE,
  REPORT_SORTS,
  useReportHistoryStore,
  type ReportHistorySort
} from './report-history.store'
import type {
  ReportHistoryDetail,
  ReportHistoryPage,
  ReportHistoryQuery,
  ReportHistorySource
} from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'

/**
 * QA adversarial pass on ordering and paging.
 *
 * Plan 015 made sorting a client-side reorder of every row the store held; plan 018 made
 * it a server concern, because a page can only be cut out of an ordering the server
 * already applied. So the questions here changed with it: not "does the comparator hold
 * up" — that moved to `report-history.service.spec.ts` — but "does the store ask for the
 * right thing, land the right answer, and never strand the user on a page that is gone".
 */

function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id: 'i1',
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80,
    ...overrides
  }
}

/** Answers whatever the caller asked for, and remembers every query it was sent. */
function makeStubSource(all: InterviewSummary[]) {
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    async list(query = {}) {
      listCalls.push(query)

      const size = query.pageSize ?? PAGE_SIZE
      const start = ((query.page ?? 1) - 1) * size

      return { items: all.slice(start, start + size), total: all.length }
    },
    async getDetail(): Promise<ReportHistoryDetail | null> {
      return null
    },
    record: vi.fn()
  }

  return { source, listCalls }
}

/** A source that hands back control over when each read settles, so a race is reproducible. */
function makeDeferredSource() {
  const pending: ((page: ReportHistoryPage) => void)[] = []
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    list(query = {}) {
      listCalls.push(query)
      return new Promise<ReportHistoryPage>(resolve => {
        pending.push(resolve)
      })
    },
    async getDetail(): Promise<ReportHistoryDetail | null> {
      return null
    },
    record: vi.fn()
  }

  /** Settles the nth read with rows that count as the whole matching set. */
  function release(index: number, items: InterviewSummary[], total = items.length) {
    pending[index]({ items, total })
  }

  return { source, listCalls, release }
}

function idsOf(rows: InterviewSummary[]): string[] {
  return rows.map(row => row.id)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('asking the source for an ordering, rather than applying one', () => {
  /**
   * The invariant pagination introduced: the store must never reorder what it holds. It
   * holds ten of two hundred rows, so any local sort would be a lie about the other 190.
   */
  it('renders the source answer verbatim under every ordering', async () => {
    const rows = [
      makeSummary({ id: 'a', createdAt: '2026-08-10T10:00:00.000Z', overallGrade: 60 }),
      makeSummary({ id: 'b', createdAt: '2026-08-14T10:00:00.000Z', overallGrade: 0 }),
      makeSummary({ id: 'c', createdAt: '2026-08-12T10:00:00.000Z', overallGrade: 100 })
    ]
    const store = useReportHistoryStore()
    store.setSource(makeStubSource(rows).source)
    await store.fetchList()

    for (const sort of REPORT_SORTS) {
      await store.setSort(sort)
      expect(idsOf(store.list)).toEqual(['a', 'b', 'c'])
    }
  })

  it('sends every one of the four orderings through to the source unchanged', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource([makeSummary()])
    store.setSource(source)
    await store.fetchList()

    for (const sort of REPORT_SORTS) {
      await store.setSort(sort)
      expect(listCalls[listCalls.length - 1].sort).toBe(sort)
    }
  })

  it('carries the ordering on every later read, not just the one that set it', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource(
      Array.from({ length: 30 }, (_, i) => makeSummary({ id: `r${i}` }))
    )
    store.setSource(source)
    await store.fetchList()
    await store.setSort('grade-desc')

    await store.setPage(2)
    await store.fetchList({ level: 'senior' })

    for (const call of listCalls.slice(1)) expect(call.sort).toBe('grade-desc')
  })

  it('sends the default ordering explicitly, so the server never has to guess', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource([])
    store.setSource(source)

    await store.fetchList()

    expect(listCalls[0].sort).toBe(DEFAULT_REPORT_SORT)
  })

  /** Sort is a view preference, not a predicate — it must never make the page look filtered. */
  it('leaves `hasFilters` false however many times the ordering changes', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource([makeSummary()]).source)
    await store.fetchList()

    for (const sort of [...REPORT_SORTS].reverse()) {
      await store.setSort(sort)
      expect(store.hasFilters).toBe(false)
    }

    expect(store.filters).toEqual({})
  })

  it('orders an empty history without complaint, and without claiming a second page', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource([]).source)
    await store.fetchList()

    for (const sort of REPORT_SORTS) {
      await store.setSort(sort)
      expect(store.list).toEqual([])
      expect(store.total).toBe(0)
      expect(store.pageCount).toBe(1)
    }
  })
})

describe('a page that stops existing under the user', () => {
  const MANY = Array.from({ length: 25 }, (_, i) => makeSummary({ id: `row-${i}` }))

  /**
   * The failure the plan's "reset to page 1" rule exists to prevent: page 3 of an
   * unfiltered history, then a filter that leaves four rows. Staying on page 3 would
   * render an empty list under a "No interviews match these filters" that is a lie.
   */
  it('does not strand the user on a page a narrower filter removed', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource(MANY).source)
    await store.fetchList()
    await store.setPage(3)
    expect(store.page).toBe(3)

    // The narrower filter leaves four rows — one page — where there had been three.
    const narrowed = makeStubSource(MANY.slice(0, 4))
    store.setSource(narrowed.source)
    await store.fetchList({ jobTitle: 'devops' })

    expect(store.page).toBe(1)
    expect(store.list).toHaveLength(4)
    expect(narrowed.listCalls[0]).toMatchObject({ page: 1 })
  })

  it('does not strand the user on a page a new ordering shortened either', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource(MANY).source)
    await store.fetchList()
    await store.setPage(2)

    await store.setSort('grade-asc')

    expect(store.page).toBe(1)
    expect(store.list).toHaveLength(PAGE_SIZE)
  })

  /**
   * `setPage` clamps against the count it currently knows. Asked for a page past the end
   * it lands on the last real one rather than reading an empty page and blaming filters.
   */
  it('clamps to the last real page instead of reading past the end', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource(MANY)
    store.setSource(source)
    await store.fetchList()

    await store.setPage(9999)

    expect(store.page).toBe(3)
    expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 3 })
    expect(store.list).toHaveLength(5)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2.7])(
    'never asks the source for a page of %s',
    async asked => {
      const store = useReportHistoryStore()
      const { source, listCalls } = makeStubSource(MANY)
      store.setSource(source)
      await store.fetchList()

      await store.setPage(asked)

      const { page } = listCalls[listCalls.length - 1]
      expect(Number.isInteger(page)).toBe(true)
      expect(page).toBeGreaterThanOrEqual(1)
      expect(page).toBeLessThanOrEqual(store.pageCount)
    }
  )

  it('pages forward and back to exactly where it started', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource(MANY).source)
    await store.fetchList()
    const first = idsOf(store.list)

    await store.setPage(2)
    await store.setPage(3)
    await store.setPage(2)
    await store.setPage(1)

    expect(idsOf(store.list)).toEqual(first)
    expect(store.page).toBe(1)
  })

  /** An empty history has one page, not zero — "Page 1 of 0" would be nonsense. */
  it('never reports fewer than one page', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource([]).source)

    await store.fetchList()

    expect(store.pageCount).toBe(1)
    expect(store.page).toBe(1)
  })
})

describe('an ordering or page change racing the network', () => {
  /**
   * Sorting is a read now, so a sort chosen while a filter read is in flight SUPERSEDES
   * it: the older read answers a question nobody is asking any more. What must never
   * happen is the reverse — the straggler landing on top of the newer ordering.
   */
  it('lands the ordering the user chose last, not the read that answers last', async () => {
    const store = useReportHistoryStore()
    const { source, release } = makeDeferredSource()
    store.setSource(source)

    const filtered = store.fetchList({ jobTitle: 'backend' })
    const sorted = store.setSort('grade-asc')

    // The superseded read straggles in after the one that replaced it.
    release(1, [makeSummary({ id: 'by-grade' })])
    release(0, [makeSummary({ id: 'by-date' })])
    await Promise.all([filtered, sorted])

    expect(idsOf(store.list)).toEqual(['by-grade'])
    expect(store.sort).toBe('grade-asc')
    expect(store.isBusy).toBe(false)
  })

  it('keeps the filters of the read a sort change superseded', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls, release } = makeDeferredSource()
    store.setSource(source)

    const filtered = store.fetchList({ jobTitle: 'backend', level: 'senior' })
    const sorted = store.setSort('date-asc')

    release(1, [])
    release(0, [])
    await Promise.all([filtered, sorted])

    expect(listCalls[1]).toMatchObject({ jobTitle: 'backend', level: 'senior', sort: 'date-asc' })
    expect(store.filters).toEqual({ jobTitle: 'backend', level: 'senior' })
  })

  it('lands the page the user clicked last when two page reads overlap', async () => {
    const store = useReportHistoryStore()
    const { source, release } = makeDeferredSource()
    store.setSource(source)

    const first = store.fetchList()
    release(0, [makeSummary({ id: 'p1' })], 30)
    await first

    const second = store.setPage(2)
    const third = store.setPage(3)

    release(2, [makeSummary({ id: 'p3' })], 30)
    release(1, [makeSummary({ id: 'p2' })], 30)
    await Promise.all([second, third])

    expect(idsOf(store.list)).toEqual(['p3'])
    expect(store.page).toBe(3)
  })

  /** Every one of these reads really is a read: none may leave the screen stuck loading. */
  it('settles out of the loading state however the reads interleave', async () => {
    const store = useReportHistoryStore()
    const { source, release } = makeDeferredSource()
    store.setSource(source)

    const a = store.fetchList()
    const b = store.setSort('grade-desc')
    const c = store.fetchList({ level: 'junior' })

    release(0, [])
    release(2, [])
    release(1, [])
    await Promise.all([a, b, c])

    expect(store.isBusy).toBe(false)
    expect(store.status).toBe('ready')
    expect(store.error).toBeNull()
  })

  it('drops a sort and a page chosen mid-flight when reset clears the screen', async () => {
    const store = useReportHistoryStore()
    const { source, release } = makeDeferredSource()
    store.setSource(source)

    const inFlight = store.fetchList()
    const sorted = store.setSort('grade-desc')
    store.reset()

    release(0, [makeSummary({ id: 'late' })])
    release(1, [makeSummary({ id: 'later' })])
    await Promise.all([inFlight, sorted])

    expect(store.sort).toBe(DEFAULT_REPORT_SORT)
    expect(store.page).toBe(1)
    expect(store.total).toBe(0)
    expect(store.list).toEqual([])
    expect(store.status).toBe('idle')
  })

  it('hammers the ordering control without losing a row or the last choice', async () => {
    const store = useReportHistoryStore()
    const { source } = makeStubSource([makeSummary({ id: 'only' })])
    store.setSource(source)
    await store.fetchList()

    const every: ReportHistorySort[] = [...REPORT_SORTS, ...REPORT_SORTS, ...REPORT_SORTS]
    for (const sort of every) await store.setSort(sort)

    expect(store.sort).toBe(every[every.length - 1])
    expect(idsOf(store.list)).toEqual(['only'])
    expect(store.isBusy).toBe(false)
  })
})
