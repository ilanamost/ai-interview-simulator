import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { useThemeStore } from './theme.store'
import { getStoredTheme } from '@/services/theme.service'
import { clearAppliedTheme, stubMatchMedia } from '@/test/theme-fixture'
import App from '@/App.vue'
import { createAppRouter } from '@/router'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

function makeStore() {
  setActivePinia(createPinia())
  return useThemeStore()
}

beforeEach(() => {
  localStorage.clear()
  clearAppliedTheme()
  stubMatchMedia()
})

/**
 * QA adversarial pass for plan 011. The happy paths are covered in
 * `theme.store.spec.ts` and `App.spec.ts`; this file only tries to break the feature.
 */
describe('theme toggle — adversarial', () => {
  /**
   * Proves the `stubMatchMedia()` fixture the frontend agent added to four existing
   * view specs is load-bearing rather than defensive scaffolding: the store reaches
   * `matchMedia` on every construction where no theme has been applied, and jsdom has
   * no `matchMedia`. If this test ever stops throwing, those four stubs can go.
   */
  it('genuinely needs a matchMedia stub — the store throws without one', () => {
    // @ts-expect-error — removing the API jsdom never implemented in the first place.
    delete window.matchMedia

    expect(() => makeStore()).toThrow(/matchMedia is not a function/)
  })

  /** The pre-paint script's attribute short-circuits the fallback, so no stub is needed. */
  it('does not reach matchMedia at all when the pre-paint script already applied a theme', () => {
    document.documentElement.dataset.theme = 'dark'
    // @ts-expect-error — proves the attribute branch never touches this API.
    delete window.matchMedia

    const store = makeStore()

    expect(store.theme).toBe('dark')
  })

  describe('hostile stored values', () => {
    /** The inline script and `getStoredTheme` both allowlist; neither parses. */
    const junk = [
      'DARK',
      'Light',
      ' dark ',
      'dark;light',
      '{"theme":"dark"}',
      'null',
      'undefined',
      '<script>alert(1)</script>',
      'x'.repeat(50_000)
    ]

    it.each(junk)('never turns %# into a theme', value => {
      localStorage.setItem('theme-preference', value)

      expect(getStoredTheme()).toBeNull()
    })

    /**
     * A junk value must not strand the store either — it falls through to the system
     * preference, which is the same thing "nothing stored" does.
     */
    it('boots on the system preference when storage holds junk', () => {
      localStorage.setItem('theme-preference', 'sepia')
      stubMatchMedia(true)

      const store = makeStore()

      expect(store.theme).toBe('dark')
    })
  })

  describe('rapid repeated toggling', () => {
    /**
     * `toggleTheme` is synchronous, so a fast double-click must not desync the three
     * things it writes: the ref, `localStorage`, and the DOM attribute.
     */
    it('keeps store, storage, and document in agreement after 21 clicks', () => {
      const store = makeStore()

      for (let i = 0; i < 21; i++) store.toggleTheme()

      // Odd count from light: dark.
      expect(store.theme).toBe('dark')
      expect(getStoredTheme()).toBe('dark')
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    /**
     * Plan 011 Scope: this is a two-state switch, not a "system / light / dark"
     * selector. No click path may ever land back on "no attribute", or the app would
     * silently resume following the OS.
     */
    it('always lands on an explicit theme — never clears the attribute', () => {
      const store = makeStore()

      for (let i = 0; i < 12; i++) {
        store.toggleTheme()

        expect(document.documentElement.dataset.theme).toMatch(/^(light|dark)$/)
        expect(document.documentElement.hasAttribute('data-theme')).toBe(true)
        expect(getStoredTheme()).toBe(store.theme)
      }
    })

    /** Same guarantee starting from a system-dark visitor who has stored nothing. */
    it('lands on an explicit theme from a system-dark start too', () => {
      stubMatchMedia(true)
      const store = makeStore()

      store.toggleTheme()

      expect(document.documentElement.dataset.theme).toBe('light')

      store.toggleTheme()

      expect(document.documentElement.dataset.theme).toBe('dark')
    })
  })

  /**
   * Plan 011, Assumptions ("Toggle target, not tri-state control") specifies flipping
   * from whatever is *currently rendered*, "checking matchMedia **at click time** when
   * nothing is stored yet". The construction-time sample and the click-time truth only
   * diverge while nothing is stored and the OS scheme changes after load: the media
   * query has already re-colored the page, but the ref still holds the boot value.
   *
   * `toggleTheme()` therefore re-reads its baseline instead of flipping `theme.value`.
   * Regression guard for QA finding F1 — before the fix this produced 'light', the
   * theme already on screen, i.e. a click that visibly did nothing.
   */
  it('flips from the live theme, not the one sampled at construction', () => {
    stubMatchMedia(true) // Page loads on a dark OS, nothing stored.
    const store = makeStore()
    expect(store.theme).toBe('dark')

    stubMatchMedia(false) // User flips the OS to light; CSS re-colors the page.

    store.toggleTheme()

    // The page renders light, so the click has to move somewhere else: dark.
    expect(store.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(getStoredTheme()).toBe('dark')
  })

  /** The mirror case: booted light, OS went dark, so a click has to produce light. */
  it('flips from the live theme when the OS turns dark after load', () => {
    const store = makeStore()
    expect(store.theme).toBe('light')

    stubMatchMedia(true)

    store.toggleTheme()

    expect(store.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  /**
   * The re-read must not reintroduce system-following once a choice exists: after the
   * first click the attribute is the baseline, so a later OS change is ignored.
   *
   * Note this sequence ends with the OS and the stored choice *agreeing* (both dark),
   * so it cannot tell a correct re-read apart from one that skipped the attribute and
   * asked the system — both answer 'light'. The test below covers that; this one stays
   * as the plain end-to-end walk through the explicit-choice path.
   */
  it('ignores a later OS change once an explicit choice has been applied', () => {
    const store = makeStore()

    store.toggleTheme()
    expect(store.theme).toBe('dark')

    stubMatchMedia(true) // OS goes dark; the explicit 'dark' choice is unaffected.

    store.toggleTheme()

    expect(store.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  /**
   * The discriminating version of the guard above: the stored choice (dark) and the OS
   * (light) deliberately *disagree*, so the two readings give different answers. A
   * baseline that consulted `getSystemTheme()` instead of the applied attribute would
   * read 'light' and flip back to 'dark' — pinning the app on one theme and quietly
   * resuming system-following. Only reading the attribute yields 'light' here.
   */
  it('reads the attribute, not the system, when the two disagree', () => {
    stubMatchMedia(false) // OS is light and stays light for the whole test.
    const store = makeStore()

    store.toggleTheme() // Explicit dark, against a light OS.

    expect(document.documentElement.dataset.theme).toBe('dark')

    store.toggleTheme()

    expect(store.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(getStoredTheme()).toBe('light')
  })

  /**
   * `App.spec.ts` asserts the button *exists* on `/login`. This asserts it actually
   * works there — a signed-out visitor's click has to re-color and persist, not just
   * render a decorative control.
   */
  it('is functional, not just present, for a signed-out visitor on /login', async () => {
    const router = createAppRouter(createMemoryHistory())
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })

    router.push('/login')
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')

    await wrapper.get('.theme-toggle').trigger('click')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(getStoredTheme()).toBe('dark')
    expect(wrapper.get('.theme-toggle').attributes('aria-label')).toBe('Switch to light mode')

    // Still signed out — the toggle must not have tripped any auth path.
    expect(wrapper.find('.avatar').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })
})
