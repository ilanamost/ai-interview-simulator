import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import AccordionSection from './AccordionSection.vue'

/**
 * Adversarial pass over the disclosure component (QA, plan 008). These try to break
 * the toggle rather than re-walk the happy path AccordionSection.spec.ts covers:
 * impatient clicking, hostile and oversized titles, an empty body, and the a11y
 * wiring a screen-reader user depends on.
 *
 * Everything here mounts into the document on purpose. jsdom only refreshes its
 * computed-style cache for nodes that are in the document, so on a detached mount
 * `isVisible()` keeps reporting the state the panel had at the first read and
 * silently stops tracking v-show. Assertions below therefore lean on the inline
 * display and aria-expanded, which are true regardless.
 */

function mountAccordionSection(props: Partial<{ title: string; defaultOpen: boolean }> = {}) {
  return mount(AccordionSection, {
    props: { title: 'How it works', ...props },
    slots: { default: '<p>The body</p>' },
    attachTo: document.body
  })
}

function panelDisplay(wrapper: ReturnType<typeof mountAccordionSection>) {
  return (wrapper.get('.accordion-panel').element as HTMLElement).style.display
}

describe('AccordionSection edge cases', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lands on the state the click count implies when clicked rapidly', async () => {
    const wrapper = mountAccordionSection()
    const trigger = wrapper.get('.accordion-trigger')

    // An impatient user hammers the bar; parity must still hold, no stuck state.
    for (let i = 0; i < 5; i++) await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(panelDisplay(wrapper)).toBe('')

    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(panelDisplay(wrapper)).toBe('none')
  })

  it('stays open when open() is called repeatedly, and closed when close() is', async () => {
    // The hero link calls open() on a section that may already be open.
    const wrapper = mountAccordionSection()

    wrapper.vm.open()
    wrapper.vm.open()
    wrapper.vm.open()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('true')

    wrapper.vm.close()
    wrapper.vm.close()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('false')
  })

  it('still answers the trigger after being driven from the outside', async () => {
    // Programmatic open must not desynchronise the button's own toggle.
    const wrapper = mountAccordionSection()

    wrapper.vm.open()
    await wrapper.vm.$nextTick()
    await wrapper.get('.accordion-trigger').trigger('click')

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('false')
    expect(panelDisplay(wrapper)).toBe('none')
  })

  it('hides a collapsed panel from assistive tech, not just from sight', () => {
    // v-show keeps the node in the DOM; display:none is what drops it out of the
    // a11y tree. A stylesheet that resurrected it would leave a screen reader
    // reading the body of a section the button reports as collapsed.
    const wrapper = mountAccordionSection()
    const panel = wrapper.get('.accordion-panel').element as HTMLElement

    expect(panel.style.display).toBe('none')
    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('false')
  })

  it('keeps the trigger in the tab order so Enter and Space can reach it', () => {
    // No key handling of our own, so keyboard support is only as real as the
    // element: a focusable, non-disabled <button> with no tabindex opt-out.
    const wrapper = mountAccordionSection()
    const trigger = wrapper.get('.accordion-trigger')

    expect(trigger.element.tagName).toBe('BUTTON')
    expect(trigger.attributes('tabindex')).toBeUndefined()
    expect(trigger.attributes('disabled')).toBeUndefined()
    expect(trigger.attributes('aria-controls')).toBeTruthy()
  })

  it('renders a hostile title as text instead of markup', () => {
    const title = '<img src=x onerror="alert(1)">'
    const wrapper = mountAccordionSection({ title })

    expect(wrapper.get('.accordion-title').text()).toBe(title)
    expect(wrapper.get('.accordion-title').element.children).toHaveLength(0)
    expect(wrapper.get('.accordion-title').element.querySelector('img')).toBeNull()
    expect(wrapper.html()).toContain('&lt;img')
  })

  it('survives a very long title without losing the toggle', async () => {
    const title = 'a'.repeat(5000)
    const wrapper = mountAccordionSection({ title })

    expect(wrapper.get('.accordion-title').text()).toHaveLength(5000)

    await wrapper.get('.accordion-trigger').trigger('click')

    expect(wrapper.get('.accordion-trigger').attributes('aria-expanded')).toBe('true')
  })

  it('toggles an empty section without erroring', async () => {
    // A section whose slot renders nothing must still be a well-formed disclosure.
    const wrapper = mount(AccordionSection, {
      props: { title: 'Empty' },
      attachTo: document.body
    })

    await wrapper.get('.accordion-trigger').trigger('click')

    expect(wrapper.get('.accordion-panel').isVisible()).toBe(true)
    expect(wrapper.get('.accordion-panel').text()).toBe('')
  })

  it('gives every instance its own trigger and panel ids', () => {
    // Duplicate ids would point every aria-controls at the first panel.
    const Three = defineComponent({
      setup() {
        return () =>
          h('div', [
            h(AccordionSection, { title: 'One' }),
            h(AccordionSection, { title: 'Two' }),
            h(AccordionSection, { title: 'Three' })
          ])
      }
    })

    const wrapper = mount(Three, { attachTo: document.body })
    const ids = [
      ...wrapper.findAll('.accordion-trigger').map(el => el.attributes('id')),
      ...wrapper.findAll('.accordion-panel').map(el => el.attributes('id'))
    ]

    expect(ids).toHaveLength(6)
    expect(ids.every(id => Boolean(id))).toBe(true)
    expect(new Set(ids).size).toBe(6)
  })
})
