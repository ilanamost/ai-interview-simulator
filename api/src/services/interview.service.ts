import { randomUUID } from 'node:crypto'
import { AppError } from '../utils/app-error.js'
import type {
  InterviewRepository,
  ListInterviewQuery
} from '../repositories/interview.repository.js'
import type { LlmAdapter } from './llm/llm.adapter.js'
import type {
  Evaluation,
  InterviewConfig,
  InterviewSession,
  InterviewSummaryPage,
  Question,
  Report
} from '../types/interview.js'

export interface InterviewServiceDeps {
  repository: InterviewRepository
  llm: LlmAdapter
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  idGenerator?: () => string
}

/** Rank repeated feedback lines highest, breaking ties alphabetically for determinism. */
function topRecurring(lines: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([line]) => line)
}

function buildHeadline(grade: number): string {
  if (grade >= 85) return 'Interview-ready — consistently strong, specific answers.'
  if (grade >= 70) return 'Close to ready — the fundamentals are there, depth is the gap.'
  if (grade >= 50) return 'Promising, but answers need more substance before a real interview.'
  return 'Significant preparation needed across most areas.'
}

export function buildReport(session: InterviewSession): Report {
  const entries = []
  for (const evaluation of session.evaluations) {
    const question = session.asked.find(q => q.id === evaluation.questionId)
    const answer = session.answers.find(a => a.questionId === evaluation.questionId)
    if (question && answer) entries.push({ question, answer, evaluation })
  }

  const total = session.evaluations.reduce((sum, e) => sum + e.grade, 0)
  const overallGrade = Math.round(total / session.evaluations.length)

  return {
    overallGrade,
    headline: buildHeadline(overallGrade),
    strengths: topRecurring(
      session.evaluations.flatMap(e => e.strengths),
      3
    ),
    improvements: topRecurring(
      session.evaluations.flatMap(e => e.improvements),
      3
    ),
    entries
  }
}

export function createInterviewService(deps: InterviewServiceDeps) {
  const nextId = deps.idGenerator ?? randomUUID

  async function loadSessionOrThrow(id: string, org: string): Promise<InterviewSession> {
    const session = await deps.repository.getInterview(id, org)
    if (!session) throw AppError.notFound(`No interview found with id ${id}.`)
    return session
  }

  return {
    async startInterview(org: string, config: InterviewConfig): Promise<InterviewSession> {
      return deps.repository.createInterview({ id: nextId(), org, config })
    },

    async getInterview(org: string, id: string): Promise<InterviewSession> {
      return loadSessionOrThrow(id, org)
    },

    /**
     * History list. Membership, grade, ordering and paging are all decided by the
     * repository's query — there is nothing to re-sort or re-slice here, and doing so
     * would only be able to reorder the page rather than the set it was cut from.
     */
    async listInterviews(
      org: string,
      query: ListInterviewQuery = {}
    ): Promise<InterviewSummaryPage> {
      return deps.repository.listInterviews(org, query)
    },

    /** Next base question or follow-up; `null` once the interview is complete. */
    async getNextQuestion(org: string, interviewId: string): Promise<Question | null> {
      const session = await loadSessionOrThrow(interviewId, org)
      const last = session.asked[session.asked.length - 1]

      // A base question that scored poorly earns exactly one follow-up.
      if (last && !last.isFollowUp) {
        const evaluation = session.evaluations.find(e => e.questionId === last.id)
        if (evaluation?.needsFollowUp) {
          const answerText = session.answers.find(a => a.questionId === last.id)?.text ?? ''
          const generated = await deps.llm.generateFollowUp({
            config: session.config,
            question: last,
            answerText
          })
          return deps.repository.addQuestion({
            id: nextId(),
            interviewId,
            org,
            position: session.asked.length,
            question: {
              text: generated.text,
              topic: generated.topic,
              isFollowUp: true,
              parentId: last.id,
              keywords: generated.keywords
            }
          })
        }
      }

      const askedBaseQuestions = session.asked.filter(q => !q.isFollowUp)
      if (askedBaseQuestions.length >= session.config.questionCount) return null

      const generated = await deps.llm.generateBaseQuestion({
        config: session.config,
        askedTopics: askedBaseQuestions.map(q => q.topic)
      })

      return deps.repository.addQuestion({
        id: nextId(),
        interviewId,
        org,
        position: session.asked.length,
        question: {
          text: generated.text,
          topic: generated.topic,
          isFollowUp: false,
          keywords: generated.keywords
        }
      })
    },

    async submitAnswer(
      org: string,
      interviewId: string,
      questionId: string,
      text: string
    ): Promise<Evaluation> {
      if (!text.trim()) {
        throw AppError.domain('EMPTY_ANSWER', 'Write an answer before submitting it.')
      }

      const session = await loadSessionOrThrow(interviewId, org)
      const question = session.asked.find(q => q.id === questionId)
      if (!question) {
        throw AppError.notFound(`No question found with id ${questionId} on this interview.`)
      }
      if (session.answers.some(a => a.questionId === questionId)) {
        throw AppError.conflict('This question has already been answered.')
      }

      const submittedAt = new Date().toISOString()
      const answerId = nextId()
      await deps.repository.addAnswer({
        id: answerId,
        interviewId,
        org,
        answer: { questionId, text, submittedAt }
      })

      const generated = await deps.llm.evaluateAnswer({
        config: session.config,
        question,
        answerText: text
      })

      return deps.repository.addEvaluation({
        id: nextId(),
        answerId,
        interviewId,
        org,
        evaluation: {
          questionId,
          grade: generated.grade,
          summary: generated.summary,
          strengths: generated.strengths,
          improvements: generated.improvements,
          needsFollowUp: generated.needsFollowUp
        }
      })
    },

    async getReport(org: string, interviewId: string): Promise<Report> {
      const session = await loadSessionOrThrow(interviewId, org)
      if (session.evaluations.length === 0) {
        throw AppError.domain(
          'NO_EVALUATION',
          'There are no answers to report on yet. Finish at least one question first.'
        )
      }
      return buildReport(session)
    }
  }
}

export type InterviewService = ReturnType<typeof createInterviewService>
