import { describe, expect, it } from 'vitest'
import {
  createMockInterviewSource,
  extractJobDescriptionTerms,
  InterviewError
} from './interview.service'
import type { Answer, InterviewConfig, InterviewSession } from '@/types/interview'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return {
    jobTitle: 'frontend',
    level: 'mid',
    type: 'technical',
    questionCount: 3,
    ...overrides
  }
}

function answerFor(questionId: string, text: string): Answer {
  return { questionId, text, submittedAt: '2026-07-18T10:00:00.000Z' }
}

/** Drive one question through the loop the store would run. */
async function askAndAnswer(
  source: ReturnType<typeof createMockInterviewSource>,
  session: InterviewSession,
  text: string
) {
  const question = await source.getNextQuestion(session)
  if (!question) return null

  session.asked.push(question)
  const answer = answerFor(question.id, text)
  const evaluation = await source.evaluateAnswer(session, question, answer)
  session.answers.push(answer)
  session.evaluations.push(evaluation)

  return question
}

describe('extractJobDescriptionTerms', () => {
  it('ranks the most frequent meaningful terms first', () => {
    const terms = extractJobDescriptionTerms('Vue Vue Vue accessibility accessibility testing')

    expect(terms).toEqual(['vue', 'accessibility', 'testing'])
  })

  it('drops filler words', () => {
    const terms = extractJobDescriptionTerms('You will work with the team and have experience')

    expect(terms).not.toContain('team')
    expect(terms).not.toContain('experience')
  })

  it('breaks ties alphabetically so results stay stable', () => {
    const first = extractJobDescriptionTerms('redis kafka docker')
    const second = extractJobDescriptionTerms('redis kafka docker')

    expect(first).toEqual(second)
    expect(first).toEqual(['docker', 'kafka', 'redis'])
  })
})

describe('mockInterviewSource', () => {
  it('starts a session with the given config and no history', async () => {
    const source = createMockInterviewSource()

    const session = await source.startInterview(makeConfig())

    expect(session.config.jobTitle).toBe('frontend')
    expect(session.asked).toEqual([])
    expect(session.evaluations).toEqual([])
  })

  it('rejects a question count below one', async () => {
    const source = createMockInterviewSource()

    await expect(source.startInterview(makeConfig({ questionCount: 0 }))).rejects.toBeInstanceOf(
      InterviewError
    )
  })

  /**
   * The curated `frontend`/`technical` bank has exactly 5 entries. Asking for more
   * than a bank actually has must not silently promise a count the interview can
   * never reach — `session.config.questionCount` is what the progress bar, the
   * continue button, and the encouragement modal all read as "the total."
   */
  it('clamps the session config to how many questions the bank actually has', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig({ questionCount: 7 }))

    expect(session.config.questionCount).toBe(5)

    const baseIds: string[] = []
    let question = await source.getNextQuestion(session)
    while (question) {
      if (!question.isFollowUp) baseIds.push(question.id)
      session.asked.push(question)
      question = await source.getNextQuestion(session)
    }

    expect(baseIds).toHaveLength(5)
  })

  it('rejects an empty answer instead of grading it', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig())
    const question = await source.getNextQuestion(session)

    await expect(
      source.evaluateAnswer(session, question!, answerFor(question!.id, '  '))
    ).rejects.toBeInstanceOf(InterviewError)
  })

  it('serves a follow-up after a weak answer, then moves on', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig())

    const first = await askAndAnswer(source, session, 'No idea.')
    const second = await source.getNextQuestion(session)

    expect(second?.isFollowUp).toBe(true)
    expect(second?.parentId).toBe(first!.id)
  })

  it('never serves more than one follow-up per question', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig())

    await askAndAnswer(source, session, 'No idea.')
    await askAndAnswer(source, session, 'Still no idea.')
    const next = await source.getNextQuestion(session)

    expect(next?.isFollowUp).toBe(false)
  })

  it('ends the interview once every base question is answered', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig({ questionCount: 2 }))

    // Long, specific answers score high enough that no follow-up is triggered.
    const strong = `Because I have done this before, for example on my last project we measured
      first and profiled the bundle, the router, the component render, the state, the fetch and
      the cache, then compared the loading and skeleton behaviour. However the tradeoff is more
      code, and the reason I still do it is that it keeps the scope and the url predictable,
      which means the store stays small and local state stays where it belongs.`

    let asked = 0
    while (await askAndAnswer(source, session, strong)) asked++

    expect(asked).toBe(2)
    expect(await source.getNextQuestion(session)).toBeNull()
  })

  it('appends a question tailored to a pasted job description', async () => {
    const source = createMockInterviewSource()
    const config = makeConfig({ jobDescription: 'Vue Vue accessibility accessibility testing' })
    const session = await source.startInterview(config)

    // Run to completion: weak answers trigger follow-ups, so the count is not fixed.
    const asked: string[] = []
    let question = await askAndAnswer(source, session, 'Yes because for example however.')
    while (question) {
      if (!question.isFollowUp) asked.push(question.id)
      question = await askAndAnswer(source, session, 'Yes because for example however.')
    }

    expect(asked).toHaveLength(config.questionCount)
    expect(asked.at(-1)).toBe('jd-tailored')
  })

  it('refuses to build a report before anything has been answered', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig())

    await expect(source.getReport(session)).rejects.toBeInstanceOf(InterviewError)
  })

  it('averages the evaluations into an overall grade', async () => {
    const source = createMockInterviewSource()
    const session = await source.startInterview(makeConfig({ questionCount: 1 }))

    await askAndAnswer(source, session, 'A short answer about the store.')
    const report = await source.getReport(session)

    const expected = Math.round(
      session.evaluations.reduce((sum, e) => sum + e.grade, 0) / session.evaluations.length
    )
    expect(report.overallGrade).toBe(expected)
    expect(report.entries).toHaveLength(session.evaluations.length)
  })
})
