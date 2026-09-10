import type { InterviewSession, Report } from '@/types/interview'
import type { InterviewSourceKind } from '@/config/env'

/** Bump when `InterviewSnapshot`'s shape changes so old entries are ignored, not crashed on. */
const SNAPSHOT_VERSION = 1
const STORAGE_KEY = 'interview-session-v1'

/** Abandoned sessions stop being resumable after this long, so storage doesn't grow forever. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface InterviewSnapshot {
  version: number
  /** Which source produced this session, so rehydration knows whether to trust it as-is or re-fetch. */
  source: InterviewSourceKind
  session: InterviewSession
  report: Report | null
  savedAt: string
}

/** Persistence is a nicety, never a hard requirement — storage failures degrade silently. */
export function saveSnapshot(snapshot: Omit<InterviewSnapshot, 'version' | 'savedAt'>): void {
  try {
    const payload: InterviewSnapshot = {
      ...snapshot,
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString()
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded or storage disabled (e.g. private browsing) — nothing to do.
  }
}

export function loadSnapshot(): InterviewSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<InterviewSnapshot>
    if (parsed.version !== SNAPSHOT_VERSION || !parsed.session || !parsed.savedAt) return null

    const age = Date.now() - new Date(parsed.savedAt).getTime()
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return null

    return parsed as InterviewSnapshot
  } catch {
    return null
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
