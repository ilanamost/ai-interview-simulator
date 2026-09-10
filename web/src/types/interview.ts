/**
 * Shared domain shapes for the interview flow.
 * Stage 1 (mock) and Stage 2 (API) both speak exactly these types.
 * Canonical term definitions live in .doc/glossary.md.
 */

export const JOB_TITLES = ['frontend', 'backend', 'fullstack', 'devops', 'data'] as const
export const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior'] as const
export const INTERVIEW_TYPES = ['technical', 'behavioral', 'system-design'] as const

/** The Claude models an interview may run on. Mirrors the API's allowlist. */
export const LLM_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const

export type JobTitle = (typeof JOB_TITLES)[number]
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]
export type InterviewType = (typeof INTERVIEW_TYPES)[number]
export type LlmModel = (typeof LLM_MODELS)[number]

/** What the setup form starts on, and what the API falls back to. */
export const DEFAULT_LLM_MODEL: LlmModel = 'claude-sonnet-5'

/** A grade is a whole number from 0 to 100. */
export type Grade = number

export interface InterviewConfig {
  jobTitle: JobTitle
  level: ExperienceLevel
  type: InterviewType
  /** Optional pasted job description used to tailor questions. */
  jobDescription?: string
  /** How many base questions to ask (follow-ups do not count toward this). */
  questionCount: number
  /**
   * Which Claude model writes the questions and grades the answers.
   * Only the HTTP source acts on it; the mock has no LLM to point at.
   */
  model?: LlmModel
}

export interface Question {
  id: string
  text: string
  topic: string
  isFollowUp: boolean
  /** Set when isFollowUp is true: the question this drills into. */
  parentId?: string
  /** Concepts a strong answer is expected to touch. Drives the mock grader. */
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
  /** The source asks for a follow-up when the answer left an obvious gap. */
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
 * One row of the reports history list. Deliberately not an `InterviewSession`: it
 * carries no `asked`/`answers`/`evaluations`, only enough to label a row and link to
 * its detail. `overallGrade` always equals the grade that interview's `Report` shows.
 */
export interface InterviewSummary {
  id: string
  config: InterviewConfig
  createdAt: string
  overallGrade: Grade
}

/**
 * Full session snapshot. The store owns it; sources read it and stay stateless
 * so Stage 2 can swap a mock for HTTP without touching the store or the UI.
 */
export interface InterviewSession {
  id: string
  config: InterviewConfig
  createdAt: string
  /** Every question delivered so far, base and follow-up, in order. */
  asked: Question[]
  answers: Answer[]
  evaluations: Evaluation[]
}
