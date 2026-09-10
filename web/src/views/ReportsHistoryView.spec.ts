import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ReportsHistoryView from './ReportsHistoryView.vue'
import GradeBadge from '@/cmps/GradeBadge.vue'
import { createAppRouter } from '@/router'
import { PAGE_SIZE, useReportHistoryStore } from '@/stores/report-history.store'
import { InterviewError } from '@/services/interview.service'
import type { ReportHistoryQuery, ReportHistorySource } from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

const { toast } = await import('vue-sonner')

function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id: 'i1',
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80,
    ...overrides
  }
}

const CATALOG: InterviewSummary[] = [
  makeSummary({ id: 'front-mid', createdAt: '2026-08-14T10:00:00.000Z' }),
  makeSummary({
    id: 'back-senior',
    createdAt: '2026-08-15T10:00:00.000Z',
    config: { jobTitle: 'backend', level: 'senior', type: 'behavioral', questionCount: 5 },
    overallGrade: 55
  })
]

/** The four orderings the API applies, so the view is tested against a real server shape. */
const ORDER: Record<string, (a: InterviewSummary, b: InterviewSummary) => number> = {
  'date-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
  'date-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
  'grade-desc': (a, b) => b.overallGrade - a.overallGrade,
  'grade-asc': (a, b) => a.overallGrade - b.overallGrade
}

/**
 * Filtering, ordering and paging all live in the source, as they do on the server: the
 * view's job is to send a query and render the page that comes back, never to re-sort it.
 */
function makeStubSource(summaries = CATALOG, failWith?: InterviewError) {
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    async list(query = {}) {
      listCalls.push(query)
      if (failWith) throw failWith

      const matching = summaries
        .filter(item => {
          if (query.date && item.createdAt.slice(0, 10) !== query.date) return false
          if (query.jobTitle && item.config.jobTitle !== query.jobTitle) return false
          if (query.level && item.config.level !== query.level) return false
          if (query.type && item.config.type !== query.type) return false
          return true
        })
        .sort(ORDER[query.sort ?? 'date-desc'])

      const size = query.pageSize ?? PAGE_SIZE
      const start = ((query.page ?? 1) - 1) * size

      return { items: matching.slice(start, start + size), total: matching.length }
    },
    async getDetail() {
      return null
    },
    record: vi.fn()
  }

  return { source, listCalls }
}

async function mountView(options: { summaries?: InterviewSummary[]; failWith?: InterviewError } = {}) {
  setActivePinia(createPinia())
  signIn()

  const { source, listCalls } = makeStubSource(options.summaries ?? CATALOG, options.failWith)
  const store = useReportHistoryStore()
  store.setSource(source)

  const router = createAppRouter(createMemoryHistory())
  router.push('/reports')
  await router.isReady()

  const wrapper = mount(ReportsHistoryView, { global: { plugins: [router] } })
  await flushPromises()

  return { wrapper, router, store, listCalls }
}

/**
 * The detail route is lazy-loaded, so its navigation settles a dynamic import later — and
 * on a cold Vite cache that import is transformed first. Same 5s budget the flow spec uses.
 */
async function waitForRoute(check: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await flushPromises()
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  throw new Error(`Timed out waiting for: ${label}`)
}

function rowIds(wrapper: Awaited<ReturnType<typeof mountView>>['wrapper']): string[] {
  return wrapper.findAll('.history-row').map(row => row.attributes('href') ?? '')
}

const PAGING_KEYS = ['sort', 'page', 'pageSize']

/** Just the filters out of a recorded query; ordering and paging are asserted separately. */
function filtersOf(query: ReportHistoryQuery): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !PAGING_KEYS.includes(key)))
}

