import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PaginationControl from './PaginationControl.vue'

function mountPager(page: number, pageCount: number) {
  return mount(PaginationControl, { props: { page, pageCount } })
}

function isDisabled(wrapper: ReturnType<typeof mountPager>, selector: string): boolean {
  return (wrapper.get(selector).element as HTMLButtonElement).disabled
}

describe('PaginationControl', () => {
  it('says which page of how many is showing', () => {
    const wrapper = mountPager(2, 5)

    expect(wrapper.get('.pagination-label').text()).toBe('Page 2 of 5')
  })

  it('relabels itself when the page it is given changes', async () => {
    const wrapper = mountPager(1, 3)

    await wrapper.setProps({ page: 3 })

    expect(wrapper.get('.pagination-label').text()).toBe('Page 3 of 3')
  })

  it('asks for the next page when Next is clicked', async () => {
    const wrapper = mountPager(2, 5)

    await wrapper.get('.pagination-next').trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[3]])
  })

  it('asks for the previous page when Previous is clicked', async () => {
    const wrapper = mountPager(2, 5)

    await wrapper.get('.pagination-prev').trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[1]])
  })

  /**
   * Controlled, not stateful: the store decides which page exists, so the label must not
   * move until it is handed a new one. Otherwise a failed read would leave the pager
   * claiming a page the list never loaded.
   */
  it('does not move itself — the label only follows the prop', async () => {
    const wrapper = mountPager(2, 5)

    await wrapper.get('.pagination-next').trigger('click')

    expect(wrapper.get('.pagination-label').text()).toBe('Page 2 of 5')
  })

  describe('at the bounds', () => {
    it('cannot go back from the first page', () => {
      const wrapper = mountPager(1, 4)

      expect(isDisabled(wrapper, '.pagination-prev')).toBe(true)
      expect(isDisabled(wrapper, '.pagination-next')).toBe(false)
    })

    it('cannot go on from the last page', () => {
      const wrapper = mountPager(4, 4)

      expect(isDisabled(wrapper, '.pagination-prev')).toBe(false)
      expect(isDisabled(wrapper, '.pagination-next')).toBe(true)
    })

    it('disables both when there is only one page', () => {
      const wrapper = mountPager(1, 1)

      expect(isDisabled(wrapper, '.pagination-prev')).toBe(true)
      expect(isDisabled(wrapper, '.pagination-next')).toBe(true)
    })

    it('emits nothing at all from a disabled control', async () => {
      const wrapper = mountPager(1, 1)

      await wrapper.get('.pagination-prev').trigger('click')
      await wrapper.get('.pagination-next').trigger('click')

      expect(wrapper.emitted('update:page')).toBeUndefined()
    })

    /** A page number out of range must still not offer a move that leaves the range. */
    it('stays bounded when handed a page beyond the count', () => {
      const wrapper = mountPager(9, 4)

      expect(isDisabled(wrapper, '.pagination-next')).toBe(true)
    })

    it('re-enables a control the moment the page moves off the bound', async () => {
      const wrapper = mountPager(1, 4)

      await wrapper.setProps({ page: 2 })

      expect(isDisabled(wrapper, '.pagination-prev')).toBe(false)
    })
  })

  it('is a labelled landmark, so the controls are findable without sight', () => {
    const wrapper = mountPager(1, 3)

    expect(wrapper.get('nav').attributes('aria-label')).toBeTruthy()
    // Polite: the page count changes under the reader, it does not interrupt them.
    expect(wrapper.get('.pagination-label').attributes('aria-live')).toBe('polite')
  })

  /** Inside a <form> in the history view, a button without a type would submit it. */
  it('never submits the form it is rendered in', () => {
    const wrapper = mountPager(2, 5)

    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('type')).toBe('button')
    }
  })
})
