import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ReportsHistoryView from './ReportsHistoryView.vue'
import { createAppRouter } from '@/router'
import { PAGE_SIZE, REPORT_SORTS, useReportHistoryStore } from '@/stores/report-history.store'
import type { ReportHistoryQuery, ReportHistorySource } from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'

/**
 * QA adversarial pass on the sort and page controls at the screen level: rapid repeated
 * interaction, a sort change racing a filter read, and the behaviours the plans call out
 * as "working-looking UI with wrong behaviour" — a "Clear filters" button that can never
 * hide (plan 015), and a page number that survives a filter change (plan 018).
 *
 * Plan 015's "a sort change must cost zero reads" is deliberately INVERTED here: since
 * pagination landed, ordering is the server's, so a sort change costs exactly one read.
 * Re-ordering the rows on screen would only ever be right when they are all the rows.
 */

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

function makeSummary(overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id: 'i1',
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80,
    ...overrides
  }
}

/** Date and grade deliberately disagree, so each of the four orderings is distinguishable. */
const CATALOG: InterviewSummary[] = [
  makeSummary({ id: 'newer-weak', createdAt: '2026-08-15T10:00:00.000Z', overallGrade: 55 }),
  makeSummary({
    id: 'older-strong',
    createdAt: '2026-08-14T10:00:00.000Z',
    config: { jobTitle: 'backend', level: 'senior', type: 'behavioral', questionCount: 5 },
    overallGrade: 80
  })
]

/** The orderings the API applies. The screen must never produce one of its own. */
const ORDER: Record<string, (a: InterviewSummary, b: InterviewSummary) => number> = {
  'date-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
  'date-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
  'grade-desc': (a, b) => b.overallGrade - a.overallGrade,
  'grade-asc': (a, b) => a.overallGrade - b.overallGrade
}

function makeStubSource(summaries = CATALOG) {
  const listCalls: ReportHistoryQuery[] = []

  const source: ReportHistorySource = {
    async list(query = {}) {
      listCalls.push(query)

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

async function mountView(summaries = CATALOG) {
  setActivePinia(createPinia())
  signIn()

  const { source, listCalls } = makeStubSource(summaries)
  const store = useReportHistoryStore()
  store.setSource(source)

  const router = createAppRouter(createMemoryHistory())
  router.push('/reports')
  await router.isReady()

  const wrapper = mount(ReportsHistoryView, { global: { plugins: [router] } })
  await flushPromises()

  return { wrapper, store, listCalls }
}

type View = Awaited<ReturnType<typeof mountView>>['wrapper']

function rowIds(wrapper: View): string[] {
  return wrapper.findAll('.history-row').map(row => (row.attributes('href') ?? '').replace('/reports/', ''))
}

function isLoadingVisible(wrapper: View): boolean {
  return wrapper.text().includes('Loading your reports')
}

describe('hammering the sort control', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  /**
   * Flicking through every ordering as fast as the DOM allows must cost exactly one read
   * each — never two per change, and never a stuck loading state at the end of it.
   */
  it('changes ordering twelve times in a row at one read apiece', async () => {
    const { wrapper, listCalls } = await mountView()
    const before = listCalls.length
    expect(before).toBe(1)

    const every = [...REPORT_SORTS, ...REPORT_SORTS, ...REPORT_SORTS]
    for (const sort of every) {
      await wrapper.get('#sort-by').setValue(sort)
      await flushPromises()
    }

    expect(listCalls).toHaveLength(before + every.length)
    expect(isLoadingVisible(wrapper)).toBe(false)
    expect(wrapper.findAll('.history-row')).toHaveLength(CATALOG.length)
  })

  it('lands on the ordering that was picked last, not one it passed through', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('#sort-by').setValue('grade-desc')
    await wrapper.get('#sort-by').setValue('date-asc')
    await wrapper.get('#sort-by').setValue('grade-asc')
    await flushPromises()

    expect((wrapper.get('#sort-by').element as HTMLSelectElement).value).toBe('grade-asc')
    // grade-asc: 55 before 80.
    expect(rowIds(wrapper)).toEqual(['newer-weak', 'older-strong'])
  })

  /** Three reads issued back to back: only the last one may write to the screen. */
  it('shows the ordering asked for last even when the reads overlap', async () => {
    const { wrapper, listCalls } = await mountView()

    await wrapper.get('#sort-by').setValue('grade-desc')
    await wrapper.get('#sort-by').setValue('grade-asc')
    await flushPromises()

    expect(listCalls[listCalls.length - 1]).toMatchObject({ sort: 'grade-asc' })
    expect(rowIds(wrapper)).toEqual(['newer-weak', 'older-strong'])
    expect(isLoadingVisible(wrapper)).toBe(false)
  })

  /**
   * A sort change while a filter read is still in flight. The newer read wins — including
   * carrying the filter the older one was for, so the two cannot come apart.
   */
  it('applies an ordering chosen while a filter read was still in flight', async () => {
    const { wrapper, listCalls } = await mountView()

    // Narrow to one row first, so dropping the filter is a real change that refetches both.
    await wrapper.get('#filter-job-title').setValue('backend')
    await flushPromises()
    expect(rowIds(wrapper)).toEqual(['older-strong'])
    const before = listCalls.length

    // Fire the filter change and immediately reorder, without flushing in between.
    await wrapper.get('#filter-job-title').setValue('')
    await wrapper.get('#sort-by').setValue('grade-desc')
    await flushPromises()

    expect(listCalls.length).toBeGreaterThan(before)
    expect(listCalls[listCalls.length - 1]).toMatchObject({ sort: 'grade-desc' })
    expect(listCalls[listCalls.length - 1].jobTitle).toBeUndefined()
    expect(rowIds(wrapper)).toEqual(['older-strong', 'newer-weak'])
    expect(isLoadingVisible(wrapper)).toBe(false)
  })

  /**
   * The "Clear filters" regression from plan 015's Risks: sort must not register as a
   * filter, in either direction — the button must stay hidden with only a sort touched, and
   * must still appear and then disappear correctly around a real filter.
   */
  it('keeps the clear-filters button honest across a sort change on both sides of a filter', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('#sort-by').setValue('grade-desc')
    await flushPromises()
    expect(wrapper.find('.clear-filters').exists()).toBe(false)

    await wrapper.get('#filter-level').setValue('senior')
    await flushPromises()
    expect(wrapper.find('.clear-filters').exists()).toBe(true)

    await wrapper.get('#sort-by').setValue('date-asc')
    await flushPromises()
    expect(wrapper.find('.clear-filters').exists()).toBe(true)

    await wrapper.get('.clear-filters').trigger('click')
    await flushPromises()
    expect(wrapper.find('.clear-filters').exists()).toBe(false)

    // Clearing filters must not silently reorder the rows (plan 015 Open Question 3).
    expect((wrapper.get('#sort-by').element as HTMLSelectElement).value).toBe('date-asc')
    expect(rowIds(wrapper)).toEqual(['older-strong', 'newer-weak'])
  })

  /** A filtered-to-nothing list plus a sort change must not claim there is no history. */
  it('still blames the filters, not an empty history, when a sort follows a filter that matched nothing', async () => {
    const { wrapper } = await mountView()

    await wrapper.get('#filter-date').setValue('2001-01-01')
    await flushPromises()
    await wrapper.get('#sort-by').setValue('grade-asc')
    await flushPromises()

    expect(wrapper.get('.empty-state').text()).toContain('No interviews match these filters')
    expect(wrapper.get('.empty-state').text()).not.toContain('You have not finished an interview yet')
  })

  /** The header copy must not promise an order the control can change. */
  it('no longer hardcodes "newest first" in the page copy', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('header').text()).not.toContain('newest first')
  })
})

