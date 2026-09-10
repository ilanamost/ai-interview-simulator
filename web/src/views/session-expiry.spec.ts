import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useInterviewStore } from '@/stores/interview.store'
import { InterviewError, type InterviewSource } from '@/services/interview.service'
import type { InterviewSession, Question } from '@/types/interview'
import { signIn } from '@/test/auth-fixture'
import { stubMatchMedia } from '@/test/theme-fixture'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

// The header's theme toggle asks the browser for the system color scheme, which jsdom
// does not implement — stub it before anything mounts `App`.
beforeEach(() => {
  stubMatchMedia()
})

/**
 * What happens when the access token dies while the user is mid-interview (QA F2).
 * The source's refresh-and-retry is covered in `interview-http.service.spec.ts`;
 * these tests start where that gives up — an `UNAUTHENTICATED` the refresh could not
 * rescue — and prove the app does not leave the user stranded on a question they can
 * no longer submit while the header still shows them signed in.
 */

const EXPIRED = () => new InterviewError('UNAUTHENTICATED', 'You must be signed in to do that.')

function makeQuestion(id = 'q1'): Question {
  return { id, text: `Question ${id}`, topic: 'Topic', isFollowUp: false, keywords: [] }
}

/** A source that serves one question and then finds the session gone. */
function makeExpiringSource(failOn: 'evaluate' | 'next' | 'start' = 'evaluate'): InterviewSource {
  return {
    async startInterview(config): Promise<InterviewSession> {
      if (failOn === 'start') throw EXPIRED()
      return {
        id: 'session-1',
        config,
        createdAt: '2026-08-13T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      }
    },
    async getNextQuestion() {
      if (failOn === 'next') throw EXPIRED()
      return makeQuestion()
    },
    async evaluateAnswer() {
      throw EXPIRED()
    },
    async getReport() {
      throw EXPIRED()
    }
  }
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await flushPromises()
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  throw new Error(`Timed out waiting for: ${label}`)
}

describe('an interview store call that comes back UNAUTHENTICATED', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('signs the user out when submitting an answer finds the session gone', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useInterviewStore()
    store.setSource(makeExpiringSource())

    await store.start({ jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 })
    expect(auth.isAuthenticated).toBe(true)

    await expect(store.submitAnswer('My answer')).rejects.toBeInstanceOf(InterviewError)

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
  })

  it('signs the user out when starting an interview finds the session gone', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useInterviewStore()
    store.setSource(makeExpiringSource('start'))

    await expect(
      store.start({ jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 })
    ).rejects.toBeInstanceOf(InterviewError)

    expect(auth.isAuthenticated).toBe(false)
  })

  it('keeps the interview itself, so signing back in resumes the same session', async () => {
    signIn()
    const store = useInterviewStore()
    store.setSource(makeExpiringSource())

    await store.start({ jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 })
    await expect(store.submitAnswer('My answer')).rejects.toBeInstanceOf(InterviewError)

    expect(store.session).not.toBeNull()
    expect(store.currentQuestion?.id).toBe('q1')
    // Back on the question, not wiped — the answer is theirs to resubmit.
    expect(store.status).toBe('asking')
  })

  it('leaves an ordinary failure signed in', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useInterviewStore()
    store.setSource({
      ...makeExpiringSource(),
      async evaluateAnswer() {
        throw new InterviewError('EMPTY_ANSWER', 'Write something first.')
      }
    })

    await store.start({ jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 })
    await expect(store.submitAnswer('  ')).rejects.toBeInstanceOf(InterviewError)

    // Only a dead session signs anyone out.
    expect(auth.isAuthenticated).toBe(true)
  })
})

describe('the screen the user is left on after the session expires', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function mountMidInterview() {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    signIn()

    const store = useInterviewStore()
    store.setSource(makeExpiringSource())

    router.push('/practice')
    await router.isReady()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await waitFor(() => router.currentRoute.value.path === '/interview', 'interview screen')
    await waitFor(() => wrapper.find('textarea').exists(), 'first question')

    return { wrapper, router }
  }

  it('moves the user to the login screen instead of stranding them on the question', async () => {
    const { wrapper, router } = await mountMidInterview()

    await wrapper.get('textarea').setValue('An answer I spent fifteen minutes on')
    await wrapper.get('form').trigger('submit')
    await waitFor(() => router.currentRoute.value.name === 'login', 'login screen')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('stops claiming the user is signed in, so the header matches reality', async () => {
    const { wrapper, router } = await mountMidInterview()

    expect(wrapper.find('.avatar').exists()).toBe(true)

    await wrapper.get('textarea').setValue('An answer')
    await wrapper.get('form').trigger('submit')
    await waitFor(() => router.currentRoute.value.name === 'login', 'login screen')

    expect(wrapper.find('.avatar').exists()).toBe(false)
    expect(wrapper.findAll('.settings-menu').length).toBe(0)
  })

  it('will not let a back-navigation to the interview slip past the guard', async () => {
    const { wrapper, router } = await mountMidInterview()

    await wrapper.get('textarea').setValue('An answer')
    await wrapper.get('form').trigger('submit')
    await waitFor(() => router.currentRoute.value.name === 'login', 'login screen')

    await router.push('/interview')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
  })
})
