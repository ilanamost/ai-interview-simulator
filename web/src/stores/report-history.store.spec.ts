import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { PAGE_SIZE, useReportHistoryStore } from './report-history.store'
import { useAuthStore } from './auth.store'
import { InterviewError } from '@/services/interview.service'
import type {
  ReportHistoryDetail,
  ReportHistoryPage,
  ReportHistoryQuery,
  ReportHistorySource
} from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'

function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id: 'i1',
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80,
    ...overrides
  }
}

/** Minimal source recording what it was asked for, so the store is tested in isolation. */
function makeStubSource(
  options: {
    summaries?: InterviewSummary[]
    /** Defaults to "everything fits on this page", so a case about paging has to opt in. */
    total?: number
    detail?: ReportHistoryDetail | null
    failWith?: InterviewError
  } = {}
) {
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    async list(query = {}) {
      listCalls.push(query)
      if (options.failWith) throw options.failWith

      const items = options.summaries ?? []
      return { items, total: options.total ?? items.length }
    },
    async getDetail() {
      if (options.failWith) throw options.failWith
      return options.detail ?? null
    },
    record: vi.fn()
  }

  return { source, listCalls }
}

/** A source that really orders and slices, so the store's paging is exercised end to end. */
function makePagedSource(all: InterviewSummary[]) {
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    async list(query = {}) {
      listCalls.push(query)

      const ordered = [...all].sort((a, b) =>
        query.sort === 'grade-asc'
          ? a.overallGrade - b.overallGrade
          : b.createdAt.localeCompare(a.createdAt)
      )
      const size = query.pageSize ?? PAGE_SIZE
      const start = ((query.page ?? 1) - 1) * size

      return { items: ordered.slice(start, start + size), total: ordered.length }
    },
    async getDetail() {
      return null
    },
    record: vi.fn()
  }

  return { source, listCalls }
}

