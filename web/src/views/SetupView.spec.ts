import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import SetupView from './SetupView.vue'
import { createAppRouter } from '@/router'
import { useInterviewStore } from '@/stores/interview.store'
import type { InterviewSource } from '@/services/interview.service'
import { DEFAULT_LLM_MODEL, LLM_MODELS, type InterviewConfig } from '@/types/interview'

/** A source that records the config it was started with and then stalls on a question. */
function makeRecordingSource() {
  const startInterview = vi.fn(async (config: InterviewConfig) => ({
    id: 'i1',
    config,
    createdAt: '2026-07-28T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: []
  }))

  const source = {
    startInterview,
    getNextQuestion: async () => ({
      id: 'q1',
      text: 'Explain X',
      topic: 'T',
      isFollowUp: false,
      keywords: []
    }),
    evaluateAnswer: vi.fn(),
    getReport: vi.fn()
  } as unknown as InterviewSource

  return { source, startInterview }
}

async function mountSetup() {
  // The router guard reads the store, so pinia has to be active before any
  // navigation — including the one `onStart` fires after a successful submit.
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  router.push('/practice')
  await router.isReady()

  const wrapper = mount(SetupView, {
    global: { plugins: [pinia, router], stubs: { Play: true } }
  })

  const { source, startInterview } = makeRecordingSource()
  useInterviewStore(pinia).setSource(source)

  return { wrapper, startInterview }
}

describe('SetupView model selection', () => {
  it('offers every allowlisted model', async () => {
    const { wrapper } = await mountSetup()

    expect(wrapper.get('#model').findAll('option')).toHaveLength(LLM_MODELS.length)
  })

  it('starts on the balanced default so a run never surprises on cost', async () => {
    const { wrapper } = await mountSetup()

    expect((wrapper.get('#model').element as HTMLSelectElement).value).toBe(DEFAULT_LLM_MODEL)
  })

  it('sends the chosen model along with the rest of the config', async () => {
    const { wrapper, startInterview } = await mountSetup()

    await wrapper.get('#model').setValue('claude-opus-5')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(startInterview).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-5', jobTitle: 'frontend' })
    )
  })
})
