import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import ReportCard from './ReportCard.vue'
import type { InterviewSession, Report, ReportEntry } from '@/types/interview'
import { MAX_STAGGER_MS, STAGGER_STEP_MS } from '@/services/animation.service'

/**
 * QA adversarial pass on plan 015 item 2. `ReportCard.spec.ts` already covers the
 * default-off guard, the top-down stagger and the cap on a long report; these are the
 * edge-case shapes it does not reach — a report with no questions at all, one with no
 * feedback to show, and one long enough that the cap has to hold for most of the cards.
 */

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

function makeEntry(id: string): ReportEntry {
  return {
    question: { id, text: `Question ${id}?`, topic: 'Perf', isFollowUp: false, keywords: [] },
    answer: { questionId: id, text: 'An answer.', submittedAt: '2026-08-14T10:05:00.000Z' },
    evaluation: {
      questionId: id,
      grade: 70,
      summary: 'Reasonable.',
      strengths: [],
      improvements: [],
      needsFollowUp: false
    }
  }
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    overallGrade: 82,
    headline: 'Solid technical grasp.',
    strengths: ['Clear communication'],
    improvements: ['More concrete examples'],
    entries: [makeEntry('q1')],
    ...overrides
  }
}

function mountCard(report: Report, animate?: boolean) {
  return mount(ReportCard, { props: { session: makeSession(), report, animate } })
}

function delayOf(el: DOMWrapper<Element>): number | null {
  const raw = el.attributes('style')?.match(/animation-delay:\s*(\d+)ms/)?.[1]
  return raw === undefined ? null : Number(raw)
}

describe('the entrance animation on edge-case reports', () => {
  /**
   * A report with no entries still renders the two header cards. They must animate, and the
   * absent entries must not leave a gap in the stagger or an unmarked card behind.
   */
  it('animates the header cards of a report with no questions at all', () => {
    const wrapper = mountCard(makeReport({ entries: [] }), true)

    const cards = wrapper.findAll('.card')
    expect(cards).toHaveLength(2)

    for (const card of cards) {
      expect(card.classes()).toContain('card-in')
    }
    expect(cards.map(delayOf)).toEqual([0, STAGGER_STEP_MS])
    expect(wrapper.find('.report-entry').exists()).toBe(false)
  })

  it('leaves a no-questions report untouched when animate is off', () => {
    const wrapper = mountCard(makeReport({ entries: [] }), false)

    expect(wrapper.find('.card-in').exists()).toBe(false)
    expect(wrapper.find('[style]').exists()).toBe(false)
  })

  /** No strengths and no improvements: the feedback card renders empty but still animates. */
  it('marks the feedback card even when it has no feedback groups to show', () => {
    const wrapper = mountCard(makeReport({ strengths: [], improvements: [] }), true)

    const cards = wrapper.findAll('.card')
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card.classes()).toContain('card-in')
    }
    expect(wrapper.find('.feedback-group').exists()).toBe(false)
  })

  /**
   * The reduced-motion consideration from the plan: the global reset neutralises
   * `animation-duration` but NOT the inline `animation-delay`, so a reader with reduced
   * motion still waits out whatever delay is set. Every card must therefore be capped, not
   * just the last one — a 40-card report must not hide its tail behind a growing delay.
   */
  it('caps every card on an absurdly long report, not just the final one', () => {
    const entries = Array.from({ length: 40 }, (_, i) => makeEntry(`q${i}`))
    const wrapper = mountCard(makeReport({ entries }), true)

    const cards = wrapper.findAll('.card')
    expect(cards).toHaveLength(42)

    const delays = cards.map(card => delayOf(card)!)
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(MAX_STAGGER_MS)
      expect(delay).toBeGreaterThanOrEqual(0)
    }
    // Non-decreasing, and pinned at the cap once it gets there.
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(delays.at(-1)).toBe(MAX_STAGGER_MS)
  })

  /** Toggling the prop must add and remove the marking cleanly, leaving no empty attribute. */
  it('adds and fully removes the marking when the prop flips', async () => {
    const wrapper = mountCard(makeReport(), false)
    expect(wrapper.find('.card-in').exists()).toBe(false)

    await wrapper.setProps({ animate: true })
    expect(wrapper.findAll('.card-in')).toHaveLength(wrapper.findAll('.card').length)

    await wrapper.setProps({ animate: false })
    expect(wrapper.find('.card-in').exists()).toBe(false)
    for (const card of wrapper.findAll('.card')) {
      expect(card.attributes('style')).toBeUndefined()
    }
  })
})