describe('report history store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts idle with nothing loaded and no filters', () => {
    const store = useReportHistoryStore()

    expect(store.status).toBe('idle')
    expect(store.list).toEqual([])
    expect(store.filters).toEqual({})
    expect(store.hasFilters).toBe(false)
  })

  it('loads the matching summaries into the list', async () => {
    const store = useReportHistoryStore()
    const { source } = makeStubSource({ summaries: [makeSummary(), makeSummary({ id: 'i2' })] })
    store.setSource(source)

    await store.fetchList()

    expect(store.list.map(item => item.id)).toEqual(['i1', 'i2'])
    expect(store.status).toBe('ready')
    expect(store.error).toBeNull()
  })

  it('passes the filters it was given straight through to the source', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource()
    store.setSource(source)

    await store.fetchList({ date: '2026-08-14', jobTitle: 'backend' })

    expect(listCalls[0]).toEqual({
      date: '2026-08-14',
      jobTitle: 'backend',
      sort: 'date-desc',
      page: 1,
      pageSize: PAGE_SIZE
    })
    expect(store.filters).toEqual({ date: '2026-08-14', jobTitle: 'backend' })
    expect(store.hasFilters).toBe(true)
  })

  /** Paging is a request parameter, not a slice of what came back. */
  it('asks for a page of a stated size on every read, never the whole history', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeStubSource()
    store.setSource(source)

    await store.fetchList()

    expect(listCalls[0]).toMatchObject({ page: 1, pageSize: PAGE_SIZE })
  })

  it('is busy only while a fetch is in flight', async () => {
    const store = useReportHistoryStore()
    const { source } = makeStubSource()
    store.setSource(source)

    const inFlight = store.fetchList()
    expect(store.isBusy).toBe(true)

    await inFlight
    expect(store.isBusy).toBe(false)
  })

  it('treats an empty result as a successful "nothing matches", not a failure', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource({ summaries: [] }).source)

    await store.fetchList({ jobTitle: 'devops' })

    expect(store.list).toEqual([])
    expect(store.error).toBeNull()
    expect(store.status).toBe('ready')
  })

  /** The UI owns toasts (plan 009), so the store records the message and rethrows. */
  it('records a user-safe message and rethrows when the list fails', async () => {
    const store = useReportHistoryStore()
    store.setSource(
      makeStubSource({ failWith: new InterviewError('INTERNAL_ERROR', 'Could not load.') }).source
    )

    await expect(store.fetchList()).rejects.toBeInstanceOf(InterviewError)

    expect(store.error).toBe('Could not load.')
    expect(store.status).toBe('ready')
    expect(store.isBusy).toBe(false)
  })

  it('drops the previous rows on failure rather than showing them under the new filter', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource({ summaries: [makeSummary()] }).source)
    await store.fetchList()

    store.setSource(makeStubSource({ failWith: new InterviewError('BOOM', 'Nope.') }).source)
    await expect(store.fetchList({ jobTitle: 'data' })).rejects.toBeInstanceOf(InterviewError)

    expect(store.list).toEqual([])
  })

  it('signs the user out when the history call reports the session is gone', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useReportHistoryStore()
    store.setSource(
      makeStubSource({ failWith: new InterviewError('UNAUTHENTICATED', 'Signed out.') }).source
    )

    await expect(store.fetchList()).rejects.toBeInstanceOf(InterviewError)

    expect(auth.isAuthenticated).toBe(false)
  })

  it('loads one past interview into detail', async () => {
    const store = useReportHistoryStore()
    const detail = {
      session: {
        id: 'i1',
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        createdAt: '2026-08-14T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      },
      report: { overallGrade: 77, headline: 'H', strengths: [], improvements: [], entries: [] }
    } as ReportHistoryDetail
    store.setSource(makeStubSource({ detail }).source)

    await store.fetchDetail('i1')

    expect(store.detail?.report.overallGrade).toBe(77)
    expect(store.isDetailMissing).toBe(false)
  })

  it('reports a missing detail without treating it as an error', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource({ detail: null }).source)

    await store.fetchDetail('nope')

    expect(store.detail).toBeNull()
    expect(store.error).toBeNull()
    expect(store.isDetailMissing).toBe(true)
  })

  it('does not call a detail missing before any read has settled', () => {
    const store = useReportHistoryStore()

    expect(store.isDetailMissing).toBe(false)
  })

  /**
   * `ReportsHistoryView` fires one read per filter change with no debounce, and nothing
   * makes the network answer in the order it was asked — so overlapping reads are
   * ordinary use, not an edge case, and only the newest may write.
   */
  describe('overlapping reads', () => {
    /** Hands back the resolver for each call, so the test settles them in any order. */
    function makeControllableSource() {
      const pending: ((rows: InterviewSummary[]) => void)[] = []

      const source: ReportHistorySource = {
        list() {
          return new Promise<ReportHistoryPage>(resolve => {
            pending.push(rows => resolve({ items: rows, total: rows.length }))
          })
        },
        async getDetail() {
          return null
        },
        record: vi.fn()
      }

      return { source, pending }
    }

    it('keeps the newest answer when an older read settles after it', async () => {
      const store = useReportHistoryStore()
      const { source, pending } = makeControllableSource()
      store.setSource(source)

      const first = store.fetchList({ jobTitle: 'frontend' })
      const second = store.fetchList({ jobTitle: 'backend' })

      pending[1]([makeSummary({ id: 'backend-row' })])
      pending[0]([makeSummary({ id: 'frontend-row' })])
      await Promise.all([first, second])

      expect(store.list.map(item => item.id)).toEqual(['backend-row'])
      expect(store.filters).toEqual({ jobTitle: 'backend' })
    })

    it('keeps the newest answer when the reads settle in order too', async () => {
      const store = useReportHistoryStore()
      const { source, pending } = makeControllableSource()
      store.setSource(source)

      const first = store.fetchList({ jobTitle: 'frontend' })
      const second = store.fetchList({ jobTitle: 'backend' })

      pending[0]([makeSummary({ id: 'frontend-row' })])
      pending[1]([makeSummary({ id: 'backend-row' })])
      await Promise.all([first, second])

      expect(store.list.map(item => item.id)).toEqual(['backend-row'])
      expect(store.isBusy).toBe(false)
    })

    it('stays loading until the read it is actually waiting on comes back', async () => {
      const store = useReportHistoryStore()
      const { source, pending } = makeControllableSource()
      store.setSource(source)

      const first = store.fetchList({ jobTitle: 'frontend' })
      store.fetchList({ jobTitle: 'backend' })

      pending[0]([])
      await first

      // The abandoned read answered; the screen is still waiting on the current one.
      expect(store.isBusy).toBe(true)

      pending[1]([])
      await flushPromises()
      expect(store.isBusy).toBe(false)
    })

    it('applies only the detail the user last opened', async () => {
      const store = useReportHistoryStore()
      const resolvers: ((value: ReportHistoryDetail | null) => void)[] = []
      store.setSource({
        async list() {
          return { items: [], total: 0 }
        },
        getDetail() {
          return new Promise<ReportHistoryDetail | null>(resolve => {
            resolvers.push(resolve)
          })
        },
        record: vi.fn()
      })

      const first = store.fetchDetail('report-a')
      const second = store.fetchDetail('report-b')

      resolvers[1](null)
      resolvers[0]({ session: { id: 'report-a' } as never, report: { overallGrade: 1 } as never })
      await Promise.all([first, second])

      expect(store.detail).toBeNull()
      expect(store.isDetailMissing).toBe(true)
    })

    /** Reset is the user walking away: a read still in flight must not undo it. */
    it('does not let a read in flight repopulate what reset just cleared', async () => {
      const store = useReportHistoryStore()
      const { source, pending } = makeControllableSource()
      store.setSource(source)

      const inFlight = store.fetchList({ jobTitle: 'frontend' })
      store.reset()
      pending[0]([makeSummary({ id: 'late-row' })])
      await inFlight

      expect(store.list).toEqual([])
      expect(store.status).toBe('idle')
    })
  })

  /**
   * Ordering is a server concern now: `list` is one page of the server's own ordering, so
   * re-sorting means asking for page 1 of a different ordering rather than shuffling rows.
   */
  describe('choosing the ordering', () => {
    it('starts on newest first, which is the order the sources already answer in', () => {
      expect(useReportHistoryStore().sort).toBe('date-desc')
    })

    it('records the chosen ordering and sends it on the next read', async () => {
      const store = useReportHistoryStore()
      const { source, listCalls } = makeStubSource()
      store.setSource(source)
      await store.fetchList()

      await store.setSort('grade-asc')

      expect(store.sort).toBe('grade-asc')
      expect(listCalls[1]).toMatchObject({ sort: 'grade-asc' })
    })

    /**
     * The behaviour that had to change with pagination: sorting a page in place would put
     * the wrong rows on it, so the ordering has to be re-read rather than re-applied.
     */
    it('re-reads from the source rather than reordering the page it holds', async () => {
      const store = useReportHistoryStore()
      const { source, listCalls } = makeStubSource({ summaries: [makeSummary()] })
      store.setSource(source)
      await store.fetchList()

      await store.setSort('date-asc')

      expect(listCalls).toHaveLength(2)
    })

    it('renders whatever order the source answered with, unchanged', async () => {
      const store = useReportHistoryStore()
      store.setSource(
        makePagedSource([
          makeSummary({ id: 'weak-new', createdAt: '2026-08-15T10:00:00.000Z', overallGrade: 10 }),
          makeSummary({ id: 'strong-old', createdAt: '2026-08-10T10:00:00.000Z', overallGrade: 90 })
        ]).source
      )
      await store.fetchList()
      expect(store.list.map(item => item.id)).toEqual(['weak-new', 'strong-old'])

      await store.setSort('grade-asc')

      expect(store.list.map(item => item.id)).toEqual(['weak-new', 'strong-old'])
    })

    it('keeps the filters it already had when the ordering changes', async () => {
      const store = useReportHistoryStore()
      const { source, listCalls } = makeStubSource()
      store.setSource(source)
      await store.fetchList({ jobTitle: 'backend' })

      await store.setSort('grade-desc')

      expect(listCalls[1]).toMatchObject({ jobTitle: 'backend', sort: 'grade-desc' })
      expect(store.filters).toEqual({ jobTitle: 'backend' })
    })

    /**
     * The regression the plan calls out: sort is a separate ref, not a filter. Folding it
     * into `filters` would pin `hasFilters` true, so "Clear filters" could never hide and
     * a user with no interviews would be told their filters matched nothing.
     */
    it('does not count as a filter', async () => {
      const store = useReportHistoryStore()
      store.setSource(makeStubSource().source)
      await store.fetchList()

      await store.setSort('grade-desc')

      expect(store.hasFilters).toBe(false)
      expect(store.filters).toEqual({})
    })

    it('goes back to newest first on reset', async () => {
      const store = useReportHistoryStore()
      store.setSource(makeStubSource().source)
      await store.fetchList()
      await store.setSort('grade-asc')

      store.reset()

      expect(store.sort).toBe('date-desc')
    })
  })

  describe('paging through the history', () => {
    /** 25 rows: three pages of ten, the last one short. */
    const MANY = Array.from({ length: 25 }, (_, i) =>
      makeSummary({
        id: `row-${String(i).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        overallGrade: i
      })
    )

    async function loadPaged() {
      const store = useReportHistoryStore()
      const { source, listCalls } = makePagedSource(MANY)
      store.setSource(source)
      await store.fetchList()

      return { store, listCalls }
    }

    it('starts on page one with nothing counted yet', () => {
      const store = useReportHistoryStore()

      expect(store.page).toBe(1)
      expect(store.total).toBe(0)
      expect(store.pageCount).toBe(1)
    })

    it('holds one page of rows and the count of every match', async () => {
      const { store } = await loadPaged()

      expect(store.list).toHaveLength(PAGE_SIZE)
      expect(store.total).toBe(25)
      expect(store.pageCount).toBe(3)
    })

    it('reports a single page when everything already fits on one', async () => {
      const store = useReportHistoryStore()
      store.setSource(makePagedSource(MANY.slice(0, 4)).source)

      await store.fetchList()

      expect(store.pageCount).toBe(1)
      expect(store.total).toBe(4)
    })

    it('reads the next page from the source rather than slicing what it holds', async () => {
      const { store, listCalls } = await loadPaged()
      const firstPage = store.list.map(item => item.id)

      await store.setPage(2)

      expect(store.page).toBe(2)
      expect(listCalls[1]).toMatchObject({ page: 2, pageSize: PAGE_SIZE })
      expect(store.list.map(item => item.id)).not.toEqual(firstPage)
      expect(store.list).toHaveLength(PAGE_SIZE)
    })

    it('reads a short final page without complaint', async () => {
      const { store } = await loadPaged()

      await store.setPage(3)

      expect(store.list).toHaveLength(5)
      expect(store.total).toBe(25)
    })

    it.each([
      [0, 1],
      [-4, 1],
      [99, 3],
      [Number.NaN, 1]
    ])('clamps a page of %s to %s rather than reading past the ends', async (asked, expected) => {
      const { store } = await loadPaged()

      await store.setPage(asked)

      expect(store.page).toBe(expected)
    })

    /** A page number left over from a wider result set would render an empty page. */
    it('goes back to page one when the filters change', async () => {
      const { store, listCalls } = await loadPaged()
      await store.setPage(3)

      await store.fetchList({ jobTitle: 'backend' })

      expect(store.page).toBe(1)
      expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, jobTitle: 'backend' })
    })

    it('goes back to page one when the ordering changes', async () => {
      const { store, listCalls } = await loadPaged()
      await store.setPage(2)

      await store.setSort('grade-asc')

      expect(store.page).toBe(1)
      expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, sort: 'grade-asc' })
    })

    it('forgets the page and the count on reset', async () => {
      const { store } = await loadPaged()
      await store.setPage(3)

      store.reset()

      expect(store.page).toBe(1)
      expect(store.total).toBe(0)
      expect(store.pageCount).toBe(1)
    })

    /**
     * A different page size is a different first page, not the same rows regrouped —
     * `setPageSize` re-reads for the same reason `setSort` does.
     */
    describe('changing the page size', () => {
      it('starts at the default', () => {
        expect(useReportHistoryStore().pageSize).toBe(PAGE_SIZE)
      })

      it('records the chosen size and sends it on the next read', async () => {
        const { store, listCalls } = await loadPaged()

        await store.setPageSize(20)

        expect(store.pageSize).toBe(20)
        expect(listCalls[1]).toMatchObject({ page: 1, pageSize: 20 })
      })

      it('goes back to page one, even from a page the new size still has', async () => {
        const { store, listCalls } = await loadPaged()
        await store.setPage(2)

        await store.setPageSize(20)

        expect(store.page).toBe(1)
        expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, pageSize: 20 })
      })

      it('recomputes the page count for the new size', async () => {
        const { store } = await loadPaged()
        expect(store.pageCount).toBe(3)

        await store.setPageSize(20)

        expect(store.pageCount).toBe(2)
      })

      it('goes back to the default on reset', async () => {
        const { store } = await loadPaged()
        await store.setPageSize(50)

        store.reset()

        expect(store.pageSize).toBe(PAGE_SIZE)
      })
    })

    /** A leftover `total` would draw a pager for rows the failed read just removed. */
    it('drops the count along with the rows when a read fails', async () => {
      const { store } = await loadPaged()
      store.setSource(makeStubSource({ failWith: new InterviewError('BOOM', 'Nope.') }).source)

      await expect(store.fetchList()).rejects.toBeInstanceOf(InterviewError)

      expect(store.total).toBe(0)
      expect(store.pageCount).toBe(1)
      expect(store.list).toEqual([])
    })
  })

  it('clears everything on reset', async () => {
    const store = useReportHistoryStore()
    store.setSource(makeStubSource({ summaries: [makeSummary()] }).source)
    await store.fetchList({ jobTitle: 'frontend' })

    store.reset()

    expect(store.list).toEqual([])
    expect(store.filters).toEqual({})
    expect(store.status).toBe('idle')
  })
})
