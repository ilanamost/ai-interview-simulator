import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { PartyPopper, Trophy } from 'lucide-vue-next'
import EncouragementModal from './EncouragementModal.vue'
import {
  AUTO_DISMISS_MS,
  ENCOURAGEMENT_MESSAGES,
  pickEncouragementMessage
} from '@/services/gamification.service'

function mountModal(
  props: { open?: boolean; milestoneIndex?: number; isLastQuestion?: boolean } = {}
) {
  return mount(EncouragementModal, {
    props: { open: true, milestoneIndex: 0, ...props },
    attachTo: document.body
  })
}

describe('EncouragementModal', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders nothing while it is closed', () => {
    const wrapper = mountModal({ open: false })

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
  })

  it('announces the milestone as a status region when it opens', () => {
    const wrapper = mountModal()

    const panel = wrapper.get('.encouragement-panel')
    expect(panel.attributes('role')).toBe('status')
    expect(wrapper.get('.encouragement-message').attributes('aria-live')).toBe('polite')
  })

  it('shows the message and icon paired to the given milestone', () => {
    const wrapper = mountModal({ milestoneIndex: 0 })

    expect(wrapper.text()).toContain(ENCOURAGEMENT_MESSAGES[0])
    expect(wrapper.findComponent(PartyPopper).exists()).toBe(true)
  })

  it('shows a different message and icon on the next milestone', () => {
    const wrapper = mountModal({ milestoneIndex: 1 })

    expect(wrapper.text()).toContain(ENCOURAGEMENT_MESSAGES[1])
    expect(wrapper.text()).not.toContain(ENCOURAGEMENT_MESSAGES[0])
    expect(wrapper.findComponent(Trophy).exists()).toBe(true)
  })

  it('wraps back to the first message once the pool runs out', () => {
    const wrapper = mountModal({ milestoneIndex: ENCOURAGEMENT_MESSAGES.length })

    expect(wrapper.text()).toContain(pickEncouragementMessage(0))
  })

  it('tells the user the next question is waiting by default', () => {
    const wrapper = mountModal()

    expect(wrapper.get('.encouragement-note').text()).toBe(
      'Keep going — the next question is waiting.'
    )
  })

  /** There is no next question waiting when the milestone lands on the last one. */
  it('points to the report instead when it is the last question', () => {
    const wrapper = mountModal({ isLastQuestion: true })

    const note = wrapper.get('.encouragement-note').text()
    expect(note).toBe('That was the last question — your report is next.')
    expect(note).not.toContain('next question is waiting')
  })

  it('emits close when the dismiss button is clicked', async () => {
    const wrapper = mountModal()

    await wrapper.get('.encouragement-close').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close when the backdrop behind the panel is clicked', async () => {
    const wrapper = mountModal()

    await wrapper.get('.encouragement-backdrop').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  /** A click inside the panel is not a dismissal — `.self` on the backdrop guards it. */
  it('stays open when the panel itself is clicked', async () => {
    const wrapper = mountModal()

    await wrapper.get('.encouragement-panel').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('emits close when Escape is pressed', async () => {
    const wrapper = mountModal()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ignores Escape once it is closed again', async () => {
    const wrapper = mountModal()
    await wrapper.setProps({ open: false })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  describe('auto-dismiss', () => {
    it('emits close on its own once the timeout elapses', async () => {
      vi.useFakeTimers()
      const wrapper = mountModal()

      vi.advanceTimersByTime(AUTO_DISMISS_MS)
      await nextTick()

      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('has not emitted close just before the timeout elapses', async () => {
      vi.useFakeTimers()
      const wrapper = mountModal()

      vi.advanceTimersByTime(AUTO_DISMISS_MS - 1)
      await nextTick()

      expect(wrapper.emitted('close')).toBeUndefined()
    })

    /** Closing by hand must cancel the pending timer, not queue a second `close`. */
    it('does not emit a second close after a manual dismiss', async () => {
      vi.useFakeTimers()
      const wrapper = mountModal()

      await wrapper.get('.encouragement-close').trigger('click')
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 2)
      await nextTick()

      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('restarts the timer when it is reopened for the next milestone', async () => {
      vi.useFakeTimers()
      const wrapper = mountModal()

      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true, milestoneIndex: 1 })
      vi.advanceTimersByTime(AUTO_DISMISS_MS)
      await nextTick()

      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('does not fire after the component is unmounted', async () => {
      vi.useFakeTimers()
      const wrapper = mountModal()

      wrapper.unmount()
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 2)
      await nextTick()

      expect(wrapper.emitted('close')).toBeUndefined()
    })
  })
})
