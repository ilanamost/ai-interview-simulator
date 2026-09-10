import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import AccordionSection from './AccordionSection.vue'

function mountAccordionSection(props: Partial<{ title: string; defaultOpen: boolean }> = {}) {
  return mount(AccordionSection, {
    props: { title: 'How it works', ...props },
    slots: { default: '<p>The body</p>' }
  })
}

/**
 * Two siblings in one tree, built with a render function rather than a string
 * template: the runtime-only Vue build has no template compiler.
 */
const TwoAccordionSections = defineComponent({
  setup() {
    return () =>
      h('div', [
        h(AccordionSection, { title: 'First' }, { default: () => h('p', 'First body') }),
        h(AccordionSection, { title: 'Second' }, { default: () => h('p', 'Second body') })
      ])
  }
})

describe('AccordionSection', () => {
  it('renders its title but hides the body until it is opened', () => {
    const wrapper = mountAccordionSection()

    expect(wrapper.get('.accordion-title').text()).toBe('How it works')
    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.accordion-panel').isVisible()).toBe(false)
  })

  it('reveals the body when the trigger is clicked', async () => {
    const wrapper = mountAccordionSection()

    await wrapper.get('.accordion-trigger').trigger('click')

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.accordion-panel').isVisible()).toBe(true)
    expect(wrapper.get('.accordion-panel').text()).toContain('The body')
  })

  it('hides the body again on a second click', async () => {
    const wrapper = mountAccordionSection()

    await wrapper.get('.accordion-trigger').trigger('click')
    await wrapper.get('.accordion-trigger').trigger('click')

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.accordion-panel').isVisible()).toBe(false)
  })

  it('starts open when the caller asks for it', () => {
    const wrapper = mountAccordionSection({ defaultOpen: true })

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.accordion-panel').isVisible()).toBe(true)
  })

  it('keeps each instance independent of its siblings', async () => {
    const wrapper = mount(TwoAccordionSections)
    const sections = wrapper.findAll('.accordion')

    await sections[0].get('.accordion-trigger').trigger('click')

    expect(sections[0].get('.accordion-panel').isVisible()).toBe(true)
    expect(sections[1].get('.accordion-panel').isVisible()).toBe(false)
  })

  it('can be opened from the outside without a click', async () => {
    // The home page's "See how it works" link drives the section this way.
    const wrapper = mountAccordionSection()

    wrapper.vm.open()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.accordion-panel').isVisible()).toBe(true)
  })

  it('discloses itself to assistive tech through a real button', () => {
    // A <button> is what makes Enter and Space work without any key handling of
    // our own; jsdom will not synthesise that activation, so pin the element.
    const wrapper = mountAccordionSection()
    const trigger = wrapper.get('.accordion-trigger')

    expect(trigger.element.tagName).toBe('BUTTON')
    expect(trigger.attributes('type')).toBe('button')
    expect(trigger.attributes('aria-controls')).toBe(
      wrapper.get('.accordion-panel').attributes('id')
    )
    expect(wrapper.get('.accordion-panel').attributes('aria-labelledby')).toBe(
      trigger.attributes('id')
    )
  })
})
