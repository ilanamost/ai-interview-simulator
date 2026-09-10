import type { Evaluation, InterviewSession, Question, Report } from '@/types/interview'
import { InterviewError, type InterviewSource } from './interview.service'
import { refreshSession } from './auth.service'

/** LLM-backed calls can run several seconds; fail loud rather than hang forever. */
const TIMEOUT_MS = 30000

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // `/api/interview` requires auth as of plan 007, and the access token rides in an
    // HttpOnly cookie: without `credentials: 'include'` every interview call 401s.
    return await fetch(url, { ...init, credentials: 'include', signal: controller.signal })
  } catch {
    throw new InterviewError(
      'NETWORK_ERROR',
      'Could not reach the interview service. Check your connection and try again.'
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function toError(response: Response): Promise<InterviewError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  return new InterviewError(
    body?.error?.code ?? 'UNKNOWN_ERROR',
    body?.error?.message ?? 'Something failed while running the interview. Please try again.'
  )
}

/**
 * One guarded call, with the same refresh-and-retry `auth.service.ts` uses.
 *
 * A single interview question routinely takes longer to think through than the
 * ~15-minute access-token TTL, so submitting an answer meeting an expired token is
 * ordinary use, not an edge case. Rotate once and replay the call so the user never
 * notices; a second failure means the session is really over and the
 * `UNAUTHENTICATED` code reaches the store, which signs the user out.
 *
 * Only `UNAUTHENTICATED` is retried. Every other failure — a 404, a 409 on an
 * already-answered question, a 500 — is the server's real answer and must not burn
 * a refresh.
 *
 * Exported so every source that talks to `/api/interview*` — the interview source
 * here and `report-history.service.ts` — shares one credentials/refresh/error-mapping
 * path rather than growing a second, subtly different copy of it.
 */
export async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`

  let response = await send(url, init)

  if (response.status === 401) {
    const error = await toError(response)
    if (error.code !== 'UNAUTHENTICATED') throw error
    if (!(await refreshSession(baseUrl))) throw error

    response = await send(url, init)
  }

  if (!response.ok) throw await toError(response)

  return response.json() as Promise<T>
}

function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return request<T>(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/**
 * Fetches the full saved session for reload-resume, independent of `InterviewSource`.
 * Not part of that contract: the mock has no server copy to re-fetch, so only the
 * `http` rehydration path calls this. Returns `null` if the interview no longer exists.
 */
export async function fetchInterviewSession(
  baseUrl: string,
  id: string
): Promise<InterviewSession | null> {
  try {
    return await request<InterviewSession>(baseUrl, `/api/interview/${id}`)
  } catch (err) {
    if (err instanceof InterviewError && err.code === 'NOT_FOUND') return null
    throw err
  }
}

/** Stage 2 source: talks to the real `api/` backend behind the same contract the mock satisfies. */
export function createHttpInterviewSource(baseUrl: string): InterviewSource {
  const interviewPath = (id: string) => `/api/interview/${id}`

  return {
    async startInterview(config) {
      return postJson<InterviewSession>(baseUrl, '/api/interview', config)
    },

    async getNextQuestion(session) {
      const { question } = await request<{ question: Question | null }>(
        baseUrl,
        `${interviewPath(session.id)}/question`
      )
      return question
    },

    async evaluateAnswer(session, question, answer) {
      const { evaluation } = await postJson<{ evaluation: Evaluation }>(
        baseUrl,
        `${interviewPath(session.id)}/answer`,
        { questionId: question.id, text: answer.text }
      )
      return evaluation
    },

    async getReport(session) {
      return request<Report>(baseUrl, `${interviewPath(session.id)}/report`)
    }
  }
}
