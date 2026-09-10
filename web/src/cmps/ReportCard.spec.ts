import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ReportCard from './ReportCard.vue'
import GradeBadge from './GradeBadge.vue'
import ReportView from '@/views/ReportView.vue'
import ReportHistoryDetailView from '@/views/ReportHistoryDetailView.vue'
import { createAppRouter } from '@/router'
import { useInterviewStore } from '@/stores/interview.store'
import { useReportHistoryStore } from '@/stores/report-history.store'
import type { ReportHistorySource } from '@/services/report-history.service'
import type { InterviewSession, Report } from '@/types/interview'
import { MAX_STAGGER_MS } from '@/services/animation.service'
import { signIn } from '@/test/auth-fixture'

vi.mock('@/services/report-pdf.service', () => ({ downloadReportPdf: vi.fn() }))

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

function makeSession(): InterviewSession {
  return {
    id: 'session-1',
    config: { jobTitle: 'frontend', level: 'senior', type: 'technical', questionCount: 1 },
    createdAt: '2026-08-14T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: []
  }
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    overallGrade: 82,
    headline: 'Solid technical grasp.',
    strengths: ['Clear communication'],
    improvements: ['More concrete examples'],
    entries: [
      {
        question: { id: 'q1', text: 'How do you debug a slow page?', topic: 'Perf', isFollowUp: false, keywords: [] },
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
    ],
    ...overrides
  }
}

function mountCard(report = makeReport(), animate?: boolean) {
  return mount(ReportCard, { props: { session: makeSession(), report, animate } })
}

/** A report with enough cards for the stagger to have somewhere to go. */
function makeLongReport(): Report {
  const [first] = makeReport().entries

  return makeReport({
    entries: Array.from({ length: 8 }, (_, index) => ({
      ...first,
      question: { ...first.question, id: `q${index}` }
    }))
  })
}

function delayOf(el: DOMWrapper<Element>): number | null {
  const raw = el.attributes('style')?.match(/animation-delay:\s*(\d+)ms/)?.[1]
  return raw === undefined ? null : Number(raw)
}

/**
 * Everything `ReportCard` renders, and nothing either view adds around it — both
 * views put it alone inside a `.stack-lg`, so its cards and heading are the whole set.
 */
function reportBody(wrapper: VueWrapper): string {
  return wrapper.findAll('.card, h2').map(el => el.html()).join('\n')
}

/**
 * The entrance animation is the one intended difference between the two screens (plan
 * 015: only the history detail route passes `animate`), so it is normalised away before
 * comparing them. Everything else still has to match byte for byte, and the paired
 * `ReportView.spec.ts` / `ReportHistoryDetailView.spec.ts` assertions pin which screen
 * gets the marking.
 */
function withoutAnimation(html: string): string {
  return html.replace(/\s*style="animation-delay:[^"]*"/g, '').replace(/\s+card-in\b/g, '')
}

describe('ReportCard', () => {
  it('heads the report with the interview config, the headline and the overall grade', () => {
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('Frontend Developer')
    expect(wrapper.text()).toContain('Senior (5+ years)')
    expect(wrapper.text()).toContain('Technical')
    expect(wrapper.text()).toContain('Your report')
    expect(wrapper.text()).toContain('Solid technical grasp.')
    expect(wrapper.findComponent(GradeBadge).props()).toMatchObject({ grade: 82, large: true })
  })

  it('lists the recurring strengths and what to focus on next', () => {
    const wrapper = mountCard()

    expect(wrapper.text()).toContain('Recurring strengths')
    expect(wrapper.text()).toContain('Clear communication')
    expect(wrapper.text()).toContain('Focus on next')
    expect(wrapper.text()).toContain('More concrete examples')
  })

  it('renders one entry per question, with its answer, summary and improvements', () => {
    const wrapper = mountCard()

    const entries = wrapper.findAll('.report-entry')
    expect(entries).toHaveLength(1)
    expect(entries[0].text()).toContain('How do you debug a slow page?')
    expect(entries[0].get('.answer-text').text()).toBe('Measure first.')
    expect(entries[0].text()).toContain('Good instinct.')
    expect(entries[0].text()).toContain('Name a tool')
  })

  it('leaves out the feedback groups a report has nothing for', () => {
    const wrapper = mountCard(makeReport({ strengths: [], improvements: [], entries: [] }))

    expect(wrapper.text()).not.toContain('Recurring strengths')
    expect(wrapper.text()).not.toContain('Focus on next')
    expect(wrapper.findAll('.report-entry')).toHaveLength(0)
    // The section heading stays, so the page never ends mid-thought.
    expect(wrapper.text()).toContain('Question by question')
  })
})

