import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import ReportView from './ReportView.vue'
import { useInterviewStore } from '@/stores/interview.store'
import { downloadReportPdf } from '@/services/report-pdf.service'
import type { InterviewSession, Report } from '@/types/interview'

vi.mock('@/services/report-pdf.service', () => ({
  downloadReportPdf: vi.fn()
}))

function makeSession(): InterviewSession {
  return {
    id: 'session-1',
    config: { jobTitle: 'frontend', level: 'senior', type: 'technical', questionCount: 1 },
    createdAt: '2026-07-26T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: []
  }
}

function makeReport(): Report {
  return {
    overallGrade: 82,
    headline: 'Solid technical grasp.',
    strengths: ['Clear communication'],
    improvements: ['More concrete examples'],
    entries: []
  }
}

function mountReportView() {
  setActivePinia(createPinia())
  const store = useInterviewStore()
  store.session = makeSession()
  store.report = makeReport()

  const router = createRouter({ history: createWebHistory(), routes: [{ path: '/', component: {} }] })
  const wrapper = mount(ReportView, {
    global: { plugins: [router], stubs: { RouterLink: true } }
  })

  return { wrapper, store }
}

describe('ReportView', () => {
  it('downloads the report PDF with the current session and report on click', async () => {
    const { wrapper, store } = mountReportView()

    const button = wrapper.findAll('button').find(b => b.text().includes('Download PDF'))
    expect(button).toBeTruthy()

    await button!.trigger('click')

    expect(downloadReportPdf).toHaveBeenCalledOnce()
    expect(downloadReportPdf).toHaveBeenCalledWith(store.session, store.report)
  })

  /**
   * Plan 015 animates the history detail route only, and does not edit this view at all.
   * `ReportCard`'s `animate` prop defaults to false, so this is the regression guard for
   * the already-shipped live report screen.
   */
  it('leaves the live report unanimated', () => {
    const { wrapper } = mountReportView()

    expect(wrapper.findAll('.card').length).toBeGreaterThan(0)
    expect(wrapper.find('.card-in').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('animation-delay')
  })
})
