import { describe, expect, it, vi } from 'vitest'
import { buildReport, createInterviewService } from './interview.service.js'
import type { InterviewRepository } from '../repositories/interview.repository.js'
import type { LlmAdapter } from './llm/llm.adapter.js'
import type { InterviewConfig, InterviewSession, Question } from '../types/interview.js'
import { AppError } from '../utils/app-error.js'

const ORG = 'default'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2, ...overrides }
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 'interview-1',
    config: makeConfig(),
    createdAt: '2026-07-18T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: [],
    ...overrides
  }
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    text: 'Explain X',
    topic: 'Rendering',
    isFollowUp: false,
    keywords: ['a'],
    ...overrides
  }
}

function makeRepository(overrides: Partial<InterviewRepository> = {}): InterviewRepository {
  return {
    createInterview: vi.fn(),
    getInterview: vi.fn(),
    countAskedBaseQuestions: vi.fn(),
    getLastQuestion: vi.fn(),
    getQuestion: vi.fn(),
    getEvaluationForQuestion: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    addEvaluation: vi.fn(),
    ...overrides
  } as unknown as InterviewRepository
}

function makeLlm(overrides: Partial<LlmAdapter> = {}): LlmAdapter {
  return {
    generateBaseQuestion: vi.fn(),
    generateFollowUp: vi.fn(),
    evaluateAnswer: vi.fn(),
    ...overrides
  } as unknown as LlmAdapter
}

