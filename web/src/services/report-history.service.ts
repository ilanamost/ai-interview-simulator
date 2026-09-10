import type {
  ExperienceLevel,
  InterviewSession,
  InterviewSummary,
  InterviewType,
  JobTitle,
  Report
} from '@/types/interview'
import { env } from '@/config/env'
import { InterviewError } from './interview.service'
import { request } from './interview-http.service'

/** Every filter is optional and they combine with AND, matching `GET /api/interview`. */
export interface ReportHistoryFilters {
  /** A single calendar day, `YYYY-MM-DD`, matched against `createdAt`'s UTC day. */
  date?: string
  jobTitle?: JobTitle
  level?: ExperienceLevel
  type?: InterviewType
}

/** In the order the select offers them. Paired with its union the way `JOB_TITLES` is. */
export const REPORT_SORTS = ['date-desc', 'date-asc', 'grade-desc', 'grade-asc'] as const

export type ReportHistorySort = (typeof REPORT_SORTS)[number]

/** What both sources answer with when no ordering is asked for. */
export const DEFAULT_REPORT_SORT: ReportHistorySort = 'date-desc'

/** Rows per page. The value the frontend asks for; the API defaults to the same 10. */
export const DEFAULT_PAGE_SIZE = 10

/** The API clamps to this too, so no caller can force an unbounded query. */
export const MAX_PAGE_SIZE = 50

/**
 * One page of history. Ordering and slicing are the source's job, not the caller's:
 * sorting a page independently of the full ordering would put the wrong rows on it.
 */
export interface ReportHistoryQuery extends ReportHistoryFilters {
  sort?: ReportHistorySort
  /** 1-based, defaulting to the first page. */
  page?: number
  /** Defaults to `DEFAULT_PAGE_SIZE`, clamped to `[1, MAX_PAGE_SIZE]`. */
  pageSize?: number
}

/** `total` counts every row matching the filters, not just the ones on this page. */
export interface ReportHistoryPage {
  items: InterviewSummary[]
  total: number
}

/** Everything the detail screen needs to render one past interview. */
export interface ReportHistoryDetail {
  session: InterviewSession
  report: Report
}

/**
 * The contract every source of past interviews must satisfy, mirroring
 * `InterviewSource`: the http implementation talks to `api/`, the mock reads its own
 * `localStorage` history, and neither the store nor the UI can tell them apart.
 *
 * Sources are stateless with respect to the caller — the store owns what it renders.
 */
export interface ReportHistorySource {
  /** One ordered page of matching summaries. An empty page is a successful "nothing yet". */
  list(query?: ReportHistoryQuery): Promise<ReportHistoryPage>
  /** The full session + report for one past interview, or `null` if there is no such interview. */
  getDetail(id: string): Promise<ReportHistoryDetail | null>
  /** Remembers a just-finished interview. A no-op wherever the server already has it. */
  record(session: InterviewSession, report: Report): void
}

/*
 * Mock-mode history.
 *
 * A separate key from `session-storage.service.ts`'s single resumable snapshot on
 * purpose: different shape (an array of finished interviews, not one in-flight
 * session), different lifecycle (kept until the cap evicts it, not expired after 24h).
 * Conflating the two would make finishing an interview destroy the history.
 */

/** Bump when `HistoryEntry`'s shape changes so old entries are ignored, not crashed on. */
const HISTORY_VERSION = 1
const HISTORY_STORAGE_KEY = 'interview-history-v1'

/** Same bounded-growth reasoning as the snapshot's 24h expiry: storage must not grow forever. */
export const MAX_HISTORY_ENTRIES = 50

interface HistoryEntry {
  session: InterviewSession
  report: Report
  savedAt: string
}

interface HistoryFile {
  version: number
  entries: HistoryEntry[]
}

/** Reading history is best-effort: a corrupt or unavailable store reads as "no history". */
export function loadHistoryEntries(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as Partial<HistoryFile>
    if (parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.entries)) return []

    return parsed.entries.filter(entry => entry?.session?.id && entry.report)
  } catch {
    return []
  }
}

function saveHistoryEntries(entries: HistoryEntry[]): void {
  try {
    const payload: HistoryFile = {
      version: HISTORY_VERSION,
      // Oldest dropped first: the tail is the most recent, and the most worth keeping.
      entries: entries.slice(-MAX_HISTORY_ENTRIES)
    }
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded or storage disabled (e.g. private browsing) — nothing to do.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY)
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/** The UTC calendar day of an ISO timestamp — the same day the API filters on. */
function utcDay(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10)
}

function toSummary(entry: HistoryEntry): InterviewSummary {
  return {
    id: entry.session.id,
    config: entry.session.config,
    createdAt: entry.session.createdAt,
    overallGrade: entry.report.overallGrade
  }
}

function matchesFilters(entry: HistoryEntry, filters: ReportHistoryFilters): boolean {
  const { config, createdAt } = entry.session

  if (filters.date && utcDay(createdAt) !== filters.date) return false
  if (filters.jobTitle && config.jobTitle !== filters.jobTitle) return false
  if (filters.level && config.level !== filters.level) return false
  if (filters.type && config.type !== filters.type) return false

  return true
}

