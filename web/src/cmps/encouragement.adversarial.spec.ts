import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { nextTick } from 'vue'
import EncouragementModal from './EncouragementModal.vue'
import InterviewView from '@/views/InterviewView.vue'
import { createAppRouter } from '@/router'
import { useInterviewStore } from '@/stores/interview.store'
import { InterviewError, type InterviewSource } from '@/services/interview.service'
import {
  AUTO_DISMISS_MS,
  ENCOURAGEMENT_INTERVAL,
  ENCOURAGEMENT_MESSAGES,
  pickEncouragementMessage
} from '@/services/gamification.service'
import type { Evaluation, InterviewConfig, Question } from '@/types/interview'

/**
 * QA adversarial pass on plan 019.
 *
 * The happy paths are already covered by `EncouragementModal.spec.ts`,
 * `InterviewView.spec.ts`, and the store's `encouragement milestones` block. What is
 * asked here instead is what happens at the edges the implementation actually reaches:
 * the out-of-range `milestoneIndex` the view really passes before the first
 * celebration, a modal that mounts already open, a milestone that lands while the
 * previous one is still on screen, follow-up answers (which the progress bar
 * deliberately does not count), and a user hammering the dismiss control.
 */

const CONFIG: InterviewConfig = {
  jobTitle: 'frontend',
  level: 'mid',
  type: 'technical',
  questionCount: 8
}

const GOOD = 85

function makeQuestion(id: string, isFollowUp = false): Question {
  return { id, text: `Question ${id}`, topic: 'Topic', isFollowUp, keywords: [] }
}

function makeEvaluation(questionId: string, grade: number): Evaluation {
  return {
    questionId,
    grade,
    summary: 'Summary',
    strengths: ['Strength'],
    improvements: ['Improvement'],
    needsFollowUp: false
  }
}

function makeStubSource(questions: Question[], grades: number[]): InterviewSource {
  const queue = [...questions]
  const evaluations = [...grades]

  return {
    async startInterview(config) {
      return {
        id: 'session-1',
        config,
        createdAt: '2026-09-07T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      }
    },
    async getNextQuestion() {
      return queue.shift() ?? null
    },
    async evaluateAnswer(_session, question) {
      return makeEvaluation(question.id, evaluations.shift() ?? GOOD)
    },
    async getReport() {
      return { overallGrade: 80, headline: 'Headline', strengths: [], improvements: [], entries: [] }
    }
  }
}

describe('EncouragementModal — hostile props', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /**
   * `InterviewView.vue` binds `store.encouragementTrigger - 1`, which is `-1` for the
   * whole interview before the first celebration. `-1 % 5` is `-1` in JS, so without
   * the component's `Math.max(0, …)` clamp the panel would render an `undefined`
   * message the moment anything rendered it at that value.
   */
  it('renders a real message at the -1 the view passes before the first milestone', () => {
    const wrapper = mount(EncouragementModal, {
      props: { open: true, milestoneIndex: -1 }
    })

    expect(wrapper.get('.encouragement-message').text()).toBe(pickEncouragementMessage(0))
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('still wraps into the pool at an absurdly large milestone index', () => {
    const wrapper = mount(EncouragementModal, {
      props: { open: true, milestoneIndex: 10_000 }
    })

    const shown = wrapper.get('.encouragement-message').text()
    expect(ENCOURAGEMENT_MESSAGES).toContain(shown)
  })

  it('renders an icon alongside the message at every index in two full passes', () => {
    for (let i = 0; i < ENCOURAGEMENT_MESSAGES.length * 2; i++) {
      const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: i } })

      expect(wrapper.get('.encouragement-icon').find('svg').exists()).toBe(true)
      expect(wrapper.get('.encouragement-message').text().length).toBeGreaterThan(0)
      wrapper.unmount()
    }
  })
})

