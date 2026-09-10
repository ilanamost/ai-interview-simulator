import { beforeEach, describe, expect, it } from 'vitest'
import { clearSnapshot, loadSnapshot, saveSnapshot } from './session-storage.service'
import type { InterviewConfig, InterviewSession, Report } from '@/types/interview'

const STORAGE_KEY = 'interview-session-v1'

function makeConfig(): InterviewConfig {
  return { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 2 }
}

function makeSession(): InterviewSession {
  return {
    id: 'session-1',
    config: makeConfig(),
    createdAt: '2026-07-28T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: []
  }
}

function makeReport(): Report {
  return { overallGrade: 80, headline: 'Headline', strengths: [], improvements: [], entries: [] }
}

describe('session-storage.service', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing has been saved', () => {
    expect(loadSnapshot()).toBeNull()
  })

  it('round-trips a saved snapshot', () => {
    saveSnapshot({ source: 'mock', session: makeSession(), report: null })

    const loaded = loadSnapshot()

    expect(loaded?.source).toBe('mock')
    expect(loaded?.session).toEqual(makeSession())
    expect(loaded?.report).toBeNull()
    expect(loaded?.version).toBe(1)
  })

  it('persists a completed session with its report', () => {
    saveSnapshot({ source: 'http', session: makeSession(), report: makeReport() })

    const loaded = loadSnapshot()

    expect(loaded?.report).toEqual(makeReport())
  })

  it('clears the saved snapshot', () => {
    saveSnapshot({ source: 'mock', session: makeSession(), report: null })

    clearSnapshot()

    expect(loadSnapshot()).toBeNull()
  })

  it('ignores a snapshot from a newer/older schema version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 999, source: 'mock', session: makeSession(), report: null, savedAt: new Date().toISOString() })
    )

    expect(loadSnapshot()).toBeNull()
  })

  it('ignores corrupted JSON instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')

    expect(loadSnapshot()).toBeNull()
  })

  it('ignores an expired snapshot', () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, source: 'mock', session: makeSession(), report: null, savedAt: staleDate })
    )

    expect(loadSnapshot()).toBeNull()
  })

  it('keeps a snapshot saved just under the expiry window', () => {
    const recentDate = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, source: 'mock', session: makeSession(), report: null, savedAt: recentDate })
    )

    expect(loadSnapshot()).not.toBeNull()
  })
})
