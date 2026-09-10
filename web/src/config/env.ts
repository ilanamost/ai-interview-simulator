export type InterviewSourceKind = 'mock' | 'http'

export interface AppEnv {
  interviewSource: InterviewSourceKind
  apiBaseUrl: string
}

function readInterviewSource(raw: string | undefined): InterviewSourceKind {
  return raw === 'http' ? 'http' : 'mock'
}

export const env: AppEnv = {
  interviewSource: readInterviewSource(import.meta.env.VITE_INTERVIEW_SOURCE),
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
}
