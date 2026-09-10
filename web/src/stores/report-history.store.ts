import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { InterviewSummary } from '@/types/interview'
import { InterviewError } from '@/services/interview.service'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_REPORT_SORT,
  reportHistorySource,
  type ReportHistoryDetail,
  type ReportHistoryFilters,
  type ReportHistorySort,
  type ReportHistorySource
} from '@/services/report-history.service'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Ordering is part of the request now that a page is a slice of the server's own
 * ordering, so the four values live beside the contract in `report-history.service.ts`.
 * Re-exported here because the screen reads them from the store it already imports.
 */
export {
  DEFAULT_REPORT_SORT,
  REPORT_SORTS,
  type ReportHistorySort
} from '@/services/report-history.service'

/**
 * `loading` — a list or detail read is in flight
 * `ready`   — whatever was asked for has settled, found or not
 */
export type ReportHistoryStatus = 'idle' | 'loading' | 'ready'

/** The store's initial rows-per-page, before the user ever touches the selector. */
export const PAGE_SIZE = DEFAULT_PAGE_SIZE

/** Offered by the page-size selector. All within the API's `[1, MAX_PAGE_SIZE]` bound. */
export const PAGE_SIZE_OPTIONS = [2, 5, 10, 20, 50] as const

function toUserMessage(err: unknown): string {
  if (err instanceof InterviewError) return err.message
  return 'Could not load your reports. Please try again.'
}

/** Same reasoning as `interview.store.ts`: a session that died must not look alive. */
function signOutIfSessionExpired(err: unknown) {
  if (err instanceof InterviewError && err.code === 'UNAUTHENTICATED') useAuthStore().expire()
}

export const useReportHistoryStore = defineStore('report-history', () => {
  // Swappable so tests can inject a stub rather than mocking the module.
  const source = ref<ReportHistorySource>(reportHistorySource)

  const list = ref<InterviewSummary[]>([])
  const filters = ref<ReportHistoryFilters>({})
  /**
   * Deliberately NOT part of `filters`: `hasFilters` is
   * `Object.values(filters).some(Boolean)`, and sort always has a value — folding it in
   * would pin `hasFilters` to `true` forever, so "Clear filters" could never hide and a
   * brand-new user with no interviews would be told their filters matched nothing.
   */
  const sort = ref<ReportHistorySort>(DEFAULT_REPORT_SORT)
  /** 1-based, matching the `page` the API takes — no off-by-one translation anywhere. */
  const page = ref(1)
  /** How many rows one page holds. Sent on every read; the user can change it. */
  const pageSize = ref(PAGE_SIZE)
  /** Every row matching the filters, not just the ones on this page. */
  const total = ref(0)
  const detail = ref<ReportHistoryDetail | null>(null)
  const status = ref<ReportHistoryStatus>('idle')
  const error = ref<string | null>(null)

  /**
   * Which read the screen is currently waiting on. Reads overlap in ordinary use —
   * `ReportsHistoryView` fires one per filter change with no debounce — and nothing
   * makes the network answer in the order it was asked. Without this, whichever call
   * settled LAST would win, so flicking a select could leave the form reading
   * "backend" while the rows on screen are the frontend ones. Every read captures the
   * token it was issued under and only writes if it is still the current one.
   */
  let requestToken = 0

  function nextToken(): number {
    return ++requestToken
  }

  /** A response nobody is waiting for any more: drop it, and leave state to its successor. */
  function isStale(token: number): boolean {
    return token !== requestToken
  }

  const isBusy = computed(() => status.value === 'loading')
  /** Only meaningful once a detail read has settled — `idle`/`loading` are not "missing". */
  const isDetailMissing = computed(() => status.value === 'ready' && detail.value === null)
  const hasFilters = computed(() => Object.values(filters.value).some(Boolean))

  /** At least one page always exists, so an empty history still reads "Page 1 of 1". */
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  function setSource(next: ReportHistorySource) {
    source.value = next
  }

  function reset() {
    // Bump the token too, or a read still in flight would repopulate what was just cleared.
    nextToken()
    list.value = []
    filters.value = {}
    // A fresh visit must not carry a previous session's ordering.
    sort.value = DEFAULT_REPORT_SORT
    page.value = 1
    pageSize.value = PAGE_SIZE
    total.value = 0
    detail.value = null
    status.value = 'idle'
    error.value = null
  }

  /**
   * Reads the current page under the current filters and ordering. Throws on failure with
   * `error` already set, so the view decides how to surface it — the UI owns toasts here.
   */
  async function load() {
    const token = nextToken()

    status.value = 'loading'
    error.value = null

    try {
      const result = await source.value.list({
        ...filters.value,
        sort: sort.value,
        page: page.value,
        pageSize: pageSize.value
      })
      if (isStale(token)) return

      list.value = result.items
      total.value = result.total
      status.value = 'ready'
    } catch (err) {
      // A read the user has already moved on from: its failure is not their problem,
      // so it neither reports an error nor lets the caller toast one.
      if (isStale(token)) return

      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      status.value = 'ready'
      // The previous rows are gone rather than stale: they no longer answer this filter,
      // and a leftover `total` would render a pager for rows nobody can see.
      list.value = []
      total.value = 0
      throw err
    }
  }

  /**
   * Applies a new set of filters and reads their first page. Always page 1: a page number
   * carried over from a wider result set would render an empty page instead of rows.
   */
  function fetchList(next: ReportHistoryFilters = {}) {
    filters.value = { ...next }
    page.value = 1

    return load()
  }

  /**
   * Ordering is a server concern now — a page is a slice of the server's own ordering, so
   * re-ordering means asking for page 1 of the new one rather than shuffling rows in place.
   */
  function setSort(next: ReportHistorySort) {
    sort.value = next
    page.value = 1

    return load()
  }

  /**
   * Changes how many rows one page holds. Also a server concern, and for the same
   * reason as `setSort`: a bigger or smaller page is a different first page, not the
   * same rows regrouped, so this re-reads rather than re-slicing what's already held.
   */
  function setPageSize(next: number) {
    pageSize.value = next
    page.value = 1

    return load()
  }

  /** Moves to another page of the same query, clamped to the pages that actually exist. */
  function setPage(next: number) {
    const wanted = Number.isFinite(next) ? Math.floor(next) : 1
    page.value = Math.min(Math.max(wanted, 1), pageCount.value)

    return load()
  }

  /** Loads one past interview. A `null` detail is "no such report", not a failure. */
  async function fetchDetail(id: string) {
    const token = nextToken()

    status.value = 'loading'
    error.value = null
    detail.value = null

    try {
      const found = await source.value.getDetail(id)
      if (isStale(token)) return

      detail.value = found
      status.value = 'ready'
    } catch (err) {
      if (isStale(token)) return

      signOutIfSessionExpired(err)
      error.value = toUserMessage(err)
      status.value = 'ready'
      throw err
    }
  }

  return {
    list,
    filters,
    sort,
    page,
    pageSize,
    total,
    detail,
    status,
    error,
    isBusy,
    isDetailMissing,
    hasFilters,
    pageCount,
    setSource,
    setSort,
    setPageSize,
    setPage,
    reset,
    fetchList,
    fetchDetail
  }
})
