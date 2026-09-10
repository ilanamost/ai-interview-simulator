import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReportHistoryStore } from './report-history.store'
import { useAuthStore } from './auth.store'
import { InterviewError } from '@/services/interview.service'
import { signIn } from '@/test/auth-fixture'
import type {
  ReportHistoryDetail,
  ReportHistoryPage,
  ReportHistorySource
} from '@/services/report-history.service'
import type { InterviewSummary } from '@/types/interview'

/*
 * QA re-verification of the request-sequencing fix in report-history.store.ts.
 *
 * Written independently of the tests that shipped with the fix: every expectation here
 * is a hardcoded value rather than a snapshot of whatever the store happened to settle
 * on, so a store that dropped BOTH reads (or wrote neither) fails these rather than
 * passing them trivially.
 */

function makeSummary(id: string): InterviewSummary {
  return {
    id,
    config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
    createdAt: '2026-08-14T10:00:00.000Z',
    overallGrade: 80
  }
}

function makeDetail(id: string, grade: number): ReportHistoryDetail {
  return {
    session: {
      id,
      config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
      createdAt: '2026-08-14T10:00:00.000Z',
      asked: [],
      answers: [],
      evaluations: []
    },
    report: { overallGrade: grade, headline: `H${grade}`, strengths: [], improvements: [], entries: [] }
  }
}

/** Hands back the settle/fail levers for each call, in call order. */
function makeDeferredSource() {
  const listCalls: Array<{
    resolve: (rows: InterviewSummary[]) => void
    reject: (err: unknown) => void
  }> = []
  const detailCalls: Array<{
    resolve: (value: ReportHistoryDetail | null) => void
    reject: (err: unknown) => void
  }> = []

  const source: ReportHistorySource = {
    list() {
      return new Promise<ReportHistoryPage>((resolve, reject) =>
        // Every read answers one page, so a resolver takes rows and counts them as the set.
        listCalls.push({ resolve: rows => resolve({ items: rows, total: rows.length }), reject })
      )
    },
    getDetail() {
      return new Promise((resolve, reject) => detailCalls.push({ resolve, reject }))
    },
    record: vi.fn()
  }

  return { source, listCalls, detailCalls }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('overlapping list reads settle on the one the user actually asked for last', () => {
  it('keeps the newer rows when the older read straggles in behind it', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const older = store.fetchList({ jobTitle: 'frontend' })
    const newer = store.fetchList({ jobTitle: 'backend' })

    listCalls[1].resolve([makeSummary('backend-row')])
    await newer
    listCalls[0].resolve([makeSummary('frontend-row')])
    await older

    // Hardcoded, not compared against whatever settled: the straggler is gone and the
    // newer rows are still there.
    expect(store.list.map(item => item.id)).toEqual(['backend-row'])
    expect(store.filters).toEqual({ jobTitle: 'backend' })
    expect(store.status).toBe('ready')
    expect(store.error).toBeNull()
  })

  it('survives three reads resolving in reverse order', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const a = store.fetchList({ jobTitle: 'frontend' })
    const b = store.fetchList({ jobTitle: 'backend' })
    const c = store.fetchList({ jobTitle: 'devops' })

    // Newest answers first, then the two it superseded.
    listCalls[2].resolve([makeSummary('devops-row')])
    listCalls[1].resolve([makeSummary('backend-row')])
    listCalls[0].resolve([makeSummary('frontend-row')])
    await Promise.all([a, b, c])

    expect(store.list.map(item => item.id)).toEqual(['devops-row'])
    expect(store.filters).toEqual({ jobTitle: 'devops' })
  })

  it('does not let an abandoned failure clear the rows the current read just loaded', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const abandoned = store.fetchList({ jobTitle: 'frontend' })
    const current = store.fetchList({ jobTitle: 'backend' })

    listCalls[1].resolve([makeSummary('backend-row')])
    await current
    listCalls[0].reject(new InterviewError('INTERNAL_ERROR', 'Too late.'))

    // Resolves rather than rejecting, so the view has nothing to toast.
    await expect(abandoned).resolves.toBeUndefined()
    expect(store.list.map(item => item.id)).toEqual(['backend-row'])
    expect(store.error).toBeNull()
    expect(store.status).toBe('ready')
    expect(store.isBusy).toBe(false)
  })

  it('still reports a failure normally when it is the current read that fails', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const only = store.fetchList({ jobTitle: 'frontend' })
    listCalls[0].reject(new InterviewError('INTERNAL_ERROR', 'Could not load.'))

    // The guard must not have swallowed real failures along with stale ones.
    await expect(only).rejects.toBeInstanceOf(InterviewError)
    expect(store.error).toBe('Could not load.')
    expect(store.list).toEqual([])
  })

  /** Documents a deliberate consequence: an abandoned 401 no longer expires the session. */
  it('leaves the session alone when it is an abandoned read that reports it expired', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const abandoned = store.fetchList({ jobTitle: 'frontend' })
    const current = store.fetchList({ jobTitle: 'backend' })

    listCalls[1].resolve([makeSummary('backend-row')])
    await current
    listCalls[0].reject(new InterviewError('UNAUTHENTICATED', 'Signed out.'))
    await abandoned

    // The current read succeeded, so the session demonstrably is alive: trusting the
    // straggler over it would sign out a user who is fine.
    expect(auth.isAuthenticated).toBe(true)
  })

  it('still signs the user out when the current read reports the session is gone', async () => {
    signIn()
    const auth = useAuthStore()
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const current = store.fetchList()
    listCalls[0].reject(new InterviewError('UNAUTHENTICATED', 'Signed out.'))

    await expect(current).rejects.toBeInstanceOf(InterviewError)
    expect(auth.isAuthenticated).toBe(false)
  })
})

