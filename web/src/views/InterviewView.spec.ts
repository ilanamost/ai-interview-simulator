import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import InterviewView from './InterviewView.vue'
import { createAppRouter } from '@/router'
import { useInterviewStore } from '@/stores/interview.store'
import type { InterviewSource } from '@/services/interview.service'
import { ENCOURAGEMENT_INTERVAL, ENCOURAGEMENT_MESSAGES } from '@/services/gamification.service'
import type { Evaluation, InterviewConfig, Question } from '@/types/interview'

const CONFIG: InterviewConfig = {
  jobTitle: 'frontend',
  level: 'mid',
  type: 'technical',
  questionCount: 8
}

function makeQuestion(id: string): Question {
  return { id, text: `Question ${id}`, topic: 'Topic', isFollowUp: false, keywords: [] }
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

/** A source that hands back one question per grade in `grades`, then that grade. */
function makeStubSource(grades: number[]): InterviewSource {
  const questions = grades.map((_, i) => makeQuestion(`q${i + 1}`))
  const evaluations = grades.map((grade, i) => makeEvaluation(`q${i + 1}`, grade))

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
      return questions.shift() ?? null
    },
    async evaluateAnswer(_session, question) {
      return evaluations.shift() ?? makeEvaluation(question.id, 80)
    },
    async getReport() {
      return { overallGrade: 80, headline: 'Headline', strengths: [], improvements: [], entries: [] }
    }
  }
}

async function mountView(grades: number[]) {
  const pinia = createPinia()
  setActivePinia(pinia)

  // The view only needs `useRouter()`; the route itself is exercised by `interview-flow.spec.ts`.
  const router = createAppRouter(createMemoryHistory())
  router.push('/')
  await router.isReady()

  const store = useInterviewStore()
  store.setSource(makeStubSource(grades))
  await store.start(CONFIG)

  const wrapper = mount(InterviewView, {
    global: { plugins: [pinia, router] },
    attachTo: document.body
  })
  await flushPromises()

  /** Mount the screen again over the same store, as navigating back to it would. */
  async function remount() {
    const next = mount(InterviewView, { global: { plugins: [pinia, router] } })
    await flushPromises()
    return next
  }

  return { wrapper, store, remount }
}

/** Answer the question on screen through the real form, then wait for the feedback. */
async function answerCurrentQuestion(wrapper: VueWrapper, text = 'A thorough answer.') {
  await wrapper.get('textarea').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

function advanceButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find(b => /Next question|See your report/.test(b.text()))
}

async function goToNextQuestion(wrapper: VueWrapper) {
  await advanceButton(wrapper)!.trigger('click')
  await flushPromises()
}

/** Answer `count` questions in a row, all with the same grade behind them. */
async function answerRun(wrapper: VueWrapper, count: number) {
  for (let i = 0; i < count; i++) {
    await answerCurrentQuestion(wrapper)
    if (i < count - 1) await goToNextQuestion(wrapper)
  }
}

const GOOD = 85
const WEAK = 40

describe('InterviewView encouragement', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('does not celebrate before a milestone is reached', async () => {
    const { wrapper } = await mountView(Array(4).fill(GOOD))

    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL - 1)

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
  })

  it('opens the modal once enough successful answers cross a milestone', async () => {
    const { wrapper } = await mountView(Array(4).fill(GOOD))

    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)

    expect(wrapper.find('.encouragement-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain(ENCOURAGEMENT_MESSAGES[0])
  })

  it('never celebrates a run of weak answers', async () => {
    const { wrapper } = await mountView(Array(4).fill(WEAK))

    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL * 2)

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
  })

  it('closes on dismiss and leaves the evaluation flow untouched underneath', async () => {
    const { wrapper } = await mountView(Array(4).fill(GOOD))
    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)

    await wrapper.get('.encouragement-close').trigger('click')
    await flushPromises()

    expect(wrapper.find('.encouragement-panel').exists()).toBe(false)
    // The feedback for the answer that earned the milestone is still on screen.
    expect(wrapper.text()).toContain('Feedback')
    expect(advanceButton(wrapper)).toBeDefined()
  })

  it('still advances to the next question after the modal has been dismissed', async () => {
    const { wrapper, store } = await mountView(Array(4).fill(GOOD))
    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)
    await wrapper.get('.encouragement-close').trigger('click')

    await goToNextQuestion(wrapper)

    expect(store.status).toBe('asking')
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('shows a fresh message when the next milestone comes around', async () => {
    const { wrapper } = await mountView(Array(ENCOURAGEMENT_INTERVAL * 2 + 1).fill(GOOD))

    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)
    await wrapper.get('.encouragement-close').trigger('click')
    await goToNextQuestion(wrapper)
    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)

    expect(wrapper.find('.encouragement-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain(ENCOURAGEMENT_MESSAGES[1])
    expect(wrapper.text()).not.toContain(ENCOURAGEMENT_MESSAGES[0])
  })

  /** The counter is monotonic and never reset, so a remount must not re-celebrate. */
  it('does not pop open on mount when the counter is already nonzero', async () => {
    const { wrapper, store, remount } = await mountView(Array(4).fill(GOOD))
    await answerRun(wrapper, ENCOURAGEMENT_INTERVAL)
    await wrapper.get('.encouragement-close').trigger('click')

    const remounted = await remount()

    expect(store.encouragementTrigger).toBe(1)
    expect(remounted.find('.encouragement-panel').exists()).toBe(false)
  })

  /**
   * `CONFIG.questionCount` is 8; these two tests use exactly 8 grades so the last
   * successful answer really is the interview's last question — every other test in
   * this file answers fewer than `questionCount`, so `isLastQuestion` never becomes
   * true there.
   */
  it('tells the user the next question is waiting mid-interview', async () => {
    const { wrapper } = await mountView(Array(8).fill(GOOD))

    await answerRun(wrapper, 1)

    expect(wrapper.get('.encouragement-note').text()).toBe(
      'Keep going — the next question is waiting.'
    )
  })

  it('points to the report instead when the milestone lands on the last question', async () => {
    const { wrapper } = await mountView(Array(8).fill(GOOD))

    await answerRun(wrapper, 8)

    expect(wrapper.get('.encouragement-note').text()).toBe(
      'That was the last question — your report is next.'
    )
  })
})
