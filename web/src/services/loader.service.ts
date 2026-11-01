import { getActivePinia } from 'pinia'
import { useLoaderStore } from '@/stores/loader.store'

/** Calls that settle faster than this never show the overlay, so quick ones do not flash. */
export const LOADER_GRACE_MS = 150

/**
 * Counts `request` as in flight on the global loader until it settles — success or
 * failure. The decrement lives in `finally`, so a rejected, timed-out, or aborted call
 * can never leave the overlay stuck on screen.
 *
 * The two `fetch` wrappers (`auth.service.ts`, `interview-http.service.ts`) are the
 * only callers: every API call goes through one of them, so wrapping them is what makes
 * "every call" true without touching a single call site.
 *
 * Without an active Pinia there is no loader to drive, so the request runs untracked.
 * The app installs Pinia before its first call (`main.ts`); this only matters for unit
 * tests that exercise a fetch wrapper on its own.
 */
export async function trackRequest<T>(request: Promise<T>): Promise<T> {
  if (!getActivePinia()) return request

  const loader = useLoaderStore()
  loader.start()

  try {
    return await request
  } finally {
    loader.stop()
  }
}
