import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewConfig } from '@/types/interview'

function makeConfig(): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 }
}

describe('interviewSource selection', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uses the mock source (no network calls) when VITE_INTERVIEW_SOURCE is unset', async () => {
    vi.stubEnv('VITE_INTERVIEW_SOURCE', '')
    const { interviewSource } = await import('./interview.service')

    await interviewSource.startInterview(makeConfig())

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the http source (network calls) when VITE_INTERVIEW_SOURCE=http', async () => {
    vi.stubEnv('VITE_INTERVIEW_SOURCE', 'http')
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 's1',
        config: makeConfig(),
        createdAt: '2026-07-26T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      })
    })
    const { interviewSource } = await import('./interview.service')

    await interviewSource.startInterview(makeConfig())

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/interview',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
