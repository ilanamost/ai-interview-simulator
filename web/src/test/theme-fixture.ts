import { vi } from 'vitest'

/**
 * jsdom does not implement `matchMedia`, and the theme store asks the browser for the
 * system color scheme whenever the document carries no explicit choice — so anything
 * that mounts the app header needs this first, or it throws `matchMedia is not a
 * function`. Only `matches` is read; the listener pair is there so the result is
 * `MediaQueryList`-shaped rather than a bare `{ matches }`.
 */
export function stubMatchMedia(prefersDark = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  })
}

/**
 * Clears the applied theme, putting the document back in the "no explicit choice yet"
 * state the app boots into. `document.documentElement` outlives a test, so a spec that
 * toggles the theme has to reset it or it leaks into the next one.
 */
export function clearAppliedTheme() {
  delete document.documentElement.dataset.theme
}
