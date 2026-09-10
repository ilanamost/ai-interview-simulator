import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VoiceInput from './VoiceInput.vue'
import {
  SpeechError,
  type SpeechHandlers,
  type SpeechSession,
  type SpeechSource
} from '@/services/speech.service'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }))

/** A source the test drives by hand, standing in for the browser. */
function makeStubSource(supported = true) {
  let handlers: SpeechHandlers | null = null
  const session: SpeechSession = { stop: vi.fn(), abort: vi.fn() }

  const source: SpeechSource = {
    isSupported: () => supported,
    start: h => {
      handlers = h
      return session
    }
  }

  return {
    source,
    session,
    hear: (text: string, isFinal = true) => handlers?.onTranscript(text, isFinal),
    fail: (error: SpeechError) => handlers?.onError(error),
    end: () => handlers?.onEnd()
  }
}

function mountVoice(stub: ReturnType<typeof makeStubSource>, disabled = false) {
  return mount(VoiceInput, {
    props: { source: stub.source, disabled },
    global: { stubs: { Mic: true, Check: true, X: true } }
  })
}

const micButton = (wrapper: ReturnType<typeof mountVoice>) =>
  wrapper.get('button[aria-label="Answer by voice"]')

describe('VoiceInput', () => {
  it('renders nothing at all in a browser without speech recognition', () => {
    const wrapper = mountVoice(makeStubSource(false))

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('switches to the listening state when the mic is pressed', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)

    await micButton(wrapper).trigger('click')

    expect(wrapper.text()).toContain('Listening')
    expect(wrapper.emitted('listen')).toHaveLength(1)
  })

  it('does not open the mic while the answer is being evaluated', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub, true)

    expect(micButton(wrapper).attributes('disabled')).toBeDefined()

    await micButton(wrapper).trigger('click')

    expect(wrapper.emitted('listen')).toBeUndefined()
  })

  it('passes settled speech up to the answer box', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    stub.hear('I would measure first.')

    expect(wrapper.emitted('transcript')).toEqual([['I would measure first.']])
  })

  it('previews in-progress speech without committing it', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    stub.hear('and then I would', false)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('and then I would')
    expect(wrapper.emitted('transcript')).toBeUndefined()
  })

  it('keeps the speech when the user confirms', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    await wrapper.get('button[aria-label="Use what you said"]').trigger('click')
    stub.end()

    expect(stub.session.stop).toHaveBeenCalledOnce()
    expect(wrapper.emitted('commit')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('discards the speech when the user cancels', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    await wrapper.get('button[aria-label="Discard what you said"]').trigger('click')
    stub.end()

    expect(stub.session.abort).toHaveBeenCalledOnce()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('returns to the mic when the browser stops listening on its own', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    stub.end()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('commit')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="Answer by voice"]').exists()).toBe(true)
  })

  it('keeps what was already heard when recognition fails mid-answer', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    stub.hear('I would measure first.')
    stub.fail(new SpeechError('SPEECH_NETWORK', 'Speech transcription is unreachable right now.'))
    stub.end()

    expect(wrapper.emitted('commit')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('releases the microphone when the component goes away', async () => {
    const stub = makeStubSource()
    const wrapper = mountVoice(stub)
    await micButton(wrapper).trigger('click')

    wrapper.unmount()

    expect(stub.session.abort).toHaveBeenCalledOnce()
  })
})
