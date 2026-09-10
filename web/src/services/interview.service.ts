import type {
  Answer,
  Evaluation,
  InterviewConfig,
  InterviewSession,
  Question,
  Report,
  ReportEntry
} from '@/types/interview'
import { env } from '@/config/env'
import { evaluateAnswerText } from './answer-grader'
import { createHttpInterviewSource } from './interview-http.service'
import { getBank, type BankEntry } from './question-bank'

/**
 * The contract every source of questions and evaluations must satisfy.
 * Stage 1 ships `mockInterviewSource`; Stage 2 adds an HTTP source behind this
 * same interface so neither the store nor the UI has to change.
 *
 * Sources are stateless: the caller owns the session and passes it in.
 */
export interface InterviewSource {
  startInterview(config: InterviewConfig): Promise<InterviewSession>
  /** Next base question or follow-up; `null` once the interview is complete. */
  getNextQuestion(session: InterviewSession): Promise<Question | null>
  evaluateAnswer(session: InterviewSession, question: Question, answer: Answer): Promise<Evaluation>
  getReport(session: InterviewSession): Promise<Report>
}

/** User-safe error carrying a machine-readable code (.rule/error-handling-rules.md). */
export class InterviewError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'InterviewError'
  }
}

/** Keep the mock feeling like a network call, but never slow the test suite down. */
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 320

function delay(ms: number): Promise<void> {
  // Resolve on the microtask queue when there is no latency to simulate, so tests
  // settle with flushPromises instead of having to advance timers.
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'that', 'this', 'have', 'from',
  'your', 'their', 'they', 'has', 'was', 'were', 'been', 'who', 'how', 'what', 'about',
  'into', 'over', 'able', 'work', 'working', 'team', 'teams', 'role', 'years', 'year',
  'experience', 'strong', 'good', 'great', 'looking', 'candidate', 'must', 'should', 'plus'
])

/**
 * Pull the most prominent terms out of a job description.
 * Ties break alphabetically so the same description always yields the same terms.
 */
export function extractJobDescriptionTerms(jobDescription: string, limit = 3): string[] {
  const counts = new Map<string, number>()

  for (const raw of jobDescription.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const term = raw.replace(/^[.]+|[.]+$/g, '')
    if (term.length < 3 || STOP_WORDS.has(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

function toQuestion(entry: BankEntry): Question {
  return {
    id: entry.id,
    text: entry.text,
    topic: entry.topic,
    isFollowUp: false,
    keywords: entry.keywords
  }
}

function toFollowUp(entry: BankEntry): Question {
  return {
    id: entry.followUp.id,
    text: entry.followUp.text,
    topic: entry.topic,
    isFollowUp: true,
    parentId: entry.id,
    keywords: entry.followUp.keywords
  }
}

/** A tailored closing question, used only when the user pasted a job description. */
function buildTailoredEntry(terms: string[]): BankEntry {
  const list = terms.join(', ')
  return {
    id: 'jd-tailored',
    text: `This role's description leans on ${list}. Where are you strongest among those, and where would you need to ramp up?`,
    topic: 'Role fit',
    keywords: terms,
    followUp: {
      id: 'jd-tailored-f',
      text: 'Take the weakest of those. What would your first two weeks of getting up to speed look like?',
      keywords: ['plan', 'learn', 'ramp', 'practice', 'ask']
    }
  }
}

function planEntries(config: InterviewConfig): BankEntry[] {
  const bank = getBank(config.jobTitle, config.type)
  if (bank.length === 0) {
    throw new InterviewError(
      'BANK_EMPTY',
      'No questions are available for that combination yet. Try a different interview type.'
    )
  }

  const jd = config.jobDescription?.trim()
  const terms = jd ? extractJobDescriptionTerms(jd) : []
  const useTailored = terms.length > 0

  // The tailored question takes the final slot, so the count the user chose still holds.
  const baseCount = useTailored ? config.questionCount - 1 : config.questionCount
  const selected = bank.slice(0, Math.max(0, Math.min(baseCount, bank.length)))

  return useTailored ? [...selected, buildTailoredEntry(terms)] : selected
}

function createSessionId(config: InterviewConfig, createdAt: string): string {
  return `${config.jobTitle}-${config.type}-${new Date(createdAt).getTime()}`
}

export function createMockInterviewSource(): InterviewSource {
  /** Question plan per session id, so the source stays deterministic across calls. */
  const plans = new Map<string, BankEntry[]>()

  function planFor(session: InterviewSession): BankEntry[] {
    const existing = plans.get(session.id)
    if (existing) return existing

    // Recreated on demand: a page reload can hand us a session this instance never started.
    const rebuilt = planEntries(session.config)
    plans.set(session.id, rebuilt)
    return rebuilt
  }

  return {
    async startInterview(config) {
      await delay(LATENCY_MS)

      if (config.questionCount < 1) {
        throw new InterviewError('INVALID_COUNT', 'An interview needs at least one question.')
      }

      const plan = planEntries(config)
      const createdAt = new Date().toISOString()
      const session: InterviewSession = {
        id: createSessionId(config, createdAt),
        // `plan.length` can be less than the requested count — the curated bank for a
        // job title/type has a fixed size, and `planEntries` silently caps to whatever
        // it has. The session's own config becomes the source of truth for how many
        // questions this interview actually has, so the progress bar, the "next
        // question"/"see your report" button, and the encouragement modal all agree
        // with what the user will really be asked instead of the number they picked.
        config: { ...config, questionCount: plan.length },
        createdAt,
        asked: [],
        answers: [],
        evaluations: []
      }

      plans.set(session.id, plan)
      return session
    },

    async getNextQuestion(session) {
      await delay(LATENCY_MS)

      const plan = planFor(session)
      const last = session.asked[session.asked.length - 1]

      // A base question that scored poorly earns exactly one follow-up.
      if (last && !last.isFollowUp) {
        const evaluation = session.evaluations.find(e => e.questionId === last.id)
        const entry = plan.find(item => item.id === last.id)
        if (evaluation?.needsFollowUp && entry) return toFollowUp(entry)
      }

      const askedBaseIds = new Set(session.asked.filter(q => !q.isFollowUp).map(q => q.id))
      const next = plan.find(entry => !askedBaseIds.has(entry.id))
      return next ? toQuestion(next) : null
    },

    async evaluateAnswer(session, question, answer) {
      await delay(LATENCY_MS)

      if (!answer.text.trim()) {
        throw new InterviewError('EMPTY_ANSWER', 'Write an answer before submitting it.')
      }

      return evaluateAnswerText(question, answer.text, session.config.level)
    },

    async getReport(session) {
      await delay(LATENCY_MS)

      if (session.evaluations.length === 0) {
        throw new InterviewError(
          'NO_EVALUATION',
          'There are no answers to report on yet. Finish at least one question first.'
        )
      }

      return buildReport(session)
    }
  }
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
  const entries: ReportEntry[] = []

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
    strengths: topRecurring(session.evaluations.flatMap(e => e.strengths), 3),
    improvements: topRecurring(session.evaluations.flatMap(e => e.improvements), 3),
    entries
  }
}

/** `VITE_INTERVIEW_SOURCE` picks the live source; unset or `mock` keeps the offline demo. */
function createInterviewSource(): InterviewSource {
  if (env.interviewSource === 'http') return createHttpInterviewSource(env.apiBaseUrl)
  return createMockInterviewSource()
}

export const interviewSource: InterviewSource = createInterviewSource()
