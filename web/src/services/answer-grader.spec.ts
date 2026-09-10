import { describe, expect, it } from 'vitest'
import { evaluateAnswerText, FOLLOW_UP_THRESHOLD, scoreAnswer } from './answer-grader'
import type { Question } from '@/types/interview'

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    text: 'How do you manage state?',
    topic: 'State',
    isFollowUp: false,
    keywords: ['store', 'local', 'url', 'scope'],
    ...overrides
  }
}

const STRONG_ANSWER = `I keep state as local as I can because a component that owns its own
  state is far easier to move. When two siblings need it I lift it into a store, and anything
  that should survive a refresh or be shareable goes in the url. For example, on my last project
  we had filters in a global store and it kept breaking, so we moved them to the url instead.
  The tradeoff is that url state has to stay serialisable, which rules out anything complex,
  and the scope of each store then has to be documented so nobody dumps everything in it again.`

describe('scoreAnswer', () => {
  it('returns a zero grade for an empty answer', () => {
    const result = scoreAnswer(makeQuestion(), '   ', 'mid')

    expect(result.grade).toBe(0)
    expect(result.missedKeywords).toEqual(['store', 'local', 'url', 'scope'])
  })

  it('is deterministic across repeated calls', () => {
    const question = makeQuestion()

    const first = scoreAnswer(question, STRONG_ANSWER, 'mid')
    const second = scoreAnswer(question, STRONG_ANSWER, 'mid')

    expect(first).toEqual(second)
  })

  it('grades a thorough answer above a shallow one', () => {
    const question = makeQuestion()

    const strong = scoreAnswer(question, STRONG_ANSWER, 'mid')
    const shallow = scoreAnswer(question, 'It depends on the app.', 'mid')

    expect(strong.grade).toBeGreaterThan(shallow.grade)
  })

  it('holds a senior to a longer answer than a junior for identical text', () => {
    const question = makeQuestion()
    const answer = 'I use a store because shared scope matters, and the url for filters.'

    const junior = scoreAnswer(question, answer, 'junior')
    const senior = scoreAnswer(question, answer, 'senior')

    expect(junior.grade).toBeGreaterThan(senior.grade)
  })

  it('reports the keywords an answer never touched', () => {
    const result = scoreAnswer(makeQuestion(), 'I put everything in a store.', 'mid')

    expect(result.missedKeywords).toContain('url')
    expect(result.missedKeywords).not.toContain('store')
  })
})

describe('evaluateAnswerText', () => {
  it('asks for a follow-up when a base answer scores below the threshold', () => {
    const evaluation = evaluateAnswerText(makeQuestion(), 'Not sure.', 'mid')

    expect(evaluation.grade).toBeLessThan(FOLLOW_UP_THRESHOLD)
    expect(evaluation.needsFollowUp).toBe(true)
  })

  it('never asks for a follow-up on a follow-up question', () => {
    const followUp = makeQuestion({ id: 'q1-f', isFollowUp: true, parentId: 'q1' })

    const evaluation = evaluateAnswerText(followUp, 'Not sure.', 'mid')

    expect(evaluation.needsFollowUp).toBe(false)
  })

  it('does not ask for a follow-up when the answer is strong', () => {
    const evaluation = evaluateAnswerText(makeQuestion(), STRONG_ANSWER, 'mid')

    expect(evaluation.grade).toBeGreaterThanOrEqual(FOLLOW_UP_THRESHOLD)
    expect(evaluation.needsFollowUp).toBe(false)
  })

  it('lists missed concepts as improvements', () => {
    const evaluation = evaluateAnswerText(makeQuestion(), 'I put everything in a store.', 'mid')

    expect(evaluation.improvements.join(' ')).toContain('url')
  })
})
