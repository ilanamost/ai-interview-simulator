import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from './HomeView.vue'
import SetupView from './SetupView.vue'
import LoginView from './LoginView.vue'
import { createAppRouter } from '@/router'

/**
 * Adversarial pass over the card entrance animation (QA, plan 010). jsdom computes
 * no animation, so the testable surface is the seam: which elements are marked,
 * what the per-item delay is, whether the marking survives an accordion cycle, and
 * — the part worth guarding hardest — that nothing outside the two views the plan
 * named got animated along the way.
 */

async function mountHome() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  router.push('/')
  await router.isReady()

  return mount(HomeView, { global: { plugins: [pinia, router] }, attachTo: document.body })
}

function section(wrapper: VueWrapper, title: string) {
  const found = wrapper
    .findAll('.accordion')
    .find(candidate => candidate.get('.accordion-title').text() === title)

  if (!found) throw new Error(`No section titled "${title}"`)

  return found
}

async function toggleSection(wrapper: VueWrapper, title: string) {
  const found = section(wrapper, title)
  await found.get('.accordion-trigger').trigger('click')

  return found
}

function delaysOf(wrapper: VueWrapper, selector: string) {
  return wrapper.findAll(selector).map(item => {
    const raw = item.attributes('style')?.match(/animation-delay:\s*(\d+)ms/)?.[1]
    if (raw === undefined) throw new Error(`No animation-delay on ${selector}`)

    return Number(raw)
  })
}

describe('the stagger is bounded and ordered', () => {
  it('never regresses and never exceeds the cap, on both lists', async () => {
    const wrapper = await mountHome()

    await toggleSection(wrapper, 'How it works')
    await toggleSection(wrapper, 'Key features')

    for (const selector of ['.home-step', '.home-feature']) {
      const delays = delaysOf(wrapper, selector)

      expect(delays.length).toBeGreaterThanOrEqual(3)
      expect(delays[0]).toBe(0)

      // Monotonic, so the cards can never appear out of order.
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
      }

      // The plan's risk note: a long list must not keep the reader waiting.
      expect(Math.max(...delays)).toBeLessThanOrEqual(250)
    }
  })

  it('keeps the longest list finishing well under a second', async () => {
    const wrapper = await mountHome()
    await toggleSection(wrapper, 'Key features')

    const ANIMATION_MS = 320
    const last = Math.max(...delaysOf(wrapper, '.home-feature'))

    expect(last + ANIMATION_MS).toBeLessThan(1000)
  })
})

/**
 * The panel is `v-show`, so a collapsed card is `display: none` and its animation is
 * held until the panel is shown again — which is why the sequence replays on every
 * open. This pins that mechanism: if the panel ever became `v-if`, the cards would
 * remount instead, and if it became always-visible the animation would fire once on
 * page load with the section still collapsed. Either change should break this test.
 */
describe('the accordion replay mechanism', () => {
  it('keeps the same card elements in the DOM and merely hides them when collapsed', async () => {
    const wrapper = await mountHome()

    const panel = () => section(wrapper, 'Key features').get('.accordion-panel')

    // Collapsed: rendered, but not visible — the `v-show` / display:none case.
    expect(panel().isVisible()).toBe(false)
    expect(wrapper.findAll('.home-feature').length).toBeGreaterThanOrEqual(4)
    expect(wrapper.findAll('.home-feature')[0].isVisible()).toBe(false)

    await toggleSection(wrapper, 'Key features')
    expect(panel().isVisible()).toBe(true)
    expect(wrapper.findAll('.home-feature')[0].isVisible()).toBe(true)
  })

  it('still carries the animation marking and its delays after a close and reopen', async () => {
    const wrapper = await mountHome()

    await toggleSection(wrapper, 'How it works')
    const first = delaysOf(wrapper, '.home-step')

    await toggleSection(wrapper, 'How it works')
    await toggleSection(wrapper, 'How it works')

    expect(delaysOf(wrapper, '.home-step')).toEqual(first)

    for (const step of wrapper.findAll('.home-step')) {
      expect(step.classes()).toContain('card')
      expect(step.classes()).toContain('card-in')
    }
  })

  it('survives a burst of rapid open/close clicks without losing a card', async () => {
    const wrapper = await mountHome()

    const before = wrapper.findAll('.home-feature').length
    for (let i = 0; i < 9; i++) await toggleSection(wrapper, 'Key features')

    // Odd count, so it ends open.
    expect(section(wrapper, 'Key features').get('.accordion-panel').isVisible()).toBe(true)
    expect(wrapper.findAll('.home-feature')).toHaveLength(before)
    expect(delaysOf(wrapper, '.home-feature')[0]).toBe(0)
  })
})

