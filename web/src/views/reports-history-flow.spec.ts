import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, type Router } from 'vue-router'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { signIn } from '@/test/auth-fixture'
import { stubMatchMedia } from '@/test/theme-fixture'
import { downloadReportPdf } from '@/services/report-pdf.service'

vi.mock('@/services/report-pdf.service', () => ({ downloadReportPdf: vi.fn() }))

/**
 * End-to-end pass over reports history on the real app: real router, real stores, real
 * mock source. The point is the round trip — an interview finished through the UI has
 * to be findable under /reports afterwards, which no isolated service test can prove.
 */

beforeEach(() => {
  // The header's theme toggle asks jsdom for a system color scheme it does not implement.
  stubMatchMedia()
  localStorage.clear()
  vi.mocked(downloadReportPdf).mockClear()
})

async function waitFor(check: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await flushPromises()
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  throw new Error(`Timed out waiting for: ${label}`)
}

async function mountApp() {
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
  signIn()

  router.push('/practice')
  await router.isReady()
  await flushPromises()

  return { wrapper, router }
}

const THOROUGH_ANSWER = `I would start by measuring rather than guessing, because the profile
  usually contradicts the assumption. For example on my last project we looked at the router,
  the component render path, the state we kept in the store, the fetch waterfall and the cache,
  and added a loading skeleton once we could see where the time actually went. However the
  tradeoff is that instrumentation is code you have to maintain, and the reason I still do it is
  that the scope of a regression stays obvious and anything worth sharing can live in the url.`

/** Fill in the setup form, answer everything, and land on the finished report. */
async function completeInterview(
  wrapper: VueWrapper,
  router: Router,
  config: { jobTitle?: string; level?: string; type?: string } = {}
) {
  await router.push('/practice')
  await waitFor(() => wrapper.find('#job-title').exists(), 'setup form')

  if (config.jobTitle) await wrapper.get('#job-title').setValue(config.jobTitle)
  if (config.level) await wrapper.get('#level').setValue(config.level)
  if (config.type) await wrapper.get('#type').setValue(config.type)
  await wrapper.get('#count').setValue('3')

  await wrapper.get('form').trigger('submit')
  await waitFor(() => router.currentRoute.value.path === '/interview', 'interview screen')

  let guard = 0
  while (router.currentRoute.value.path === '/interview' && guard++ < 12) {
    if (wrapper.find('textarea').exists()) {
      await wrapper.get('textarea').setValue(THOROUGH_ANSWER)
      await wrapper.get('form').trigger('submit')
      await waitFor(() => wrapper.text().includes('Feedback'), 'evaluation feedback')
    }

    const advance = wrapper.findAll('button').find(b => /Next question|See your report/.test(b.text()))
    if (!advance) break

    await advance.trigger('click')
    await waitFor(
      () => router.currentRoute.value.path === '/report' || wrapper.find('textarea').exists(),
      'next question or report'
    )
  }

  await waitFor(() => router.currentRoute.value.path === '/report', 'finished report')
}

async function goToHistory(wrapper: VueWrapper, router: Router) {
  await router.push('/reports')
  await waitFor(() => wrapper.find('.history-filters').exists(), 'reports history')
  await flushPromises()
}

describe('a finished interview reaches the reports history', () => {
  it('is not there before anything has been finished', async () => {
    const { wrapper, router } = await mountApp()

    await goToHistory(wrapper, router)

    expect(wrapper.findAll('.history-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('You have not finished an interview yet')
  })

  it('shows up as a row the moment its report is built', async () => {
    const { wrapper, router } = await mountApp()

    await completeInterview(wrapper, router, { jobTitle: 'backend', level: 'senior' })
    const liveGrade = wrapper.get('.grade-badge').text()

    await goToHistory(wrapper, router)

    const rows = wrapper.findAll('.history-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Backend Developer')
    expect(rows[0].text()).toContain('Senior (5+ years)')
    // The row's grade is the report's grade, not a second, separately derived number.
    expect(rows[0].get('.grade-badge').text()).toBe(liveGrade)
  })

  it('opens that row into the same report, downloadable as a PDF', async () => {
    const { wrapper, router } = await mountApp()
    await completeInterview(wrapper, router, { jobTitle: 'devops' })
    await goToHistory(wrapper, router)

    await wrapper.get('.history-row').trigger('click')
    await waitFor(() => router.currentRoute.value.name === 'report-detail', 'report detail')

    expect(wrapper.text()).toContain('Your report')
    expect(wrapper.text()).toContain('Question by question')
    expect(wrapper.text()).toContain('DevOps Engineer')

    const download = wrapper.findAll('button').find(b => b.text().includes('Download PDF'))
    await download!.trigger('click')
    expect(downloadReportPdf).toHaveBeenCalledOnce()
  })

  it('keeps every finished interview, and filters down to one of them', async () => {
    const { wrapper, router } = await mountApp()

    await completeInterview(wrapper, router, { jobTitle: 'frontend' })
    await completeInterview(wrapper, router, { jobTitle: 'data' })
    await goToHistory(wrapper, router)

    expect(wrapper.findAll('.history-row')).toHaveLength(2)

    await wrapper.get('#filter-job-title').setValue('data')
    await flushPromises()

    const rows = wrapper.findAll('.history-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Data Engineer')
  })

  it('says so plainly when a filter matches none of them', async () => {
    const { wrapper, router } = await mountApp()
    await completeInterview(wrapper, router, { jobTitle: 'frontend' })
    await goToHistory(wrapper, router)

    await wrapper.get('#filter-job-title').setValue('devops')
    await flushPromises()

    expect(wrapper.findAll('.history-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('No interviews match these filters')
  })

  /** History outlives the live session: starting over must not erase what was finished. */
  it('survives running another interview from the finished report', async () => {
    const { wrapper, router } = await mountApp()
    await completeInterview(wrapper, router, { jobTitle: 'frontend' })

    const restart = wrapper.findAll('button').find(b => b.text().includes('Run another interview'))
    await restart!.trigger('click')
    await waitFor(() => router.currentRoute.value.name === 'setup', 'setup form')

    await goToHistory(wrapper, router)

    expect(wrapper.findAll('.history-row')).toHaveLength(1)
  })

  it('shows a not-found state for a history url that points at nothing', async () => {
    const { wrapper, router } = await mountApp()

    await router.push('/reports/never-happened')
    await waitFor(() => wrapper.find('.empty-state').exists(), 'not-found state')

    expect(wrapper.text()).toContain('could not be found')
    expect(router.currentRoute.value.name).toBe('report-detail')
  })
})
