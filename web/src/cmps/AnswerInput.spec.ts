import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnswerInput from './AnswerInput.vue'
import VoiceInput from './VoiceInput.vue'

function mountInput(props: Partial<{ questionId: string; busy: boolean }> = {}) {
  return mount(AnswerInput, {
    props: { questionId: 'q1', busy: false, ...props },
    global: { stubs: { Send: true } }
  })
}

/**
 * Drive the voice control through its events rather than its markup: jsdom has
 * no speech recognition, so the child renders nothing but still emits.
 */
function voice(wrapper: ReturnType<typeof mountInput>) {
  return wrapper.getComponent(VoiceInput)
}

describe('AnswerInput', () => {
  it('disables submit until something is typed', async () => {
    const wrapper = mountInput()
    const button = wrapper.get('button[type="submit"]')

    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.get('textarea').setValue('An answer')

    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('emits the typed answer on submit', async () => {
    const wrapper = mountInput()
    await wrapper.get('textarea').setValue('My answer')

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['My answer']])
  })

  it('does not emit for a whitespace-only answer', async () => {
    const wrapper = mountInput()
    await wrapper.get('textarea').setValue('   ')

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('blocks submitting again while an evaluation is in flight', async () => {
    const wrapper = mountInput({ busy: true })
    await wrapper.get('textarea').setValue('My answer')

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('clears the draft when the next question arrives', async () => {
    const wrapper = mountInput()
    await wrapper.get('textarea').setValue('My answer')

    await wrapper.setProps({ questionId: 'q2' })

    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it('counts words so the user can gauge length', async () => {
    const wrapper = mountInput()

    await wrapper.get('textarea').setValue('one two three')

    expect(wrapper.text()).toContain('3 words')
  })

  describe('answering by voice', () => {
    it('appends what was said to what was already typed', async () => {
      const wrapper = mountInput()
      await wrapper.get('textarea').setValue('I would start by')

      voice(wrapper).vm.$emit('transcript', 'measuring rather than guessing.')
      await wrapper.vm.$nextTick()

      expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
        'I would start by measuring rather than guessing.'
      )
    })

    it('will not submit half a spoken sentence while the mic is open', async () => {
      const wrapper = mountInput()
      await wrapper.get('textarea').setValue('An answer')

      voice(wrapper).vm.$emit('listen')
      await wrapper.vm.$nextTick()

      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

      await wrapper.get('form').trigger('submit')

      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('submits again once the mic is closed', async () => {
      const wrapper = mountInput()
      await wrapper.get('textarea').setValue('An answer')

      voice(wrapper).vm.$emit('listen')
      voice(wrapper).vm.$emit('commit')
      await wrapper.vm.$nextTick()
      await wrapper.get('form').trigger('submit')

      expect(wrapper.emitted('submit')).toEqual([['An answer']])
    })

    it('restores the typed text when the user discards what they said', async () => {
      const wrapper = mountInput()
      await wrapper.get('textarea').setValue('Typed by hand')

      voice(wrapper).vm.$emit('listen')
      voice(wrapper).vm.$emit('transcript', 'spoken by mistake')
      await wrapper.vm.$nextTick()
      voice(wrapper).vm.$emit('cancel')
      await wrapper.vm.$nextTick()

      expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Typed by hand')
    })

    it('discloses that speech leaves the browser, but only while listening', async () => {
      const wrapper = mountInput()

      expect(wrapper.text()).not.toContain('transcribed by your browser')

      voice(wrapper).vm.$emit('listen')
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('transcribed by your browser')
    })
  })
})
