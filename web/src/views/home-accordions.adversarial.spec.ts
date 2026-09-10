import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from './HomeView.vue'
import { createAppRouter } from '@/router'

/**
 * Adversarial pass over the home page's disclosures (QA, plan 008). The hero link
 * is the fragile part: it opens a section it does not own, then scrolls. These
 * push on repeat clicks, a missing scroll target, and the a11y wiring across all
 * three sections.
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

function isOpen(wrapper: VueWrapper, title: string) {
  return section(wrapper, title).get('.accordion-panel').isVisible()
}

function seeHowItWorks(wrapper: VueWrapper) {
  const link = wrapper.findAll('a').find(a => a.text().includes('See how it works'))
  if (!link) throw new Error('No "See how it works" link in the hero')

  return link
}

describe('the hero link edge cases', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    // jsdom has no layout, so it never implemented scrollIntoView.
    Element.prototype.scrollIntoView = scrollIntoView
    scrollIntoView.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('leaves the section open after rapid repeated clicks', async () => {
    // open() rather than toggle() is the whole point: a double click must not
    // reopen and then immediately re-close the section under the reader.
    const wrapper = await mountHome()
    const link = seeHowItWorks(wrapper)

    await link.trigger('click')
    await link.trigger('click')
    await link.trigger('click')
    await flushPromises()

    expect(isOpen(wrapper, 'How it works')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
  })

  it('reopens a section the reader had closed by hand', async () => {
    const wrapper = await mountHome()

    await seeHowItWorks(wrapper).trigger('click')
    await flushPromises()
    await section(wrapper, 'How it works').get('.accordion-trigger').trigger('click')
    expect(isOpen(wrapper, 'How it works')).toBe(false)

    await seeHowItWorks(wrapper).trigger('click')
    await flushPromises()

    expect(isOpen(wrapper, 'How it works')).toBe(true)
  })

  it('still opens the section when the scroll target cannot be found', async () => {
    // Defensive: the section must open even if the id lookup comes back empty,
    // so a missing anchor degrades to "no scroll", never to a thrown handler.
    const wrapper = await mountHome()
    vi.spyOn(document, 'getElementById').mockReturnValue(null)

    await seeHowItWorks(wrapper).trigger('click')
    await flushPromises()

    expect(isOpen(wrapper, 'How it works')).toBe(true)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('cancels the browser hash jump so it controls the scroll itself', async () => {
    const wrapper = await mountHome()

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    seeHowItWorks(wrapper).element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
  })

  it('scrolls to the section element itself, not to some other node', async () => {
    const wrapper = await mountHome()

    await seeHowItWorks(wrapper).trigger('click')
    await flushPromises()

    const target = document.getElementById('how-it-works')
    expect(target).not.toBeNull()
    expect(target).toBe(section(wrapper, 'How it works').element)
    expect(scrollIntoView.mock.instances[0]).toBe(target)
  })
})

describe('the home disclosures as a set', () => {
  const TITLES = ['What it does', 'How it works', 'Key features']

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens all three independently and closes them back down', async () => {
    const wrapper = await mountHome()

    for (const title of TITLES) {
      await section(wrapper, title).get('.accordion-trigger').trigger('click')
    }

    expect(TITLES.map(title => isOpen(wrapper, title))).toEqual([true, true, true])

    for (const title of TITLES) {
      await section(wrapper, title).get('.accordion-trigger').trigger('click')
    }

    expect(TITLES.map(title => isOpen(wrapper, title))).toEqual([false, false, false])
  })

  it('wires each trigger to its own panel', async () => {
    const wrapper = await mountHome()

    const pairs = TITLES.map(title => {
      const found = section(wrapper, title)

      return {
        controls: found.get('.accordion-trigger').attributes('aria-controls'),
        panel: found.get('.accordion-panel').attributes('id')
      }
    })

    for (const pair of pairs) {
      expect(pair.controls).toBeTruthy()
      expect(pair.controls).toBe(pair.panel)
    }

    expect(new Set(pairs.map(pair => pair.panel)).size).toBe(3)
  })

  it('exposes each section title as a heading-level button', async () => {
    // The page's outline must survive the rewrite: a screen-reader user still
    // needs three h2s to jump between, not three anonymous divs.
    const wrapper = await mountHome()

    const headings = wrapper.findAll('h2').map(heading => heading.text())
    expect(headings).toEqual(TITLES)

    for (const title of TITLES) {
      const trigger = section(wrapper, title).get('.accordion-trigger')
      expect(trigger.element.parentElement?.tagName).toBe('H2')
    }
  })

  it('keeps the hero out of the collapsible set', async () => {
    // The pitch and the primary CTA must be visible on first paint.
    const wrapper = await mountHome()

    expect(wrapper.get('.home-hero').isVisible()).toBe(true)
    expect(wrapper.find('.home-hero .accordion-trigger').exists()).toBe(false)

    const cta = wrapper.findAll('a').find(a => a.text().includes('Start practicing'))
    expect(cta?.isVisible()).toBe(true)
  })
})
