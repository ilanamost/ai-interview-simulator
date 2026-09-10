import type { ExperienceLevel, InterviewType, JobTitle, LlmModel } from '@/types/interview'
// Type-only, so nothing of the store is pulled into this module at runtime.
import type { ReportHistorySort } from '@/stores/report-history.store'

/** Display names for the enum values. Kept apart from the types so the UI owns the wording. */

export const JOB_TITLE_LABEL: Record<JobTitle, string> = {
  frontend: 'Frontend Developer',
  backend: 'Backend Developer',
  fullstack: 'Fullstack Developer',
  devops: 'DevOps Engineer',
  data: 'Data Engineer'
}

export const EXPERIENCE_LEVEL_LABEL: Record<ExperienceLevel, string> = {
  junior: 'Junior (0–2 years)',
  mid: 'Mid-level (2–5 years)',
  senior: 'Senior (5+ years)'
}

export const INTERVIEW_TYPE_LABEL: Record<InterviewType, string> = {
  technical: 'Technical',
  behavioral: 'Behavioral',
  'system-design': 'System Design'
}

/** Each ordering named in plain words, so the control needs no direction toggle or icon. */
export const REPORT_SORT_LABEL: Record<ReportHistorySort, string> = {
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
  'grade-desc': 'Highest grade first',
  'grade-asc': 'Lowest grade first'
}

/** Ordered strongest to fastest, so the select reads as a quality/cost scale. */
export const LLM_MODEL_LABEL: Record<LlmModel, string> = {
  'claude-opus-5': 'Opus 5 — most capable',
  'claude-sonnet-5': 'Sonnet 5 — balanced',
  'claude-haiku-4-5': 'Haiku 4.5 — fastest'
}