/**
 * The `animate` prop is what keeps the shared component from animating the live report
 * screen. Its default-off half is the regression guard for `ReportView.vue`, which plan
 * 015 deliberately does not edit at all.
 */
describe('the opt-in entrance animation', () => {
  it('marks nothing at all by default', () => {
    const wrapper = mountCard()

    expect(wrapper.find('.card-in').exists()).toBe(false)
    for (const card of wrapper.findAll('.card')) {
      // Absent, not empty: an inline style attribute would still outrank the reduced-motion reset.
      expect(card.attributes('style')).toBeUndefined()
    }
  })

  it('marks nothing when animate is explicitly false', () => {
    const wrapper = mountCard(makeReport(), false)

    expect(wrapper.find('.card-in').exists()).toBe(false)
    expect(wrapper.find('[style]').exists()).toBe(false)
  })

  it('marks every card it renders when animate is set, keeping their existing classes', () => {
    const wrapper = mountCard(makeReport(), true)

    const cards = wrapper.findAll('.card')
    expect(cards.length).toBe(3)

    for (const card of cards) {
      expect(card.classes()).toContain('card')
      expect(card.classes()).toContain('card-in')
    }
    // The heading between the feedback card and the entries is not a card and must not animate.
    expect(wrapper.get('h2').classes()).not.toContain('card-in')
  })

  it('staggers the cards top-down so the report reads in order', () => {
    const wrapper = mountCard(makeReport(), true)

    const delays = wrapper.findAll('.card').map(delayOf)
    expect(delays[0]).toBe(0)

    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!)
    }
  })

  /** A report with follow-ups renders many cards, so the cap is not optional here. */
  it('never keeps the reader waiting past the shared cap, however many entries there are', () => {
    const wrapper = mountCard(makeLongReport(), true)

    const delays = wrapper.findAll('.card').map(card => delayOf(card)!)
    expect(delays).toHaveLength(10)
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_STAGGER_MS)
  })
})

/**
 * The extraction is the whole risk here: `ReportView` was already shipped and QA'd, so
 * the live report screen has to render exactly what a historical one does, from the
 * same markup, and go on carrying its own buttons around it.
 */
describe('the same card behind the live report and a past one', () => {
  async function mountLiveReport() {
    setActivePinia(createPinia())
    signIn()

    const store = useInterviewStore()
    store.session = makeSession()
    store.report = makeReport()

    const router = createAppRouter(createMemoryHistory())
    router.push('/report')
    await router.isReady()

    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()

    return wrapper
  }

  async function mountPastReport() {
    setActivePinia(createPinia())
    signIn()

    const source: ReportHistorySource = {
      async list() {
        return { items: [], total: 0 }
      },
      async getDetail() {
        return { session: makeSession(), report: makeReport() }
      },
      record: vi.fn()
    }
    useReportHistoryStore().setSource(source)

    const router = createAppRouter(createMemoryHistory())
    router.push('/reports/session-1')
    await router.isReady()

    const wrapper = mount(ReportHistoryDetailView, { global: { plugins: [router] } })
    await flushPromises()

    return wrapper
  }

  it('renders byte-for-byte identical report markup on both screens, animation aside', async () => {
    const live = await mountLiveReport()
    const past = await mountPastReport()

    expect(withoutAnimation(reportBody(past))).toBe(reportBody(live))
  })

  /** The live report is the one that must be unchanged, so it is asserted literally. */
  it('animates the past report only, leaving the live one exactly as it shipped', async () => {
    const live = await mountLiveReport()
    const past = await mountPastReport()

    expect(reportBody(live)).not.toContain('card-in')
    expect(reportBody(live)).not.toContain('animation-delay')
    expect(past.findAll('.card-in')).toHaveLength(past.findAll('.card').length)
  })

  it('still gives the live report its own actions, unchanged', async () => {
    const live = await mountLiveReport()

    const labels = live.findAll('button').map(b => b.text())
    expect(labels.some(label => label.includes('Download PDF'))).toBe(true)
    expect(labels.some(label => label.includes('Run another interview'))).toBe(true)
  })

  it('keeps the report body a direct child of the page stack, not wrapped in a new element', async () => {
    const live = await mountLiveReport()

    // A wrapper div would silently break `.stack-lg`'s spacing on an already-shipped screen.
    const section = live.get('section.stack-lg')
    const childClasses = [...section.element.children].map(child => child.className)
    expect(childClasses.filter(className => className.includes('card')).length).toBeGreaterThan(0)
  })

  it('reads only its props, so a past report is never fed by the live interview store', async () => {
    const past = await mountPastReport()

    expect(useInterviewStore().session).toBeNull()
    expect(useInterviewStore().report).toBeNull()
    expect(past.findComponent(ReportCard).props('session').id).toBe('session-1')
  })
})
