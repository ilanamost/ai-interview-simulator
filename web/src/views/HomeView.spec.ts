import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushPromises,
  mount,
  RouterLinkStub,
  type DOMWrapper,
  type VueWrapper
} from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from './HomeView.vue'
import { createAppRouter } from '@/router'

async function mountHome(attach = false) {
  // The router guard reads the store, so pinia has to be active before any navigation.
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  router.push('/')
  await router.isReady()

  return mount(HomeView, {
    global: { plugins: [pinia, router] },
    ...(attach ? { attachTo: document.body } : {})
  })
}

/** The three explanatory sections are disclosures now, addressed by their title. */
function section(wrapper: VueWrapper, title: string): DOMWrapper<Element> {
  const found = wrapper
    .findAll('.accordion')
    .find(candidate => candidate.get('.accordion-title').text() === title)

  if (!found) throw new Error(`No section titled "${title}"`)

  return found
}

function isOpen(wrapper: VueWrapper, title: string) {
  return section(wrapper, title).get('.accordion-panel').isVisible()
}

async function openSection(wrapper: VueWrapper, title: string) {
  const found = section(wrapper, title)
  await found.get('.accordion-trigger').trigger('click')

  return found
}

describe('HomeView', () => {
  it('leads with what the app is, before anything collapsible', async () => {
    const wrapper = await mountHome()

    // The hero is the intro and stays expanded; only the sections below fold away.
    expect(wrapper.get('h1').text()).toContain('Practice technical interviews')
    expect(wrapper.get('.home-hero').text()).toContain(
      'answer AI-generated questions one at a time'
    )
    expect(wrapper.find('.home-hero .accordion').exists()).toBe(false)
  })

  it('answers who it is for and what problem it solves under "What it does"', async () => {
    const wrapper = await mountHome()

    const whatItDoes = await openSection(wrapper, 'What it does')
    const body = whatItDoes.get('.accordion-panel')

    expect(body.isVisible()).toBe(true)
    expect(body.text()).toContain('candidates from entry level to senior')
    expect(body.text()).toContain('Mock interviews with peers need scheduling')
  })

  it('explains how it works as an ordered list of steps', async () => {
    const wrapper = await mountHome()

    const howItWorks = await openSection(wrapper, 'How it works')

    const steps = howItWorks.findAll('.home-steps > li')
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(steps[0].text()).toContain('Set up the interview')
    expect(steps.at(-1)!.text()).toContain('Review your report')
  })

  it('renders every key feature with an icon', async () => {
    const wrapper = await mountHome()

    const keyFeatures = await openSection(wrapper, 'Key features')

    const features = keyFeatures.findAll('.home-features > li')
    expect(features.length).toBeGreaterThanOrEqual(4)

    for (const feature of features) {
      expect(feature.find('svg.feature-icon').exists()).toBe(true)
      expect(feature.get('h3').text().length).toBeGreaterThan(0)
    }
  })

  it('points its calls to action at the practice form', async () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub } }
    })

    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      expect(link.props('to')).toBe('/practice')
    }
  })

  it('does not send a first-time visitor straight into the setup form', async () => {
    const wrapper = await mountHome()

    // The home page explains the product; it must not duplicate the config form.
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
  })
})

/**
 * The entrance animation itself is CSS that jsdom never computes, so these only
 * guard the seam: the cards still carry the classes the existing content
 * assertions and the stylesheet both key off, and each staggered item gets its
 * own delay rather than all sharing one.
 */
describe('the card entrance animation', () => {
  it('keeps the hero a card and marks it for the animation', async () => {
    const wrapper = await mountHome()

    const hero = wrapper.get('.home-hero')
    expect(hero.classes()).toContain('card')
    expect(hero.classes()).toContain('card-in')
  })

  it('animates every repeated card without dropping its existing classes', async () => {
    const wrapper = await mountHome()

    const steps = (await openSection(wrapper, 'How it works')).findAll('.home-step')
    const features = (await openSection(wrapper, 'Key features')).findAll('.home-feature')

    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(features.length).toBeGreaterThanOrEqual(4)

    for (const item of [...steps, ...features]) {
      expect(item.classes()).toContain('card')
      expect(item.classes()).toContain('card-in')
    }
  })

  it('staggers the list items instead of firing them all at once', async () => {
    const wrapper = await mountHome()

    const features = (await openSection(wrapper, 'Key features')).findAll('.home-feature')
    const delays = features.map(item => item.attributes('style'))

    expect(delays[0]).toContain('animation-delay: 0ms')
    expect(delays[1]).not.toBe(delays[0])

    // A long list must not keep the reader waiting — the delay is capped.
    for (const delay of delays) {
      const ms = Number(delay?.match(/animation-delay:\s*(\d+)ms/)?.[1])
      expect(ms).toBeLessThanOrEqual(250)
    }
  })
})

describe('the home page sections as accordions', () => {
  const TITLES = ['What it does', 'How it works', 'Key features']

  it('offers exactly the three explanatory sections', async () => {
    const wrapper = await mountHome()

    const titles = wrapper.findAll('.accordion-title').map(title => title.text())
    expect(titles).toEqual(TITLES)
  })

  it('starts every section collapsed', async () => {
    const wrapper = await mountHome()

    for (const title of TITLES) {
      expect(isOpen(wrapper, title)).toBe(false)
      expect(section(wrapper, title).get('.accordion-trigger').attributes('aria-expanded')).toBe(
        'false'
      )
    }
  })

  it('leaves the other sections closed when one is opened', async () => {
    const wrapper = await mountHome()

    await openSection(wrapper, 'How it works')

    expect(isOpen(wrapper, 'How it works')).toBe(true)
    expect(isOpen(wrapper, 'What it does')).toBe(false)
    expect(isOpen(wrapper, 'Key features')).toBe(false)
  })

  it('closes a section again on a second click of its title', async () => {
    const wrapper = await mountHome()

    await openSection(wrapper, 'Key features')
    await openSection(wrapper, 'Key features')

    expect(isOpen(wrapper, 'Key features')).toBe(false)
  })
})

describe('the hero link into "How it works"', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    // jsdom has no layout, so it never implemented scrollIntoView.
    Element.prototype.scrollIntoView = scrollIntoView
    scrollIntoView.mockClear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function seeHowItWorks(wrapper: VueWrapper) {
    const link = wrapper.findAll('a').find(a => a.text().includes('See how it works'))
    if (!link) throw new Error('No "See how it works" link in the hero')

    return link
  }

  it('opens the section rather than scrolling to a collapsed one', async () => {
    const wrapper = await mountHome(true)
    expect(isOpen(wrapper, 'How it works')).toBe(false)

    await seeHowItWorks(wrapper).trigger('click')
    await flushPromises()

    expect(isOpen(wrapper, 'How it works')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('still targets the section by id so the anchor stays a real link', async () => {
    const wrapper = await mountHome(true)

    expect(seeHowItWorks(wrapper).attributes('href')).toBe('#how-it-works')
    expect(section(wrapper, 'How it works').attributes('id')).toBe('how-it-works')
  })

  it('leaves the other sections alone', async () => {
    const wrapper = await mountHome(true)

    await seeHowItWorks(wrapper).trigger('click')

    expect(isOpen(wrapper, 'What it does')).toBe(false)
    expect(isOpen(wrapper, 'Key features')).toBe(false)
  })
})