describe('overlapping detail reads settle on the last one opened', () => {
  it('keeps the newer report when the older one answers late', async () => {
    const store = useReportHistoryStore()
    const { source, detailCalls } = makeDeferredSource()
    store.setSource(source)

    const older = store.fetchDetail('report-a')
    const newer = store.fetchDetail('report-b')

    detailCalls[1].resolve(makeDetail('report-b', 55))
    await newer
    detailCalls[0].resolve(makeDetail('report-a', 99))
    await older

    expect(store.detail?.session.id).toBe('report-b')
    expect(store.detail?.report.overallGrade).toBe(55)
  })

  it('keeps a newer "not found" rather than the older report that lands after it', async () => {
    const store = useReportHistoryStore()
    const { source, detailCalls } = makeDeferredSource()
    store.setSource(source)

    const older = store.fetchDetail('report-a')
    const newer = store.fetchDetail('missing')

    detailCalls[1].resolve(null)
    await newer
    detailCalls[0].resolve(makeDetail('report-a', 99))
    await older

    expect(store.detail).toBeNull()
    expect(store.isDetailMissing).toBe(true)
  })

  it('drops an in-flight list read when the user opens a report instead', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls, detailCalls } = makeDeferredSource()
    store.setSource(source)

    const list = store.fetchList({ jobTitle: 'frontend' })
    const detail = store.fetchDetail('report-a')

    detailCalls[0].resolve(makeDetail('report-a', 70))
    await detail
    listCalls[0].resolve([makeSummary('late-row')])
    await list

    // The list read belonged to a screen the user has left.
    expect(store.list).toEqual([])
    expect(store.detail?.session.id).toBe('report-a')
    expect(store.status).toBe('ready')
  })
})

describe('reset while a read is in flight', () => {
  it('does not let an in-flight list read repopulate what reset cleared', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const inFlight = store.fetchList({ jobTitle: 'frontend' })
    store.reset()
    listCalls[0].resolve([makeSummary('late-row')])
    await inFlight

    expect(store.list).toEqual([])
    expect(store.filters).toEqual({})
    expect(store.status).toBe('idle')
    expect(store.error).toBeNull()
  })

  it('does not let an in-flight detail read repopulate what reset cleared', async () => {
    const store = useReportHistoryStore()
    const { source, detailCalls } = makeDeferredSource()
    store.setSource(source)

    const inFlight = store.fetchDetail('report-a')
    store.reset()
    detailCalls[0].resolve(makeDetail('report-a', 88))
    await inFlight

    expect(store.detail).toBeNull()
    expect(store.status).toBe('idle')
    expect(store.isDetailMissing).toBe(false)
  })

  it('does not let an in-flight read that FAILS report an error after reset', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const inFlight = store.fetchList()
    store.reset()
    listCalls[0].reject(new InterviewError('INTERNAL_ERROR', 'Boom.'))

    await expect(inFlight).resolves.toBeUndefined()
    expect(store.error).toBeNull()
    expect(store.status).toBe('idle')
  })

  /** The token is monotonic, so reset must not poison every later read. */
  it('leaves the store fully usable for the next read after a reset', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    const abandoned = store.fetchList({ jobTitle: 'frontend' })
    store.reset()
    listCalls[0].resolve([makeSummary('late-row')])
    await abandoned

    const fresh = store.fetchList({ jobTitle: 'devops' })
    listCalls[1].resolve([makeSummary('devops-row')])
    await fresh

    expect(store.list.map(item => item.id)).toEqual(['devops-row'])
    expect(store.status).toBe('ready')
  })

  it('survives reset being called repeatedly with nothing in flight', async () => {
    const store = useReportHistoryStore()
    const { source, listCalls } = makeDeferredSource()
    store.setSource(source)

    for (let i = 0; i < 5; i++) store.reset()

    const fresh = store.fetchList()
    listCalls[0].resolve([makeSummary('row')])
    await fresh

    expect(store.list.map(item => item.id)).toEqual(['row'])
  })
})
