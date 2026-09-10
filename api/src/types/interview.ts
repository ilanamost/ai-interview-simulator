/**
 * Domain shapes for the interview flow. Mirrors web/src/types/interview.ts so
 * a future httpInterviewSource can speak the same InterviewSource contract.
 * Canonical term definitions live in .doc/glossary.md.
 */

export const JOB_TITLES = ['frontend', 'backend', 'fullstack', 'devops', 'data'] as const
export const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior'] as const
export const INTERVIEW_TYPES = ['technical', 'behavioral', 'system-design'] as const

/** The Claude models an interview may run on. Doubles as the request allowlist. */
export const LLM_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const

/**
 * How `GET /api/interview` orders the whole filtered set before cutting a page.
 * Doubles as the request allowlist. Mirrors `REPORT_SORTS` in
 * web/src/services/report-history.service.ts.
 */
export const INTERVIEW_SORTS = ['date-desc', 'date-asc', 'grade-desc', 'grade-asc'] as const

export type JobTitle = (typeof JOB_TITLES)[number]
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]
export type InterviewType = (typeof INTERVIEW_TYPES)[number]
export type LlmModel = (typeof LLM_MODELS)[number]
export type InterviewSort = (typeof INTERVIEW_SORTS)[number]

/** Applied when a list request names no ordering — what the endpoint returned before it was paged. */
export const DEFAULT_INTERVIEW_SORT: InterviewSort = 'date-desc'

/** Rows per page when a list request names no `pageSize`. */
export const DEFAULT_PAGE_SIZE = 10

/** The largest page a caller may ask for, so no request can force an unbounded read. */
export const MAX_PAGE_SIZE = 50

/** Used when an interview names no model of its own. */
export const DEFAULT_LLM_MODEL: LlmModel = 'claude-sonnet-5'

/** A grade is a whole number from 0 to 100. */
export type Grade = number

export interface InterviewConfig {
  jobTitle: JobTitle
  level: ExperienceLevel
  type: InterviewType
  jobDescription?: string
  questionCount: number
  /** Which Claude model writes the questions and grades the answers. Falls back to the server default. */
  model?: LlmModel
}

export interface Question {
  id: string
  text: string
  topic: string
  isFollowUp: boolean
  parentId?: string
  keywords: string[]
}

export interface Answer {
  questionId: string
  text: string
  submittedAt: string
}

export interface Evaluation {
  questionId: string
  grade: Grade
  summary: string
  strengths: string[]
  improvements: string[]
  needsFollowUp: boolean
}

export interface ReportEntry {
  question: Question
  answer: Answer
  evaluation: Evaluation
}

export interface Report {
  overallGrade: Grade
  headline: string
  strengths: string[]
  improvements: string[]
  entries: ReportEntry[]
}

/**
 * One row of the history list (`GET /api/interview`). Deliberately not a full
 * `InterviewSession`: the list never needs the questions, answers, or
 * evaluations, only enough to label a row and link to its detail view.
 */
export interface InterviewSummary {
  id: string
  config: InterviewConfig
  createdAt: string
  /**
   * The same number `Report.overallGrade` carries for this interview: the mean
   * of every evaluation's grade, rounded. Only interviews with at least one
   * evaluation appear in the list, so this is never computed from an empty set.
   */
  overallGrade: Grade
}

/**
 * One page of the history list. `total` counts every row matching the FILTERS,
 * independent of `page`/`pageSize`, so a client can derive its page count from it —
 * it must never be capped at the page size.
 */
export interface InterviewSummaryPage {
  items: InterviewSummary[]
  total: number
}

/** Full session snapshot, as persisted and returned by the API. */
export interface InterviewSession {
  id: string
  config: InterviewConfig
  createdAt: string
  asked: Question[]
  answers: Answer[]
  evaluations: Evaluation[]
}