describe('the animation stays inside the scope the plan drew', () => {
  it('animates the setup form card', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter(createMemoryHistory())
    router.push('/practice')
    await router.isReady()

    const wrapper = mount(SetupView, {
      global: { plugins: [pinia, router], stubs: { Play: true } }
    })

    const card = wrapper.get('form.card')
    expect(card.classes()).toContain('card-in')
  })

  /**
   * The reveal toggle used to be pinned absent here too, as plan 010 left `LoginView`
   * out of scope. Plan 012 deliberately extended the toggle to this field, so that
   * half of the guard is gone and `LoginView.spec.ts` owns the toggle's behaviour now.
   * The animation scope this file is about is unchanged.
   */
  it('leaves the login screen card unanimated', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter(createMemoryHistory())
    router.push('/login')
    await router.isReady()

    const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })

    // Out of scope per the plan: no entrance animation on this card.
    expect(wrapper.findAll('.card').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.find('.card-in').exists()).toBe(false)
  })

  it('marks only the hero and the two list card families on the home page', async () => {
    const wrapper = await mountHome()

    await toggleSection(wrapper, 'What it does')
    await toggleSection(wrapper, 'How it works')
    await toggleSection(wrapper, 'Key features')

    const animated = wrapper.findAll('.card-in')
    const steps = wrapper.findAll('.home-step').length
    const features = wrapper.findAll('.home-feature').length

    // Hero + both lists, and nothing else picked the class up along the way.
    expect(animated).toHaveLength(1 + steps + features)

    // The accordion shells themselves are not cards and must not animate.
    for (const accordion of wrapper.findAll('.accordion')) {
      expect(accordion.classes()).not.toContain('card-in')
    }
  })
})

/**
 * The reduced-motion opt-out is inherited from the global rule in
 * `setup/reset.scss`, so the animation must not hardcode anything that rule cannot
 * override. It neutralises `animation-duration` with `!important`, but not
 * `animation-delay` — which the stagger sets inline, the highest-priority origin
 * short of `!important`. Asserted on the source because jsdom applies no stylesheet.
 */
describe('reduced motion is not fought by this feature', () => {
  it('declares no !important duration that would outrank the global reset', () => {
    // Read from disk, not imported: vitest stubs CSS modules to an empty string,
    // which would make every negative assertion below pass vacuously.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/cmps/animation.scss'), 'utf8')

    // Proves the file actually loaded before anything is asserted about it.
    expect(css).toContain('@keyframes card-in')
    expect(css).toMatch(/animation:\s*card-in/)

    expect(css).not.toMatch(/animation-duration[^;]*!important/)
    expect(css).not.toMatch(/animation[^;]*!important/)
  })

  it('sets the per-item delay inline, which the global reset does not neutralise', async () => {
    const wrapper = await mountHome()
    await toggleSection(wrapper, 'Key features')

    const delays = delaysOf(wrapper, '.home-feature')

    // Documented, not endorsed: under `prefers-reduced-motion` the duration
    // collapses to 0.01ms but these delays still apply, so the last card is held
    // at opacity 0 by `animation-fill-mode: both` for this long before appearing.
    // Flagged in the QA report; bounded at a quarter second, hence not a failure.
    expect(Math.max(...delays)).toBeLessThanOrEqual(250)
  })
})