describe('interview.service', () => {
  describe('startInterview', () => {
    it('creates an interview scoped to the given org', async () => {
      const session = makeSession()
      const repository = makeRepository({ createInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({
        repository,
        llm: makeLlm(),
        idGenerator: () => 'new-id'
      })

      const result = await service.startInterview(ORG, session.config)

      expect(result).toBe(session)
      expect(repository.createInterview).toHaveBeenCalledWith({
        id: 'new-id',
        org: ORG,
        config: session.config
      })
    })
  })

  describe('getInterview', () => {
    it('throws a NOT_FOUND AppError when the interview does not exist', async () => {
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(null) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(service.getInterview(ORG, 'missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404
      })
    })

    it('returns the persisted session when found', async () => {
      const session = makeSession()
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(service.getInterview(ORG, session.id)).resolves.toBe(session)
    })
  })

  describe('listInterviews', () => {
    const page = {
      items: [
        {
          id: 'interview-1',
          config: makeConfig(),
          createdAt: '2026-07-18T10:00:00.000Z',
          overallGrade: 82
        }
      ],
      total: 31
    }

    it('passes the org and the whole query through, and returns the page untouched', async () => {
      // Ordering and slicing belong to the SQL: anything re-sorted or re-sliced here
      // could only reorder the page, never the set it was cut from.
      const listInterviews = vi.fn().mockResolvedValue(page)
      const service = createInterviewService({
        repository: makeRepository({ listInterviews }),
        llm: makeLlm()
      })

      const query = {
        date: '2026-08-14',
        jobTitle: 'backend',
        level: 'senior',
        type: 'behavioral',
        sort: 'grade-desc',
        page: 3,
        pageSize: 25
      } as const

      await expect(service.listInterviews(ORG, query)).resolves.toBe(page)
      expect(listInterviews).toHaveBeenCalledWith(ORG, query)
    })

    it('defaults to an empty query when the caller sends none', async () => {
      const listInterviews = vi.fn().mockResolvedValue({ items: [], total: 0 })
      const service = createInterviewService({
        repository: makeRepository({ listInterviews }),
        llm: makeLlm()
      })

      await expect(service.listInterviews(ORG)).resolves.toEqual({ items: [], total: 0 })
      expect(listInterviews).toHaveBeenCalledWith(ORG, {})
    })
  })

  describe('getNextQuestion', () => {
    it('generates the first base question when nothing has been asked yet', async () => {
      const session = makeSession()
      const generated = { text: 'Q1', topic: 'Rendering', keywords: ['state'] }
      const savedQuestion = makeQuestion({ id: 'q1', ...generated })
      const repository = makeRepository({
        getInterview: vi.fn().mockResolvedValue(session),
        addQuestion: vi.fn().mockResolvedValue(savedQuestion)
      })
      const llm = makeLlm({ generateBaseQuestion: vi.fn().mockResolvedValue(generated) })
      const service = createInterviewService({ repository, llm, idGenerator: () => 'q1' })

      const question = await service.getNextQuestion(ORG, session.id)

      expect(question).toBe(savedQuestion)
      expect(llm.generateBaseQuestion).toHaveBeenCalledWith({
        config: session.config,
        askedTopics: []
      })
      expect(repository.addQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q1', interviewId: session.id, org: ORG, position: 0 })
      )
    })

    it('returns null once every base question has been asked', async () => {
      const session = makeSession({
        config: makeConfig({ questionCount: 1 }),
        asked: [makeQuestion({ id: 'q1' })]
      })
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const llm = makeLlm()
      const service = createInterviewService({ repository, llm })

      const question = await service.getNextQuestion(ORG, session.id)

      expect(question).toBeNull()
      expect(llm.generateBaseQuestion).not.toHaveBeenCalled()
    })

    it('asks a follow-up when the last base answer needed one, instead of the next base question', async () => {
      const lastQuestion = makeQuestion({ id: 'q1', topic: 'Rendering' })
      const session = makeSession({
        config: makeConfig({ questionCount: 3 }),
        asked: [lastQuestion],
        answers: [
          { questionId: 'q1', text: 'a weak answer', submittedAt: '2026-07-18T10:05:00.000Z' }
        ],
        evaluations: [
          {
            questionId: 'q1',
            grade: 40,
            summary: 's',
            strengths: [],
            improvements: [],
            needsFollowUp: true
          }
        ]
      })
      const generatedFollowUp = { text: 'Follow up?', topic: 'Rendering', keywords: ['detail'] }
      const savedFollowUp = makeQuestion({
        id: 'q1-f',
        isFollowUp: true,
        parentId: 'q1',
        ...generatedFollowUp
      })
      const repository = makeRepository({
        getInterview: vi.fn().mockResolvedValue(session),
        addQuestion: vi.fn().mockResolvedValue(savedFollowUp)
      })
      const llm = makeLlm({ generateFollowUp: vi.fn().mockResolvedValue(generatedFollowUp) })
      const service = createInterviewService({ repository, llm, idGenerator: () => 'q1-f' })

      const question = await service.getNextQuestion(ORG, session.id)

      expect(question).toBe(savedFollowUp)
      expect(llm.generateFollowUp).toHaveBeenCalledWith({
        config: session.config,
        question: lastQuestion,
        answerText: 'a weak answer'
      })
      expect(repository.addQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          question: expect.objectContaining({ isFollowUp: true, parentId: 'q1' })
        })
      )
    })

    it('does not ask a follow-up to a follow-up, even if the LLM would say it needs one', async () => {
      const followUp = makeQuestion({ id: 'q1-f', isFollowUp: true, parentId: 'q1' })
      const session = makeSession({
        config: makeConfig({ questionCount: 1 }),
        asked: [makeQuestion({ id: 'q1' }), followUp],
        answers: [
          { questionId: 'q1', text: 'weak', submittedAt: '2026-07-18T10:05:00.000Z' },
          { questionId: 'q1-f', text: 'still weak', submittedAt: '2026-07-18T10:06:00.000Z' }
        ],
        evaluations: [
          {
            questionId: 'q1',
            grade: 40,
            summary: 's',
            strengths: [],
            improvements: [],
            needsFollowUp: true
          },
          {
            questionId: 'q1-f',
            grade: 30,
            summary: 's',
            strengths: [],
            improvements: [],
            needsFollowUp: true
          }
        ]
      })
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const llm = makeLlm()
      const service = createInterviewService({ repository, llm })

      const question = await service.getNextQuestion(ORG, session.id)

      expect(question).toBeNull()
      expect(llm.generateFollowUp).not.toHaveBeenCalled()
    })
  })

  describe('submitAnswer', () => {
    it('rejects an empty answer without persisting anything', async () => {
      const repository = makeRepository()
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(service.submitAnswer(ORG, 'interview-1', 'q1', '   ')).rejects.toMatchObject({
        code: 'EMPTY_ANSWER',
        status: 422
      })
      expect(repository.getInterview).not.toHaveBeenCalled()
    })

    it('throws NOT_FOUND when the question was never asked on this interview', async () => {
      const session = makeSession({ asked: [makeQuestion({ id: 'q1' })] })
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(
        service.submitAnswer(ORG, session.id, 'unknown-question', 'text')
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404
      })
    })

    it('rejects answering the same question twice', async () => {
      const session = makeSession({
        asked: [makeQuestion({ id: 'q1' })],
        answers: [
          { questionId: 'q1', text: 'already answered', submittedAt: '2026-07-18T10:05:00.000Z' }
        ]
      })
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(service.submitAnswer(ORG, session.id, 'q1', 'text')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409
      })
    })

    it('persists the answer, evaluates it, and persists the evaluation', async () => {
      const question = makeQuestion({ id: 'q1' })
      const session = makeSession({ asked: [question] })
      const generatedEval = {
        grade: 82,
        summary: 'Solid',
        strengths: ['clear'],
        improvements: [],
        needsFollowUp: false
      }
      const savedEvaluation = { questionId: 'q1', ...generatedEval }
      const repository = makeRepository({
        getInterview: vi.fn().mockResolvedValue(session),
        addAnswer: vi
          .fn()
          .mockResolvedValue({ questionId: 'q1', text: 'a good answer', submittedAt: 'now' }),
        addEvaluation: vi.fn().mockResolvedValue(savedEvaluation)
      })
      const llm = makeLlm({ evaluateAnswer: vi.fn().mockResolvedValue(generatedEval) })
      const service = createInterviewService({ repository, llm, idGenerator: () => 'gen-id' })

      const evaluation = await service.submitAnswer(ORG, session.id, 'q1', 'a good answer')

      expect(evaluation).toBe(savedEvaluation)
      expect(repository.addAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.objectContaining({ questionId: 'q1', text: 'a good answer' })
        })
      )
      expect(llm.evaluateAnswer).toHaveBeenCalledWith({
        config: session.config,
        question,
        answerText: 'a good answer'
      })
      expect(repository.addEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ evaluation: expect.objectContaining(generatedEval) })
      )
    })

    it('links the evaluation to the answer it was created for, not the question id', async () => {
      const question = makeQuestion({ id: 'q1' })
      const session = makeSession({ asked: [question] })
      const repository = makeRepository({
        getInterview: vi.fn().mockResolvedValue(session),
        addAnswer: vi.fn().mockResolvedValue({ questionId: 'q1', text: 't', submittedAt: 'now' }),
        addEvaluation: vi.fn().mockResolvedValue({
          questionId: 'q1',
          grade: 50,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        })
      })
      const llm = makeLlm({
        evaluateAnswer: vi
          .fn()
          .mockResolvedValue({
            grade: 50,
            summary: 's',
            strengths: [],
            improvements: [],
            needsFollowUp: false
          })
      })
      let idCount = 0
      const service = createInterviewService({
        repository,
        llm,
        idGenerator: () => `id-${++idCount}`
      })

      await service.submitAnswer(ORG, session.id, 'q1', 't')

      const addAnswerCall = (repository.addAnswer as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const addEvaluationCall = (repository.addEvaluation as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
      expect(addEvaluationCall.answerId).toBe(addAnswerCall.id)
    })
  })

  describe('getReport', () => {
    it('throws a NO_EVALUATION domain error when nothing has been evaluated yet', async () => {
      const session = makeSession()
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      await expect(service.getReport(ORG, session.id)).rejects.toMatchObject({
        code: 'NO_EVALUATION',
        status: 422
      })
    })

    it('averages grades and surfaces the most recurring feedback', async () => {
      const q1 = makeQuestion({ id: 'q1' })
      const q2 = makeQuestion({ id: 'q2' })
      const session = makeSession({
        asked: [q1, q2],
        answers: [
          { questionId: 'q1', text: 'a1', submittedAt: 't1' },
          { questionId: 'q2', text: 'a2', submittedAt: 't2' }
        ],
        evaluations: [
          {
            questionId: 'q1',
            grade: 80,
            summary: 's1',
            strengths: ['clear'],
            improvements: ['depth'],
            needsFollowUp: false
          },
          {
            questionId: 'q2',
            grade: 60,
            summary: 's2',
            strengths: ['clear'],
            improvements: ['examples'],
            needsFollowUp: false
          }
        ]
      })
      const repository = makeRepository({ getInterview: vi.fn().mockResolvedValue(session) })
      const service = createInterviewService({ repository, llm: makeLlm() })

      const report = await service.getReport(ORG, session.id)

      expect(report.overallGrade).toBe(70)
      expect(report.entries).toHaveLength(2)
      expect(report.strengths).toContain('clear')
    })
  })
})

describe('buildReport', () => {
  it('only includes entries with a matching question and answer', () => {
    const q1 = makeQuestion({ id: 'q1' })
    const session = makeSession({
      asked: [q1],
      answers: [{ questionId: 'q1', text: 'a1', submittedAt: 't1' }],
      evaluations: [
        {
          questionId: 'q1',
          grade: 90,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        },
        // orphaned evaluation: no matching question/answer, must not appear as an entry
        {
          questionId: 'ghost',
          grade: 10,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        }
      ]
    })

    const report = buildReport(session)

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]?.question.id).toBe('q1')
  })
})

describe('AppError', () => {
  it('domain() defaults to 422 with the given machine-readable code', () => {
    const err = AppError.domain('SOME_CODE', 'message')
    expect(err.status).toBe(422)
    expect(err.code).toBe('SOME_CODE')
  })
})
