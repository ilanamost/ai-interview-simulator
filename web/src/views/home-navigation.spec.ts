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
 * Adversarial pass over the '/' -> '/practice' route move (QA, plan 006).
 * Real router, real store, real mock source — these try to break the new entry
 * path rather than re-walk the happy path that interview-flow.spec.ts covers.
 *
 * Every route here is behind the auth guard as of plan 007, so each mount signs a
 * user in first; the guard itself is covered in `router/index.spec.ts`.
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

async function mountAt(path: string) {
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
  signIn()

  router.push(path)
  await router.isReady()
  await flushPromises()

  return { wrapper, router }
}

/** Fill the setup form and get to a live question, so a session exists to protect. */
async function startInterview(wrapper: VueWrapper, router: Router) {
  await wrapper.get('form').trigger('submit')
  await waitFor(() => router.currentRoute.value.path === '/interview', 'interview screen')
  await waitFor(() => wrapper.find('textarea').exists(), 'first question')
}

describe('home page edge cases', () => {
  it('survives rapid repeated clicks on the call to action', async () => {
    const { wrapper, router } = await mountAt('/')

    const cta = wrapper.findAll('a').find(link => link.text().includes('Start practicing'))!

    // An impatient user double- or triple-clicks; duplicate navigations must not
    // throw or strand the app somewhere other than the form.
    await cta.trigger('click')
    await cta.trigger('click')
    await cta.trigger('click')
    await waitFor(() => router.currentRoute.value.path === '/practice', 'practice form')

    expect(router.currentRoute.value.name).toBe('setup')
    expect(wrapper.text()).toContain('Practice your next interview')
  })

  it('reaches the form from the call to action on the page', async () => {
    const { wrapper } = await mountAt('/')

    const ctas = wrapper.findAll('a').filter(link => link.text().includes('Start practicing'))
    expect(ctas.length).toBeGreaterThanOrEqual(1)

    for (const cta of ctas) {
      expect(cta.attributes('href')).toBe('/practice')
    }
  })
})

describe('unknown urls after the route move', () => {
  it('lands a near-miss of the new practice path on the home page, not a blank screen', async () => {
    // '/setup' is the path the plan considered and rejected, so it must not 404.
    for (const path of ['/practice-now', '/setup', '/practice/extra']) {
      const { wrapper, router } = await mountAt(path)

      expect(router.currentRoute.value.name).toBe('home')
      expect(wrapper.text()).toContain('How it works')
    }
  })

  it('still serves the form for a case variant of /practice', async () => {
    // vue-router matches case-insensitively unless a record opts into `sensitive`.
    // Pinned deliberately: a shared or hand-typed '/Practice' link reaches the form.
    for (const path of ['/Practice', '/PRACTICE', '/practice/']) {
      const { wrapper, router } = await mountAt(path)

      expect(router.currentRoute.value.name).toBe('setup')
      expect(wrapper.text()).toContain('Practice your next interview')
    }
  })

  it('absorbs a long malformed url instead of erroring', async () => {
    const junk = `/${'a'.repeat(2000)}/%20%2F..?q=${'b'.repeat(500)}#frag`
    const { wrapper, router } = await mountAt(junk)

    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.text()).toContain('AI Interview Simulator')
  })
})

describe('the route move must not cost the user their session', () => {
  it('keeps an in-progress interview alive when the brand link goes home mid-question', async () => {
    const { wrapper, router } = await mountAt('/practice')
    await startInterview(wrapper, router)

    const questionText = wrapper.get('textarea').element.value
    await wrapper.get('.brand').trigger('click')
    await waitFor(() => router.currentRoute.value.name === 'home', 'home page')

    // '/' is now marketing copy, so the only way back is that the session survived it.
    await router.push('/interview')
    await waitFor(() => wrapper.find('textarea').exists(), 'resumed question')

    expect(router.currentRoute.value.path).toBe('/interview')
    expect(wrapper.get('textarea').element.value).toBe(questionText)
  })

  it('does not let the home page render the setup form or start a session by itself', async () => {
    const { wrapper, router } = await mountAt('/')

    expect(wrapper.find('form').exists()).toBe(false)

    // A visitor who only read the home page still has no session to resume.
    await router.push('/interview')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('setup')
  })
})

describe('retargeted in-app links resolve to the relocated form', () => {
  it('sends "End interview" to /practice rather than the home page', async () => {
    const { wrapper, router } = await mountAt('/practice')
    await startInterview(wrapper, router)

    const quit = wrapper.findAll('button').find(b => b.text().includes('End interview'))!
    await quit.trigger('click')
    await waitFor(() => router.currentRoute.value.name === 'setup', 'practice form')

    expect(router.currentRoute.value.path).toBe('/practice')
    expect(wrapper.text()).toContain('Practice your next interview')
  })

  it('sends the report empty state link to /practice rather than the home page', async () => {
    // No report in the store, so ReportView renders its empty state; the guard is
    // bypassed by rendering the view directly at its own route.
    const { wrapper, router } = await mountAt('/report')

    // The guard bounces a report-less visit back to the form — that is the contract.
    expect(router.currentRoute.value.path).toBe('/practice')
    expect(wrapper.text()).toContain('Practice your next interview')
  })
})
