import { beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, type Router } from 'vue-router'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { signIn } from '@/test/auth-fixture'
import { stubMatchMedia } from '@/test/theme-fixture'

// The header's theme toggle asks the browser for the system color scheme, which jsdom
// does not implement — stub it before anything mounts `App`.
beforeEach(() => {
  stubMatchMedia()
})

/**
 * End-to-end pass over the real app: real router, real store, real mock source.
 * Nothing is stubbed, so this is the closest thing to clicking through the UI.
 *
 * As of plan 007 the whole app sits behind the auth guard, so each mount signs a
 * user in first — the guard's own redirects live in `router/index.spec.ts`.
 */

/**
 * Route components are lazy-loaded, so a rendered result can be one dynamic
 * import away rather than one microtask away. Poll until the DOM catches up.
 */
async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
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

  // The flow starts at the setup form, which now lives at /practice — '/' is the home page.
  router.push('/practice')
  await router.isReady()
  await flushPromises()

  return { wrapper, router }
}

async function startInterview(wrapper: VueWrapper, router: Router) {
  await wrapper.get('form').trigger('submit')
  await waitFor(() => router.currentRoute.value.path === '/interview', 'interview screen')
  await waitFor(() => wrapper.find('textarea').exists(), 'first question')
}

/** Fill the visible answer box and submit it, then wait for the feedback to render. */
async function answerCurrentQuestion(wrapper: VueWrapper, text: string) {
  await wrapper.get('textarea').setValue(text)
  await wrapper.get('form').trigger('submit')
  await waitFor(() => wrapper.text().includes('Feedback'), 'evaluation feedback')
}

function findAdvanceButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find(b => /Next question|See your report/.test(b.text()))
}

const THOROUGH_ANSWER = `I would start by measuring rather than guessing, because the profile
  usually contradicts the assumption. For example on my last project we looked at the router,
  the component render path, the state we kept in the store, the fetch waterfall and the cache,
  and added a loading skeleton once we could see where the time actually went. However the
  tradeoff is that instrumentation is code you have to maintain, and the reason I still do it is
  that the scope of a regression stays obvious and anything worth sharing can live in the url.`

describe('home page entry', () => {
  it('shows the home page at / and reaches the practice form from its call to action', async () => {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
  signIn()

    router.push('/')
    await router.isReady()
    await flushPromises()

    expect(wrapper.text()).toContain('How it works')
    expect(wrapper.text()).toContain('Key features')

    const cta = wrapper.findAll('a').find(link => link.text().includes('Start practicing'))
    await cta!.trigger('click')
    await waitFor(() => router.currentRoute.value.path === '/practice', 'practice form')

    expect(router.currentRoute.value.name).toBe('setup')
    expect(wrapper.text()).toContain('Practice your next interview')
  })

  it('returns to the home page from the header brand link on any screen', async () => {
    const { wrapper, router } = await mountApp()

    await wrapper.get('.brand').trigger('click')
    await waitFor(() => router.currentRoute.value.path === '/', 'home page')

    expect(router.currentRoute.value.name).toBe('home')
  })
})

describe('interview flow', () => {
  it('walks setup through answering to a final report', async () => {
    const { wrapper, router } = await mountApp()

    expect(wrapper.text()).toContain('Practice your next interview')

    await wrapper.get('#job-title').setValue('backend')
    await wrapper.get('#count').setValue('3')
    await startInterview(wrapper, router)

    expect(wrapper.text()).toContain('Question 1 of 3')

    // Answer every question the interviewer serves, including any follow-ups.
    let guard = 0
    while (router.currentRoute.value.path === '/interview' && guard++ < 12) {
      if (wrapper.find('textarea').exists()) {
        await answerCurrentQuestion(wrapper, THOROUGH_ANSWER)
      }

      const advance = findAdvanceButton(wrapper)
      if (!advance) break

      await advance.trigger('click')
      await waitFor(
        () => router.currentRoute.value.path === '/report' || wrapper.find('textarea').exists(),
        'next question or report'
      )
    }

    expect(router.currentRoute.value.path).toBe('/report')
    expect(wrapper.text()).toContain('Your report')
    expect(wrapper.text()).toContain('Question by question')
    expect(wrapper.text()).toContain('/ 100')
  })

  it('serves a follow-up question after a weak answer', async () => {
    const { wrapper, router } = await mountApp()
    await startInterview(wrapper, router)

    await answerCurrentQuestion(wrapper, 'I do not know.')
    await findAdvanceButton(wrapper)!.trigger('click')
    await waitFor(() => wrapper.find('textarea').exists(), 'follow-up question')

    expect(wrapper.text()).toContain('Follow-up on your previous answer')
  })

  it('counts only base questions in progress when a follow-up is served', async () => {
    const { wrapper, router } = await mountApp()

    await wrapper.get('#count').setValue('3')
    await startInterview(wrapper, router)

    await answerCurrentQuestion(wrapper, 'I do not know.')
    await findAdvanceButton(wrapper)!.trigger('click')
    await waitFor(() => wrapper.find('textarea').exists(), 'follow-up question')

    // One base question answered, so the follow-up still reads as question 2 of 3.
    expect(wrapper.text()).toContain('Question 2 of 3')
  })

  it('shows a user-safe message instead of grading an empty answer', async () => {
    const { wrapper, router } = await mountApp()
    await startInterview(wrapper, router)

    await wrapper.get('textarea').setValue('   ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    // The submit button guards this, so the answer never reaches the grader.
    expect(wrapper.text()).not.toContain('Feedback')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('redirects to setup when the interview screen is opened without a session', async () => {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
  signIn()

    router.push('/interview')
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('setup')
    expect(wrapper.text()).toContain('Practice your next interview')
  })

  it('redirects to setup when the report is opened before finishing', async () => {
    const { router } = await mountApp()

    await router.push('/report')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('setup')
  })
})