describe('ReportsHistoryView', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('lists every past interview on arrival, with no filter applied', async () => {
    const { wrapper, listCalls } = await mountView()

    expect(filtersOf(listCalls[0])).toEqual({})
    expect(wrapper.findAll('.history-row')).toHaveLength(2)
  })

  it('asks for the first page of a stated size on arrival', async () => {
    const { listCalls } = await mountView()

    expect(listCalls[0]).toMatchObject({ page: 1, pageSize: PAGE_SIZE, sort: 'date-desc' })
  })

  it('labels a row with its date, config and grade', async () => {
    const { wrapper } = await mountView({ summaries: [CATALOG[0]] })

    const row = wrapper.get('.history-row')
    expect(row.get('time').attributes('datetime')).toBe('2026-08-14T10:00:00.000Z')
    expect(row.get('time').text()).toBe('2026-08-14')
    expect(row.text()).toContain('Frontend Developer')
    expect(row.text()).toContain('Mid-level (2–5 years)')
    expect(row.text()).toContain('Technical')
    expect(row.findComponent(GradeBadge).props('grade')).toBe(80)
  })

  it('links each row to that interview detail route', async () => {
    const { wrapper } = await mountView({ summaries: [CATALOG[0]] })

    expect(wrapper.get('.history-row').attributes('href')).toBe('/reports/front-mid')
  })

  it('navigates to the detail route when a row is clicked', async () => {
    const { wrapper, router } = await mountView({ summaries: [CATALOG[0]] })

    await wrapper.get('.history-row').trigger('click')
    await waitForRoute(() => router.currentRoute.value.name === 'report-detail', 'detail route')

    expect(router.currentRoute.value.name).toBe('report-detail')
    expect(router.currentRoute.value.params.id).toBe('front-mid')
  })

  describe('filters narrow the list', () => {
    it('narrows on job title', async () => {
      const { wrapper, listCalls } = await mountView()

      await wrapper.get('#filter-job-title').setValue('backend')
      await flushPromises()

      expect(filtersOf(listCalls[1])).toEqual({ jobTitle: 'backend' })
      expect(rowIds(wrapper)).toEqual(['/reports/back-senior'])
    })

    it('narrows on a calendar day', async () => {
      const { wrapper, listCalls } = await mountView()

      await wrapper.get('#filter-date').setValue('2026-08-14')
      await flushPromises()

      expect(filtersOf(listCalls[1])).toEqual({ date: '2026-08-14' })
      expect(rowIds(wrapper)).toEqual(['/reports/front-mid'])
    })

    it('narrows on experience level', async () => {
      const { wrapper } = await mountView()

      await wrapper.get('#filter-level').setValue('senior')
      await flushPromises()

      expect(rowIds(wrapper)).toEqual(['/reports/back-senior'])
    })

    it('narrows on interview type', async () => {
      const { wrapper } = await mountView()

      await wrapper.get('#filter-type').setValue('behavioral')
      await flushPromises()

      expect(rowIds(wrapper)).toEqual(['/reports/back-senior'])
    })

    it('combines several filters into one request', async () => {
      const { wrapper, listCalls } = await mountView()

      await wrapper.get('#filter-job-title').setValue('backend')
      await flushPromises()
      await wrapper.get('#filter-level').setValue('senior')
      await flushPromises()

      expect(filtersOf(listCalls[listCalls.length - 1])).toEqual({ jobTitle: 'backend', level: 'senior' })
      expect(rowIds(wrapper)).toEqual(['/reports/back-senior'])
    })

    /** An empty select means "all", and must never be sent as an empty query parameter. */
    it('drops a filter back out of the request when it is cleared', async () => {
      const { wrapper, listCalls } = await mountView()

      await wrapper.get('#filter-job-title').setValue('backend')
      await flushPromises()
      await wrapper.get('#filter-job-title').setValue('')
      await flushPromises()

      expect(filtersOf(listCalls[listCalls.length - 1])).toEqual({})
      expect(wrapper.findAll('.history-row')).toHaveLength(2)
    })

    it('offers a clear-filters control only once something is filtered, and it restores the list', async () => {
      const { wrapper } = await mountView()
      expect(wrapper.find('.clear-filters').exists()).toBe(false)

      await wrapper.get('#filter-job-title').setValue('backend')
      await flushPromises()
      expect(wrapper.find('.clear-filters').exists()).toBe(true)

      await wrapper.get('.clear-filters').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('.history-row')).toHaveLength(2)
      expect(wrapper.find('.clear-filters').exists()).toBe(false)
    })
  })

  describe('empty states', () => {
    it('invites a first interview when there is no history at all', async () => {
      const { wrapper } = await mountView({ summaries: [] })

      expect(wrapper.findAll('.history-row')).toHaveLength(0)
      expect(wrapper.get('.empty-state').text()).toContain('You have not finished an interview yet')
      expect(wrapper.get('.empty-state a').attributes('href')).toBe('/practice')
    })

    it('says the filters matched nothing rather than that there is no history', async () => {
      const { wrapper } = await mountView()

      await wrapper.get('#filter-job-title').setValue('devops')
      await flushPromises()

      expect(wrapper.get('.empty-state').text()).toContain('No interviews match these filters')
      expect(wrapper.get('.empty-state').text()).not.toContain('not finished an interview yet')
    })
  })

  /**
   * `back-senior` is the newer interview (2026-08-15) with the lower grade (55), and
   * `front-mid` the older one (2026-08-14) with the higher (80) — so date and grade
   * disagree, and every ordering below is distinguishable from the others.
   */
  describe('sorting the list', () => {
    const ROWS = ['/reports/back-senior', '/reports/front-mid']

    it('offers exactly the four orderings, starting on newest first', async () => {
      const { wrapper } = await mountView()

      const select = wrapper.get('#sort-by')
      expect(select.findAll('option').map(option => option.attributes('value'))).toEqual([
        'date-desc',
        'date-asc',
        'grade-desc',
        'grade-asc'
      ])
      expect(select.findAll('option').map(option => option.text())).toEqual([
        'Newest first',
        'Oldest first',
        'Highest grade first',
        'Lowest grade first'
      ])
      expect((select.element as HTMLSelectElement).value).toBe('date-desc')
    })

    it.each([
      ['date-desc', ROWS],
      ['date-asc', [...ROWS].reverse()],
      ['grade-desc', [...ROWS].reverse()],
      ['grade-asc', ROWS]
    ])('reorders the rendered rows on %s', async (sort, expected) => {
      const { wrapper } = await mountView()

      await wrapper.get('#sort-by').setValue(sort)
      await flushPromises()

      expect(rowIds(wrapper)).toEqual(expected)
    })

    /**
     * Since plan 018 a page is a slice of the SERVER's ordering, so reordering has to be
     * re-read rather than re-applied: sorting the ten rows on screen would say nothing
     * about the ninety it cannot see. One read per change, and no more.
     */
    it('reads the reordered page from the source instead of shuffling the rows on screen', async () => {
      const { wrapper, listCalls } = await mountView()
      const before = listCalls.length

      await wrapper.get('#sort-by').setValue('grade-asc')
      await flushPromises()
      await wrapper.get('#sort-by').setValue('date-asc')
      await flushPromises()

      expect(listCalls).toHaveLength(before + 2)
      expect(listCalls[listCalls.length - 1]).toMatchObject({ sort: 'date-asc', page: 1 })
      expect(wrapper.find('.history-row').exists()).toBe(true)
    })

    /** The select must stay out of the watched `form`, or one change would read twice. */
    it('reads exactly once per ordering change, not twice', async () => {
      const { wrapper, listCalls } = await mountView()
      const before = listCalls.length

      await wrapper.get('#sort-by').setValue('grade-desc')
      await flushPromises()

      expect(listCalls).toHaveLength(before + 1)
    })

    it('still reads again when a filter changes, so the two are not confused', async () => {
      const { wrapper, listCalls } = await mountView()
      await wrapper.get('#sort-by').setValue('grade-asc')
      await flushPromises()
      const before = listCalls.length

      await wrapper.get('#filter-job-title').setValue('backend')
      await flushPromises()

      expect(listCalls).toHaveLength(before + 1)
    })

    it('keeps the ordering across a filter change', async () => {
      const { wrapper } = await mountView()

      await wrapper.get('#sort-by').setValue('date-asc')
      await flushPromises()
      await wrapper.get('#filter-level').setValue('')
      await flushPromises()

      expect(rowIds(wrapper)).toEqual([...ROWS].reverse())
    })

    /** Sort is not a predicate, so it must not make the page look filtered. */
    it('leaves the clear-filters control hidden when only the sort was touched', async () => {
      const { wrapper, store } = await mountView()

      await wrapper.get('#sort-by').setValue('grade-desc')
      await flushPromises()

      expect(wrapper.find('.clear-filters').exists()).toBe(false)
      expect(store.hasFilters).toBe(false)
    })

    it('still invites a first interview, rather than blaming filters, after a sort change', async () => {
      const { wrapper } = await mountView({ summaries: [] })

      await wrapper.get('#sort-by').setValue('grade-desc')
      await flushPromises()

      expect(wrapper.get('.empty-state').text()).toContain('You have not finished an interview yet')
      expect(wrapper.get('.empty-state').text()).not.toContain('No interviews match these filters')
    })
  })

  describe('paging through more history than one page holds', () => {
    /** 23 rows: three pages of ten, so a first, a middle and a short last page all exist. */
    const MANY = Array.from({ length: 23 }, (_, i) =>
      makeSummary({
        id: `row-${String(i).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        overallGrade: i
      })
    )

    it('shows no pager at all when everything fits on one page', async () => {
      const { wrapper } = await mountView()

      expect(wrapper.find('.pagination').exists()).toBe(false)
    })

    it('shows no pager for an empty history either', async () => {
      const { wrapper } = await mountView({ summaries: [] })

      expect(wrapper.find('.pagination').exists()).toBe(false)
    })

    it('shows one page of rows and a pager that counts the rest', async () => {
      const { wrapper } = await mountView({ summaries: MANY })

      expect(wrapper.findAll('.history-row')).toHaveLength(PAGE_SIZE)
      expect(wrapper.get('.pagination-label').text()).toBe('Page 1 of 3')
    })

    it('loads the next page of rows when Next is clicked', async () => {
      const { wrapper, listCalls } = await mountView({ summaries: MANY })
      const first = rowIds(wrapper)

      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()

      expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 2 })
      expect(wrapper.get('.pagination-label').text()).toBe('Page 2 of 3')
      expect(rowIds(wrapper)).not.toEqual(first)
      expect(rowIds(wrapper).some(href => first.includes(href))).toBe(false)
    })

    it('comes back to the first page through Previous', async () => {
      const { wrapper } = await mountView({ summaries: MANY })
      const first = rowIds(wrapper)

      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()
      await wrapper.get('.pagination-prev').trigger('click')
      await flushPromises()

      expect(rowIds(wrapper)).toEqual(first)
    })

    it('offers no Next on the last page, and a short page of rows', async () => {
      const { wrapper } = await mountView({ summaries: MANY })

      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()
      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()

      expect(wrapper.get('.pagination-label').text()).toBe('Page 3 of 3')
      expect(wrapper.findAll('.history-row')).toHaveLength(3)
      expect((wrapper.get('.pagination-next').element as HTMLButtonElement).disabled).toBe(true)
    })

    /** Page 3 of an unfiltered history against a filter with one page would be empty. */
    it('goes back to page one when a filter narrows the history', async () => {
      const { wrapper, listCalls } = await mountView({ summaries: MANY })
      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()

      await wrapper.get('#filter-job-title').setValue('frontend')
      await flushPromises()

      expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, jobTitle: 'frontend' })
      expect(wrapper.findAll('.history-row')).toHaveLength(PAGE_SIZE)
    })

    it('goes back to page one when the ordering changes', async () => {
      const { wrapper, listCalls } = await mountView({ summaries: MANY })
      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()

      await wrapper.get('#sort-by').setValue('grade-asc')
      await flushPromises()

      expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, sort: 'grade-asc' })
      expect(wrapper.get('.pagination-label').text()).toBe('Page 1 of 3')
    })

    it('drops the pager when a filter leaves a single page of matches', async () => {
      const { wrapper } = await mountView({ summaries: MANY })
      expect(wrapper.find('.pagination').exists()).toBe(true)

      await wrapper.get('#filter-date').setValue('2026-01-01')
      await flushPromises()

      expect(wrapper.findAll('.history-row')).toHaveLength(1)
      expect(wrapper.find('.pagination').exists()).toBe(false)
    })

    describe('choosing the page size', () => {
      it('offers the five sizes, starting on the default', async () => {
        const { wrapper } = await mountView()

        const select = wrapper.get('#page-size')
        expect(select.findAll('option').map(option => option.attributes('value'))).toEqual([
          '2',
          '5',
          '10',
          '20',
          '50'
        ])
        expect((select.element as HTMLSelectElement).value).toBe(String(PAGE_SIZE))
      })

      it('reads a bigger page from the source when a larger size is chosen', async () => {
        const { wrapper, listCalls } = await mountView({ summaries: MANY })

        await wrapper.get('#page-size').setValue('20')
        await flushPromises()

        expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, pageSize: 20 })
        expect(wrapper.findAll('.history-row')).toHaveLength(20)
        expect(wrapper.get('.pagination-label').text()).toBe('Page 1 of 2')
      })

      it('goes back to page one, even from a later page', async () => {
        const { wrapper, listCalls } = await mountView({ summaries: MANY })
        await wrapper.get('.pagination-next').trigger('click')
        await flushPromises()

        await wrapper.get('#page-size').setValue('20')
        await flushPromises()

        expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, pageSize: 20 })
      })

      it('reads a shorter page when a smaller size is chosen, growing the page count', async () => {
        const { wrapper, listCalls } = await mountView({ summaries: MANY })

        await wrapper.get('#page-size').setValue('5')
        await flushPromises()

        expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 1, pageSize: 5 })
        expect(wrapper.findAll('.history-row')).toHaveLength(5)
        // 23 rows at 5 per page: four full pages and a fifth of three.
        expect(wrapper.get('.pagination-label').text()).toBe('Page 1 of 5')
      })

      it('drops the pager once the larger size fits everything on one page', async () => {
        const { wrapper } = await mountView({ summaries: MANY })
        expect(wrapper.find('.pagination').exists()).toBe(true)

        await wrapper.get('#page-size').setValue('50')
        await flushPromises()

        expect(wrapper.findAll('.history-row')).toHaveLength(MANY.length)
        expect(wrapper.find('.pagination').exists()).toBe(false)
      })
    })
  })

  it('toasts the failure instead of rendering a half-loaded list', async () => {
    const { wrapper } = await mountView({
      failWith: new InterviewError('INTERNAL_ERROR', 'Could not load your reports.')
    })

    expect(toast.error).toHaveBeenCalledWith('Could not load your reports.')
    expect(wrapper.findAll('.history-row')).toHaveLength(0)
  })
})
