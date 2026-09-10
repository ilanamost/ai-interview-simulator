import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import ReportsHistoryView from './ReportsHistoryView.vue'
import ReportHistoryDetailView from './ReportHistoryDetailView.vue'
import { createAppRouter } from '@/router'
import { useReportHistoryStore } from '@/stores/report-history.store'
import { signIn } from '@/test/auth-fixture'
import { stubMatchMedia } from '@/test/theme-fixture'
import type {
  ReportHistoryPage,
  ReportHistoryQuery,
  ReportHistorySource
} from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'

/*
 * QA adversarial pass on the two new screens and the header nav.
 *
 * Everything here is about the states the happy path skips: a slow source answering
 * out of order, a screen rendered before its first read has started, and what the nav
 * claims about where you are.
 */

vi.mock('@/services/report-pdf.service', () => ({ downloadReportPdf: vi.fn() }))

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

function makeSummary(id: string, overrides: Partial<InterviewSummary> = {}): InterviewSummary {
  return {
    id,
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80,
    ...overrides
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMatchMedia()
  localStorage.clear()
  signIn()
})

describe('filters changed faster than the source can answer', () => {
  /** Resolves each list call only when the test says so, in whatever order it likes. */
  function makeControllableSource() {
    const pending: Array<{ filters: ReportHistoryQuery; resolve: (rows: InterviewSummary[]) => void }> = []

    const source: ReportHistorySource = {
      list(filters = {}) {
        return new Promise<ReportHistoryPage>(resolve => {
          // One page per read: a resolver takes rows and counts them as the whole set.
          pending.push({ filters, resolve: rows => resolve({ items: rows, total: rows.length }) })
        })
      },
      async getDetail() {
        return null
      },
      record: vi.fn()
    }

    return { source, pending }
  }

  /**
   * QA FINDING, now fixed (request sequencing in `report-history.store.ts`).
   *
   * `fetchList` used to have no sequencing: whichever `list()` call settled LAST won,
   * regardless of which was asked for last. Two overlapping reads — one select change
   * while the previous one is still in flight, ordinary on a real network — left the
   * filter form reading "backend" while the rows on screen were the frontend ones.
   *
   * Each read now captures the token it was issued under and only writes if it is still
   * the current one. This is the regression guard for that fix.
   */
  it('shows the answer to the filter the user last chose, not the one that replied last', async () => {
    const store = useReportHistoryStore()
    const { source, pending } = makeControllableSource()
    store.setSource(source)

    const slowFirst = store.fetchList({ jobTitle: 'frontend' })
    const fastSecond = store.fetchList({ jobTitle: 'backend' })

    // The second request comes back first, then the first one straggles in — exactly
    // what a user gets for flicking through a select faster than the API answers.
    pending[1].resolve([makeSummary('backend-row')])
    pending[0].resolve([makeSummary('frontend-row')])

    await Promise.all([slowFirst, fastSecond])

    expect(store.filters).toEqual({ jobTitle: 'backend' })
    expect(store.list.map(item => item.id)).toEqual(['backend-row'])
  })

  /** The same race from the other side: the straggler must change nothing at all. */
  it('discards a straggling response instead of writing it over the current one', async () => {
    const store = useReportHistoryStore()
    const { source, pending } = makeControllableSource()
    store.setSource(source)

    const slowFirst = store.fetchList({ jobTitle: 'frontend' })
    const fastSecond = store.fetchList({ jobTitle: 'backend' })

    pending[1].resolve([makeSummary('backend-row')])
    await fastSecond
    const settled = store.list.map(item => item.id)

    // The abandoned read answers late — after the screen has already settled.
    pending[0].resolve([makeSummary('frontend-row')])
    await slowFirst

    expect(store.list.map(item => item.id)).toEqual(settled)
    expect(store.filters.jobTitle).toBe('backend')
  })

  /** A read the user moved on from must not toast, nor report an error they cannot act on. */
  it('stays quiet when an abandoned read is the one that fails', async () => {
    const store = useReportHistoryStore()
    const rejecters: Array<(err: unknown) => void> = []
    let resolveSecond: (rows: InterviewSummary[]) => void = () => {}

    store.setSource({
      list(filters = {}) {
        return new Promise<ReportHistoryPage>((resolve, reject) => {
          if (filters.jobTitle === 'frontend') rejecters.push(reject)
          else resolveSecond = rows => resolve({ items: rows, total: rows.length })
        })
      },
      async getDetail() {
        return null
      },
      record: vi.fn()
    })

    const abandoned = store.fetchList({ jobTitle: 'frontend' })
    const current = store.fetchList({ jobTitle: 'backend' })

    resolveSecond([makeSummary('backend-row')])
    await current
    rejecters[0](new Error('the abandoned read finally gave up'))

    // It resolves rather than rejecting: nothing is left for the view to catch and toast.
    await expect(abandoned).resolves.toBeUndefined()
    expect(store.error).toBeNull()
    expect(store.list.map(item => item.id)).toEqual(['backend-row'])
  })

  /** The same guard on the detail read: flicking between two past reports. */
  it('shows the report the user last opened, not the one that replied last', async () => {
    const store = useReportHistoryStore()
    const resolvers: Array<(value: { session: never; report: never } | null) => void> = []

    store.setSource({
      async list() {
        return { items: [], total: 0 }
      },
      getDetail(id) {
        return new Promise(resolve => {
          resolvers.push(value => resolve(value === null ? null : ({ ...value, id } as never)))
        })
      },
      record: vi.fn()
    })

    const first = store.fetchDetail('report-a')
    const second = store.fetchDetail('report-b')

    resolvers[1](null)
    resolvers[0]({
      session: { id: 'report-a' } as never,
      report: { overallGrade: 1 } as never
    })
    await Promise.all([first, second])

    // 'report-b' was the one asked for, and it was missing — but 'report-a' lands last.
    expect(store.detail).toBeNull()
    expect(store.isDetailMissing).toBe(true)
  })

  it('does not leave the screen busy forever when two reads overlap', async () => {
    const store = useReportHistoryStore()
    const { source, pending } = makeControllableSource()
    store.setSource(source)

    const first = store.fetchList({ jobTitle: 'frontend' })
    const second = store.fetchList({ jobTitle: 'backend' })

    pending[0].resolve([])
    pending[1].resolve([])
    await Promise.all([first, second])

    expect(store.isBusy).toBe(false)
    expect(store.status).toBe('ready')
  })

  it('sends one read per filter change and never drops the last one', async () => {
    const calls: ReportHistoryQuery[] = []
    const store = useReportHistoryStore()
    store.setSource({
      async list(filters = {}) {
        calls.push({ ...filters })
        return { items: [], total: 0 }
      },
      async getDetail() {
        return null
      },
      record: vi.fn()
    })

    const wrapper = mount(ReportsHistoryView, {
      global: { plugins: [createAppRouter(createMemoryHistory())] }
    })
    await flushPromises()

    // Rattle through the selects the way an impatient user does.
    await wrapper.get('#filter-job-title').setValue('backend')
    await wrapper.get('#filter-level').setValue('senior')
    await wrapper.get('#filter-type').setValue('behavioral')
    await wrapper.get('#filter-job-title').setValue('data')
    await flushPromises()

    expect(calls.length).toBeGreaterThan(1)
    expect(calls[calls.length - 1]).toEqual({
      jobTitle: 'data',
      level: 'senior',
      type: 'behavioral',
      // Every read carries the ordering and the page, so the last one is a complete query.
      sort: 'date-desc',
      page: 1,
      pageSize: 10
    })
    // The date filter was never touched, so it must not be sent at all — `?date=` is a 400.
    expect(calls[calls.length - 1].date).toBeUndefined()
  })

  it('clears back to every row when the filters are cleared', async () => {
    const store = useReportHistoryStore()
    store.setSource({
      async list(filters = {}) {
        const items = filters.jobTitle ? [] : [makeSummary('r1'), makeSummary('r2')]
        return { items, total: items.length }
      },
      async getDetail() {
        return null
      },
      record: vi.fn()
    })

    const wrapper = mount(ReportsHistoryView, {
      global: { plugins: [createAppRouter(createMemoryHistory())] }
    })
    await flushPromises()

    await wrapper.get('#filter-job-title').setValue('devops')
    await flushPromises()
    expect(wrapper.text()).toContain('No interviews match these filters')

    await wrapper.findAll('button').find(b => b.text().includes('Clear filters'))!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.history-row')).toHaveLength(2)
    expect(store.hasFilters).toBe(false)
  })

  it('keeps the empty state honest: "nothing yet" only when nothing is filtered', async () => {
    const store = useReportHistoryStore()
    store.setSource({
      async list() {
        return { items: [], total: 0 }
      },
      async getDetail() {
        return null
      },
      record: vi.fn()
    })

    const wrapper = mount(ReportsHistoryView, {
      global: { plugins: [createAppRouter(createMemoryHistory())] }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('You have not finished an interview yet')

    await wrapper.get('#filter-level').setValue('senior')
    await flushPromises()

    expect(wrapper.text()).toContain('No interviews match these filters')
    expect(wrapper.text()).not.toContain('You have not finished an interview yet')
    expect(store.hasFilters).toBe(true)
  })
})

describe('the detail screen before its read has settled', () => {
  function mountDetail(getDetail: ReportHistorySource['getDetail']) {
    const store = useReportHistoryStore()
    store.setSource({ async list() { return { items: [], total: 0 } }, getDetail, record: vi.fn() })

    const router = createAppRouter(createMemoryHistory())
    router.push('/reports/some-id')

    return { wrapper: mount(ReportHistoryDetailView, { global: { plugins: [router] } }), store }
  }

  /**
   * The template's fallthrough branch is the not-found state, and `isBusy` is false
   * until fetchDetail runs in onMounted — so the very first render of the screen is
   * the "could not be found" message, before anything has been looked up.
   */
  it('renders the not-found message on its first frame, before any lookup has run', async () => {
    const { wrapper } = mountDetail(async () => new Promise(() => {}))

    // Synchronously after mount, before any promise has settled.
    expect(wrapper.text()).toContain('could not be found')
  })

  it('replaces it with the loading state on the next tick, so no user sees it settle wrong', async () => {
    const { wrapper } = mountDetail(async () => new Promise(() => {}))

    await flushPromises()

    expect(wrapper.text()).toContain('Loading that report')
    expect(wrapper.text()).not.toContain('could not be found')
  })

  it('still shows a stale report from a previous visit while the next one loads', async () => {
    // The store is a singleton across navigations: detail is cleared at the start of
    // fetchDetail, so a second visit cannot show the first report's body.
    const store = useReportHistoryStore()
    let resolveSecond: (value: null) => void = () => {}
    const getDetail = vi
      .fn()
      .mockResolvedValueOnce({
        session: {
          id: 'first',
          config: { jobTitle: 'devops', level: 'mid', type: 'technical', questionCount: 1 },
          createdAt: '2026-08-14T10:00:00.000Z',
          asked: [],
          answers: [],
          evaluations: []
        },
        report: { overallGrade: 71, headline: 'First report.', strengths: [], improvements: [], entries: [] }
      })
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveSecond = resolve as (value: null) => void
      }))

    store.setSource({ async list() { return { items: [], total: 0 } }, getDetail, record: vi.fn() })

    await store.fetchDetail('first')
    expect(store.detail?.report.headline).toBe('First report.')

    const second = store.fetchDetail('second')
    expect(store.detail).toBeNull()

    resolveSecond(null)
    await second
    expect(store.isDetailMissing).toBe(true)
  })

  it('shows the not-found state, not a crash, for an id made of junk', async () => {
    const { wrapper } = mountDetail(async () => null)
    await flushPromises()

    expect(wrapper.text()).toContain('could not be found')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

/*
 * The plan's named highest risk: ReportCard.vue was carved out of the already-shipped
 * ReportView.vue. ReportView.spec.ts only ever covered the PDF button, and the
 * byte-for-byte check in ReportCard.spec.ts compares two screens that both render the
 * card — so a wrapper element added inside it would show up in both and pass. This
 * pins the live report's actual DOM shape instead.
 */
describe('the live report screen kept its exact structure through the extraction', () => {
  async function mountLiveReport() {
    const { useInterviewStore } = await import('@/stores/interview.store')
    const store = useInterviewStore()

    store.session = {
      id: 'session-1',
      config: { jobTitle: 'frontend', level: 'senior', type: 'technical', questionCount: 2 },
      createdAt: '2026-08-14T10:00:00.000Z',
      asked: [],
      answers: [],
      evaluations: []
    }
    store.report = {
      overallGrade: 82,
      headline: 'Solid technical grasp.',
      strengths: ['Clear communication'],
      improvements: ['More concrete examples'],
      entries: [
        {
          question: { id: 'q1', text: 'Debug a slow page?', topic: 'Perf', isFollowUp: false, keywords: [] },
          answer: { questionId: 'q1', text: 'Measure first.', submittedAt: '2026-08-14T10:05:00.000Z' },
          evaluation: {
            questionId: 'q1',
            grade: 82,
            summary: 'Good instinct.',
            strengths: ['Measured'],
            improvements: ['Name a tool'],
            needsFollowUp: false
          }
        }
      ]
    }

    const router = createAppRouter(createMemoryHistory())
    router.push('/report')
    await router.isReady()

    const ReportView = (await import('./ReportView.vue')).default
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()

    return wrapper
  }

  it('puts the card content directly in the page stack, with no wrapper element', async () => {
    const wrapper = await mountLiveReport()
    const section = wrapper.get('section.stack-lg')

    // A wrapping <div> inside ReportCard would collapse this to one child and
    // silently change .stack-lg's gap on a screen that already shipped.
    const children = [...section.element.children].map(child => child.tagName.toLowerCase())
    expect(children).toEqual(['header', 'div', 'h2', 'article', 'button', 'button'])
  })

  it('keeps the report cards as siblings of the two action buttons', async () => {
    const wrapper = await mountLiveReport()
    const section = wrapper.get('section.stack-lg')

    const cards = [...section.element.children].filter(child =>
      child.classList.contains('card')
    )
    // header.card, the feedback card, and the one question entry.
    expect(cards).toHaveLength(3)
    expect(section.element.querySelectorAll(':scope > button')).toHaveLength(2)
  })

  it('still renders every part of the report body it did before', async () => {
    const wrapper = await mountLiveReport()

    expect(wrapper.text()).toContain('Your report')
    expect(wrapper.text()).toContain('Solid technical grasp.')
    expect(wrapper.text()).toContain('Recurring strengths')
    expect(wrapper.text()).toContain('Focus on next')
    expect(wrapper.text()).toContain('Question by question')
    expect(wrapper.text()).toContain('Debug a slow page?')
    expect(wrapper.text()).toContain('Measure first.')
    expect(wrapper.findAll('.report-entry')).toHaveLength(1)
    expect(wrapper.findAll('.grade-badge')).toHaveLength(2)
  })
})

describe('the header nav says where you are', () => {
  async function mountAppAt(path: string) {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    signIn()

    router.push(path)
    await router.isReady()
    await flushPromises()

    return { wrapper, router }
  }

  function activeNavLabels(wrapper: ReturnType<typeof mount>): string[] {
    return wrapper.findAll('.app-nav .nav-link.router-link-active').map(link => link.text())
  }

  it('links only the three routes that make sense at any time', async () => {
    const { wrapper } = await mountAppAt('/')

    const labels = wrapper.findAll('.app-nav .nav-link').map(link => link.text())
    expect(labels).toEqual(['Home', 'Practice', 'Reports'])
    // /interview and /report are session-guarded: a static link would just bounce.
    expect(labels).not.toContain('Interview')
    expect(labels).not.toContain('Report')
    // /settings already has two entry points in this header; a third is redundant.
    expect(labels).not.toContain('Settings')
  })

  it.each([
    ['/', 'Home'],
    ['/practice', 'Practice'],
    ['/reports', 'Reports']
  ])('marks exactly one link active on %s', async (path, expected) => {
    const { wrapper } = await mountAppAt(path)

    expect(activeNavLabels(wrapper)).toEqual([expected])
  })

  /**
   * The gap QA found, now closed: `/reports/:id` is nested under a component-less
   * `/reports` parent, so both pages share a matched record and the header keeps
   * saying you are in Reports while you read one of them.
   */
  it('keeps Reports marked active on a report detail page', async () => {
    const { wrapper, router } = await mountAppAt('/reports/some-past-interview')

    expect(router.currentRoute.value.name).toBe('report-detail')
    expect(activeNavLabels(wrapper)).toEqual(['Reports'])
  })

  /** Nesting must not make the nav claim two places at once. */
  it('still marks exactly one link active on a report detail page', async () => {
    const { wrapper } = await mountAppAt('/reports/some-past-interview')

    expect(activeNavLabels(wrapper)).toHaveLength(1)
    expect(activeNavLabels(wrapper)).not.toContain('Home')
  })

  it('does not light up Home on every route just because Home is "/"', async () => {
    const { wrapper } = await mountAppAt('/reports')

    expect(activeNavLabels(wrapper)).not.toContain('Home')
  })

  it('hides the nav entirely when signed out', async () => {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    router.push('/login')
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.app-nav').exists()).toBe(false)
  })
})
