import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useThemeStore } from './theme.store'
import { getStoredTheme } from '@/services/theme.service'
import { clearAppliedTheme, stubMatchMedia } from '@/test/theme-fixture'

/** Mirrors what the inline script in `index.html` does before Vue boots. */
function applyThemeAttribute(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme
}

function makeStore() {
  setActivePinia(createPinia())
  return useThemeStore()
}

describe('theme.store', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAppliedTheme()
    stubMatchMedia()
  })

  describe('initial state', () => {
    it('trusts the attribute the pre-paint script already applied', () => {
      applyThemeAttribute('dark')

      const store = makeStore()

      expect(store.theme).toBe('dark')
      expect(store.isDark).toBe(true)
    })

    it('honors an explicit light choice even when the system prefers dark', () => {
      stubMatchMedia(true)
      applyThemeAttribute('light')

      const store = makeStore()

      expect(store.theme).toBe('light')
    })

    it('falls back to the system preference when no choice has been applied', () => {
      stubMatchMedia(true)

      const store = makeStore()

      expect(store.theme).toBe('dark')
    })

    it('reads light from the system when the system does not prefer dark', () => {
      const store = makeStore()

      expect(store.theme).toBe('light')
      expect(store.isDark).toBe(false)
    })

    it('ignores an attribute value that is not a theme', () => {
      document.documentElement.dataset.theme = 'sepia'

      const store = makeStore()

      expect(store.theme).toBe('light')
    })
  })

  describe('toggleTheme', () => {
    it('flips light to dark, persists it, and re-colors the document', () => {
      const store = makeStore()

      store.toggleTheme()

      expect(store.theme).toBe('dark')
      expect(store.isDark).toBe(true)
      expect(getStoredTheme()).toBe('dark')
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('flips dark back to light', () => {
      applyThemeAttribute('dark')
      const store = makeStore()

      store.toggleTheme()

      expect(store.theme).toBe('light')
      expect(getStoredTheme()).toBe('light')
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('returns to the starting theme after two toggles', () => {
      const store = makeStore()

      store.toggleTheme()
      store.toggleTheme()

      expect(store.theme).toBe('light')
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    /**
     * The first click has to move away from what is actually on screen. Assuming light
     * here would "toggle" a system-dark visitor straight back into dark: a dead button.
     */
    it('leaves system-dark on the first click rather than re-applying dark', () => {
      stubMatchMedia(true)
      const store = makeStore()

      store.toggleTheme()

      expect(store.theme).toBe('light')
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('still re-colors the document when the choice cannot be persisted', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })
      const store = makeStore()

      expect(() => store.toggleTheme()).not.toThrow()

      expect(store.theme).toBe('dark')
      expect(document.documentElement.dataset.theme).toBe('dark')

      setItem.mockRestore()
    })
  })
})
