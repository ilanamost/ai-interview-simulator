import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ReportHistoryDetailView from './ReportHistoryDetailView.vue'
import ReportCard from '@/cmps/ReportCard.vue'
import { createAppRouter } from '@/router'
import { useReportHistoryStore } from '@/stores/report-history.store'
import { downloadReportPdf } from '@/services/report-pdf.service'
import { InterviewError } from '@/services/interview.service'
import type { ReportHistoryDetail, ReportHistorySource } from '@/services/report-history.service'
import type { InterviewSession, Report } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'

vi.mock('@/services/report-pdf.service', () => ({ downloadReportPdf: vi.fn() }))

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

const { toast } = await import('vue-sonner')

function makeSession(id: string): InterviewSession {
  return {
    id,
    config: { jobTitle: 'backend', level: 'senior', type: 'behavioral', questionCount: 1 },
    createdAt: '2026-08-14T10:00:00.000Z',
    asked: [{ id: 'q1', text: 'Tell me about a conflict.', topic: 'Teamwork', isFollowUp: false, keywords: [] }],
    answers: [{ questionId: 'q1', text: 'We disagreed on scope.', submittedAt: '2026-08-14T10:05:00.000Z' }],
    evaluations: []
  }
}

function makeReport(overallGrade = 66): Report {
  return {
    overallGrade,
    headline: 'Close to ready.',
    strengths: ['Concrete examples'],
    improvements: ['Name the outcome'],
    entries: [
      {
        question: { id: 'q1', text: 'Tell me about a conflict.', topic: 'Teamwork', isFollowUp: false, keywords: [] },
        answer: { questionId: 'q1', text: 'We disagreed on scope.', submittedAt: '2026-08-14T10:05:00.000Z' },
        evaluation: {
          questionId: 'q1',
          grade: 66,
          summary: 'Reasonable, a little thin.',
          strengths: ['Concrete examples'],
          improvements: ['Name the outcome'],
          needsFollowUp: false
        }
      }
    ]
  }
}

function makeStubSource(details: Record<string, ReportHistoryDetail>, failWith?: InterviewError) {
  const source: ReportHistorySource = {
    async list() {
      return { items: [], total: 0 }
    },
    async getDetail(id) {
      if (failWith) throw failWith
      return details[id] ?? null
    },
    record: vi.fn()
  }

  return source
}

async function mountView(
  options: {
    id?: string
    details?: Record<string, ReportHistoryDetail>
    failWith?: InterviewError
  } = {}
) {
  const {
    id = 'i1',
    details = { i1: { session: makeSession('i1'), report: makeReport() } },
    failWith
  } = options

  setActivePinia(createPinia())
  signIn()

  const store = useReportHistoryStore()
  store.setSource(makeStubSource(details, failWith))

  const router = createAppRouter(createMemoryHistory())
  router.push(`/reports/${id}`)
  await router.isReady()

  const wrapper = mount(ReportHistoryDetailView, { global: { plugins: [router] } })
  await flushPromises()

  return { wrapper, router, store }
}

describe('ReportHistoryDetailView', () => {
  beforeEach(() => {
    vi.mocked(downloadReportPdf).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('renders the report for the id in the route', async () => {
    const { wrapper } = await mountView()

    const card = wrapper.findComponent(ReportCard)
    expect(card.exists()).toBe(true)
    expect(card.props('session').id).toBe('i1')
    expect(card.props('report').overallGrade).toBe(66)
    expect(wrapper.text()).toContain('Tell me about a conflict.')
  })

  /**
   * The one screen plan 015 animates. Asserted here as well as in `ReportCard.spec.ts`
   * because this view is what passes the prop — dropping it would leave the component's
   * own tests green.
   */
  it('animates its cards in, staggered top-down', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.findComponent(ReportCard).props('animate')).toBe(true)

    const cards = wrapper.findAll('.card')
    expect(cards.length).toBeGreaterThan(1)

    let previous = -1
    for (const card of cards) {
      expect(card.classes()).toContain('card-in')

      const delay = Number(card.attributes('style')?.match(/animation-delay:\s*(\d+)ms/)?.[1])
      expect(delay).toBeGreaterThanOrEqual(previous)
      previous = delay
    }
  })

  it('renders the entry that belongs to the requested id, not the first one stored', async () => {
    const details = {
      i1: { session: makeSession('i1'), report: makeReport(20) },
      i2: { session: makeSession('i2'), report: makeReport(95) }
    }

    const { wrapper } = await mountView({ id: 'i2', details })

    expect(wrapper.findComponent(ReportCard).props('session').id).toBe('i2')
    expect(wrapper.findComponent(ReportCard).props('report').overallGrade).toBe(95)
  })

  it('downloads the PDF for that past interview, not the live one', async () => {
    const { wrapper, store } = await mountView()

    const button = wrapper.findAll('button').find(b => b.text().includes('Download PDF'))
    expect(button).toBeTruthy()

    await button!.trigger('click')

    expect(downloadReportPdf).toHaveBeenCalledOnce()
    expect(downloadReportPdf).toHaveBeenCalledWith(store.detail!.session, store.detail!.report)
  })

  it('offers a way back to the history and no way to restart the live flow', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('.back-link').attributes('href')).toBe('/reports')
    expect(wrapper.findAll('button').some(b => b.text().includes('Run another interview'))).toBe(false)
  })

  describe('an id that has no report behind it', () => {
    it('shows a clear not-found state instead of an empty report shell', async () => {
      const { wrapper } = await mountView({ id: 'ghost', details: {} })

      expect(wrapper.findComponent(ReportCard).exists()).toBe(false)
      expect(wrapper.get('.empty-state').text()).toContain('could not be found')
      expect(wrapper.get('.empty-state a').attributes('href')).toBe('/reports')
    })

    it('does not toast a missing report as if the load had failed', async () => {
      await mountView({ id: 'ghost', details: {} })

      expect(toast.error).not.toHaveBeenCalled()
    })

    it('offers no download button when there is nothing to download', async () => {
      const { wrapper } = await mountView({ id: 'ghost', details: {} })

      expect(wrapper.findAll('button').some(b => b.text().includes('Download PDF'))).toBe(false)
    })
  })

  it('toasts a real load failure and still shows a way back', async () => {
    const { wrapper } = await mountView({
      failWith: new InterviewError('INTERNAL_ERROR', 'Could not load that report.')
    })

    expect(toast.error).toHaveBeenCalledWith('Could not load that report.')
    expect(wrapper.get('.empty-state a').attributes('href')).toBe('/reports')
  })
})
