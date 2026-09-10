/**
 * The color scheme is a device preference, not account data, so it lives in
 * `localStorage` rather than behind the API. Only the mechanics live here — reading
 * and writing the choice, and asking the browser what the OS wants. Deciding which
 * one wins, and applying it, is `stores/theme.store.ts`'s job.
 */
export type Theme = 'light' | 'dark'

/** Also read by the inline pre-paint script in `web/index.html` — keep both in sync. */
const STORAGE_KEY = 'theme-preference'

/**
 * `null` means the visitor has never picked a side, which is not the same as picking
 * light: it is what keeps the app following the system preference.
 */
export function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

/** Persistence is a nicety — a storage failure still leaves the page correctly themed. */
export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Quota exceeded or storage disabled (e.g. private browsing) — nothing to do.
  }
}

/** What the OS/browser asks for, used only when there is no explicit choice to honor. */
export function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