/**
 * ISO-8601 sorts lexicographically — no `Date` parsing, and no timezone to get wrong.
 */
function byNewest(a: InterviewSummary, b: InterviewSummary): number {
  return b.createdAt.localeCompare(a.createdAt)
}

/**
 * The four orderings the API's `sort` parameter names, mirrored here so mock mode puts
 * the same rows on the same page. `overallGrade` is a small integer, so ties are common:
 * both grade orderings break them by date, newest first, exactly as the SQL does.
 */
const COMPARE: Record<ReportHistorySort, (a: InterviewSummary, b: InterviewSummary) => number> = {
  'date-desc': byNewest,
  'date-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
  'grade-desc': (a, b) => b.overallGrade - a.overallGrade || byNewest(a, b),
  'grade-asc': (a, b) => a.overallGrade - b.overallGrade || byNewest(a, b)
}

/**
 * The API rejects an out-of-range `pageSize` with a 400; a mock has no such answer to
 * give, so it clamps to the same bounds instead. Either way no caller can page in
 * chunks the other mode would refuse, and neither can force an unbounded read.
 */
function resolvePageSize(pageSize?: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize as number)))
}

function resolvePage(page?: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.max(1, Math.floor(page as number))
}

/** Stage 1 source: the browser is the only server there is, so it holds the whole entry. */
export function createMockReportHistorySource(): ReportHistorySource {
  return {
    async list(query = {}) {
      const { sort, page, pageSize, ...filters } = query

      const matching = loadHistoryEntries()
        .filter(entry => matchesFilters(entry, filters))
        .map(toSummary)
        .sort(COMPARE[sort ?? DEFAULT_REPORT_SORT])

      // Sliced only after ordering the whole matching set: a page ordered on its own
      // would show a different row per page than the API's ORDER BY ... LIMIT does.
      const size = resolvePageSize(pageSize)
      const start = (resolvePage(page) - 1) * size

      return { items: matching.slice(start, start + size), total: matching.length }
    },

    async getDetail(id) {
      const entry = loadHistoryEntries().find(item => item.session.id === id)
      if (!entry) return null

      return { session: entry.session, report: entry.report }
    },

    record(session, report) {
      // Re-recording the same interview replaces it rather than duplicating the row.
      const kept = loadHistoryEntries().filter(entry => entry.session.id !== session.id)

      saveHistoryEntries([
        ...kept,
        // Structured-cloned so a later mutation of the live session cannot rewrite history.
        JSON.parse(JSON.stringify({ session, report, savedAt: new Date().toISOString() }))
      ])
    }
  }
}

/** Stage 2 source: the real `api/` backend, behind the same contract the mock satisfies. */
export function createHttpReportHistorySource(baseUrl: string): ReportHistorySource {
  return {
    async list(query = {}) {
      const { sort, page, pageSize, ...filters } = query
      const params = new URLSearchParams()

      // Only ever send a filter that has a value: `?jobTitle=` is a 400, not "no filter".
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value)
      }

      // Paging follows the same rule — an omitted one takes the server's own default.
      if (sort) params.set('sort', sort)
      if (page !== undefined) params.set('page', String(page))
      if (pageSize !== undefined) params.set('pageSize', String(pageSize))

      const search = params.toString()
      const { interviews, total } = await request<{
        interviews: InterviewSummary[]
        total: number
      }>(baseUrl, `/api/interview${search ? `?${search}` : ''}`)

      return { items: interviews, total }
    },

    async getDetail(id) {
      try {
        // No dedicated detail endpoint exists, or is needed: the session and its report
        // are already two separate reads, and the list guarantees both exist.
        const [session, report] = await Promise.all([
          request<InterviewSession>(baseUrl, `/api/interview/${id}`),
          request<Report>(baseUrl, `/api/interview/${id}/report`)
        ])
        return { session, report }
      } catch (err) {
        // A stale link, another org's id, or an interview with nothing evaluated yet —
        // all "there is no report at this address", which the view shows as not found.
        if (err instanceof InterviewError && (err.code === 'NOT_FOUND' || err.code === 'NO_EVALUATION')) {
          return null
        }
        throw err
      }
    },

    record() {
      // The server persisted the interview as it was answered — nothing to duplicate here.
    }
  }
}

/** `VITE_INTERVIEW_SOURCE` picks the live source; unset or `mock` keeps the offline demo. */
function createReportHistorySource(): ReportHistorySource {
  if (env.interviewSource === 'http') return createHttpReportHistorySource(env.apiBaseUrl)
  return createMockReportHistorySource()
}

export const reportHistorySource: ReportHistorySource = createReportHistorySource()

/**
 * Called by `interview.store.ts` the moment an interview produces a report, so it shows
 * up under `/reports`. Deliberately synchronous and silent: history is a nicety, and a
 * storage failure must never break the report the user is already looking at.
 */
export function recordCompletedInterview(session: InterviewSession, report: Report): void {
  reportHistorySource.record(session, report)
}
