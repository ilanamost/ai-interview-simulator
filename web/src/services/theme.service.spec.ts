import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredTheme, getSystemTheme, setStoredTheme } from './theme.service'
import { stubMatchMedia } from '@/test/theme-fixture'

const STORAGE_KEY = 'theme-preference'

describe('theme.service', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getStoredTheme', () => {
    it('returns null when nothing has been stored, so the system still decides', () => {
      expect(getStoredTheme()).toBeNull()
    })

    it('reads back a stored light choice', () => {
      localStorage.setItem(STORAGE_KEY, 'light')

      expect(getStoredTheme()).toBe('light')
    })

    it('reads back a stored dark choice', () => {
      localStorage.setItem(STORAGE_KEY, 'dark')

      expect(getStoredTheme()).toBe('dark')
    })

    it('ignores a value that is not a theme rather than passing it through', () => {
      localStorage.setItem(STORAGE_KEY, 'sepia')

      expect(getStoredTheme()).toBeNull()
    })
  })

  describe('setStoredTheme', () => {
    it('persists the choice under the key the pre-paint script reads', () => {
      setStoredTheme('dark')

      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    })

    it('overwrites an earlier choice instead of stacking one', () => {
      setStoredTheme('dark')
      setStoredTheme('light')

      expect(getStoredTheme()).toBe('light')
    })

    it('swallows a storage failure so a blocked write never breaks the toggle', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => setStoredTheme('dark')).not.toThrow()

      setItem.mockRestore()
    })

    it('reports nothing stored when reading back is what fails', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })

      expect(getStoredTheme()).toBeNull()

      getItem.mockRestore()
    })
  })

  describe('getSystemTheme', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('reports dark when the OS asks for dark', () => {
      stubMatchMedia(true)

      expect(getSystemTheme()).toBe('dark')
    })

    it('reports light when the OS does not ask for dark', () => {
      stubMatchMedia(false)

      expect(getSystemTheme()).toBe('light')
    })

    it('asks specifically about prefers-color-scheme: dark', () => {
      stubMatchMedia(false)

      getSystemTheme()

      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    })
  })
})