describe('EncouragementModal — mounted already open', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /** The `{ immediate: true }` watch is what arms these on a modal that mounts open. */
  it('arms the auto-dismiss timer without ever being toggled open', async () => {
    vi.useFakeTimers()
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    vi.advanceTimersByTime(AUTO_DISMISS_MS)
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('arms the Escape listener without ever being toggled open', async () => {
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  /** Mounting closed must not arm a timer that fires into a modal nobody ever saw. */
  it('arms nothing when it mounts closed and is never opened', async () => {
    vi.useFakeTimers()
    const wrapper = mount(EncouragementModal, { props: { open: false, milestoneIndex: 0 } })

    vi.advanceTimersByTime(AUTO_DISMISS_MS * 3)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('ignores a key that is not Escape', async () => {
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Esc' }))
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  /**
   * The listener is on `document`, so an unmount that failed to remove it would keep
   * emitting into a dead component for the rest of the session.
   */
  it('stops answering Escape once it is unmounted', async () => {
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    wrapper.unmount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('EncouragementModal — a milestone landing on an open modal', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /**
   * The parent only ever sets `showEncouragement` true, so a second milestone crossed
   * while the first is still on screen changes `milestoneIndex` without changing
   * `open`. The copy swaps under the user — documented here as the current behaviour.
   */
  it('swaps to the new message while staying open', async () => {
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    await wrapper.setProps({ milestoneIndex: 1 })

    expect(wrapper.get('.encouragement-message').text()).toBe(ENCOURAGEMENT_MESSAGES[1])
    expect(wrapper.find('.encouragement-panel').exists()).toBe(true)
  })

  /**
   * RESOLVED (was a finding): the auto-dismiss watch now keys on `milestoneIndex` too,
   * not just `open`, so a second milestone landing while the first is still on screen
   * gets its own full `AUTO_DISMISS_MS` rather than inheriting whatever was left of the
   * first one's clock.
   */
  it('restarts the auto-dismiss timer for the new milestone', async () => {
    vi.useFakeTimers()
    const wrapper = mount(EncouragementModal, { props: { open: true, milestoneIndex: 0 } })

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 10)
    await wrapper.setProps({ milestoneIndex: 1 })
    vi.advanceTimersByTime(10)
    await nextTick()

    // The first milestone's clock would have fired here — it must not have.
    expect(wrapper.emitted('close')).toBeUndefined()

    vi.advanceTimersByTime(AUTO_DISMISS_MS - 10)
    await nextTick()

    // The second milestone's own full timer fires on schedule instead.
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('InterviewView encouragement — hammering the controls', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  async function mountAtFirstMilestone(questions: Question[], grades: number[]) {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter(createMemoryHistory())
    router.push('/')
    await router.isReady()

    const store = useInterviewStore()
    store.setSource(makeStubSource(questions, grades))
    await store.start(CONFIG)

    const wrapper = mount(InterviewView, {
      global: { plugins: [pinia, router] },
      attachTo: document.body
    })
    await flushPromises()

    return { wrapper, store }
  }

  async function answer(wrapper: ReturnType<typeof mount>) {
    await wrapper.get('textarea').setValue('A thorough answer.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
  }

  async function advance(wrapper: ReturnType<typeof mount>) {
    const button = wrapper.findAll('button').find(b => /Next question|See your report/.test(b.text()))
    await button!.trigger('click')
    await flushPromises()
  }

  /** A user double-clicking the X must dismiss once, not throw on the second click. */
  it('survives the dismiss button being clicked repeatedly', async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeQuestion(`q${i + 1}`))
    const { wrapper } = await mountAtFirstMilestone(questions, Array(4).fill(GOOD))

    for (let i = 0; i < ENCOURAGEMENT_INTERVAL; i++) {
      await answer(wrapper)
      if (i < ENCOURAGEMENT_INTERVAL - 1) await advance(wrapper)
    }
    expect(wrapper.find('.encouragement-panel').exists()).toBe(true)

    const close = wrapper.get('.encouragement-close')
    await close.trigger('click')
    await close.trigger('click')
    await close.trigger('click')
    await flushPromises()

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
  })

  /** Escape spam must not leave the modal half-dismissed or reopen it. */
  it('survives Escape being pressed repeatedly', async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeQuestion(`q${i + 1}`))
    const { wrapper } = await mountAtFirstMilestone(questions, Array(4).fill(GOOD))

    for (let i = 0; i < ENCOURAGEMENT_INTERVAL; i++) {
      await answer(wrapper)
      if (i < ENCOURAGEMENT_INTERVAL - 1) await advance(wrapper)
    }

    for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
    // The screen underneath is untouched and still advanceable.
    expect(wrapper.text()).toContain('Feedback')
  })

  /**
   * The modal is a fixed, full-viewport overlay, so while it is up it covers the
   * answer form. Once dismissed the flow has to be fully usable again — this is the
   * plan's own stated risk.
   */
  it('leaves the answer form usable after the auto-dismiss fires on its own', async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeQuestion(`q${i + 1}`))
    const { wrapper, store } = await mountAtFirstMilestone(questions, Array(4).fill(GOOD))

    for (let i = 0; i < ENCOURAGEMENT_INTERVAL; i++) {
      await answer(wrapper)
      if (i < ENCOURAGEMENT_INTERVAL - 1) await advance(wrapper)
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    await advance(wrapper)
    await answer(wrapper)

    expect(store.status).toBe('reviewing')
    expect(store.session!.answers).toHaveLength(ENCOURAGEMENT_INTERVAL + 1)
  })
})

describe('encouragement milestones — counting edge cases', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  /**
   * RESOLVED (was a finding): `answeredCount` deliberately excludes follow-ups from
   * progress, and the milestone counter now matches that definition — a follow-up
   * answer, however well it scores, does not count toward a celebration, keeping the
   * cadence consistent with what the progress bar calls an "answer".
   */
  it('does not count a well-answered follow-up toward the milestone', async () => {
    const store = useInterviewStore()
    store.setSource(
      makeStubSource(
        [makeQuestion('q1'), makeQuestion('q1-f', true)],
        [GOOD, GOOD]
      )
    )
    await store.start(CONFIG)

    await store.submitAnswer('Strong')
    // The base question alone already earns its own milestone at ENCOURAGEMENT_INTERVAL = 1.
    expect(store.encouragementTrigger).toBe(1)

    await store.continueInterview()
    await store.submitAnswer('Strong follow-up')

    expect(store.answeredCount).toBe(1)
    // The follow-up does not add a second milestone.
    expect(store.encouragementTrigger).toBe(1)
  })

  /** A thrown evaluation must leave the counter exactly where it was. */
  it('does not advance the counter when the second answer fails to evaluate', async () => {
    const store = useInterviewStore()
    const failing: InterviewSource = {
      ...makeStubSource([makeQuestion('q1'), makeQuestion('q2')], [GOOD]),
      async evaluateAnswer(_session, question) {
        if (question.id === 'q2') throw new InterviewError('BOOM', 'Could not evaluate.')
        return makeEvaluation(question.id, GOOD)
      }
    }
    store.setSource(failing)
    await store.start(CONFIG)

    await store.submitAnswer('Strong')
    expect(store.encouragementTrigger).toBe(1)

    await store.continueInterview()
    await expect(store.submitAnswer('Doomed')).rejects.toBeInstanceOf(InterviewError)

    // The failed second answer does not change what the first one already earned.
    expect(store.encouragementTrigger).toBe(1)
  })

  /**
   * The store has no in-flight guard on `submitAnswer` — the UI's `busy` prop is what
   * prevents a double submit. Documented so a future change that drops that guard shows
   * up here rather than as a duplicated celebration. At `ENCOURAGEMENT_INTERVAL = 1`
   * each concurrent success earns its own milestone, so one question in flight twice
   * would celebrate twice.
   */
  it('would double-count one question if two submits were ever allowed in flight', async () => {
    const store = useInterviewStore()
    store.setSource(makeStubSource([makeQuestion('q1')], [GOOD, GOOD]))
    await store.start(CONFIG)

    await Promise.all([store.submitAnswer('First'), store.submitAnswer('Second')])

    expect(store.session!.answers).toHaveLength(2)
    expect(store.encouragementTrigger).toBe(2)
  })
})