describe('hammering the pager', () => {
  /** 25 rows: three pages, the last one short. */
  const MANY = Array.from({ length: 25 }, (_, i) =>
    makeSummary({
      id: `row-${String(i).padStart(2, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      overallGrade: i
    })
  )

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('walks to the last page and back without losing or repeating a row', async () => {
    const { wrapper } = await mountView(MANY)
    const seen: string[][] = [rowIds(wrapper)]

    for (let i = 0; i < 2; i++) {
      await wrapper.get('.pagination-next').trigger('click')
      await flushPromises()
      seen.push(rowIds(wrapper))
    }

    const all = seen.flat()
    expect(all).toHaveLength(25)
    expect(new Set(all).size).toBe(25)

    for (let i = 0; i < 2; i++) {
      await wrapper.get('.pagination-prev').trigger('click')
      await flushPromises()
    }
    expect(rowIds(wrapper)).toEqual(seen[0])
  })

  /**
   * Clicking faster than the reads settle. Each click still counts — two Nexts advance two
   * pages, not one — and the rows that land are the last page asked for, not the first to
   * answer. A pager that read its own stale prop would stick on page 2 here.
   */
  it('counts every click and lands on the page asked for last', async () => {
    const { wrapper, store, listCalls } = await mountView(MANY)

    await wrapper.get('.pagination-next').trigger('click')
    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()

    expect(store.page).toBe(3)
    expect(listCalls[listCalls.length - 1]).toMatchObject({ page: 3 })
    expect(wrapper.get('.pagination-label').text()).toBe('Page 3 of 3')
    // The short last page, and no way further forward.
    expect(wrapper.findAll('.history-row')).toHaveLength(25 - 2 * PAGE_SIZE)
    expect((wrapper.get('.pagination-next').element as HTMLButtonElement).disabled).toBe(true)
  })

  /**
   * The plan 018 regression: page 3 plus a filter matching one page. Keeping page 3 would
   * render an empty list under "No interviews match these filters" — a lie about the data.
   */
  it('never leaves the user on a page a filter removed', async () => {
    const { wrapper, store } = await mountView(MANY)
    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()
    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()
    expect(store.page).toBe(3)

    await wrapper.get('#filter-date').setValue('2026-01-02')
    await flushPromises()

    expect(store.page).toBe(1)
    expect(wrapper.findAll('.history-row')).toHaveLength(1)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })

  it('never leaves the user on a page a new ordering removed either', async () => {
    const { wrapper, store } = await mountView(MANY)
    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()

    await wrapper.get('#sort-by').setValue('grade-desc')
    await flushPromises()

    expect(store.page).toBe(1)
    expect(wrapper.get('.pagination-label').text()).toBe('Page 1 of 3')
  })

  /** Paging is not filtering: the pager must not make the page look filtered. */
  it('leaves the clear-filters button hidden however far the user pages', async () => {
    const { wrapper, store } = await mountView(MANY)

    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()

    expect(wrapper.find('.clear-filters').exists()).toBe(false)
    expect(store.hasFilters).toBe(false)
  })

  it('pages within a filter without ever dropping the filter', async () => {
    const { wrapper, listCalls } = await mountView(MANY)

    await wrapper.get('#filter-job-title').setValue('frontend')
    await flushPromises()
    await wrapper.get('.pagination-next').trigger('click')
    await flushPromises()

    expect(listCalls[listCalls.length - 1]).toMatchObject({ jobTitle: 'frontend', page: 2 })
    expect(wrapper.find('.clear-filters').exists()).toBe(true)
  })
})
