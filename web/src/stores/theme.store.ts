import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getSystemTheme, setStoredTheme, type Theme } from '@/services/theme.service'

/**
 * The inline script in `web/index.html` has already applied any stored choice to
 * `<html data-theme>` before Vue boots, so that attribute — not `localStorage` — is
 * what this store reads back. Re-deriving the answer from storage here would give the
 * app two sources of truth that could disagree.
 *
 * An unset attribute means no explicit choice was ever made, so the page is rendering
 * whatever `prefers-color-scheme` asked for: report that, rather than assuming light,
 * or the first click would "toggle" to the theme already on screen.
 */
function readAppliedTheme(): Theme {
  const applied = document.documentElement.dataset.theme
  return applied === 'light' || applied === 'dark' ? applied : getSystemTheme()
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(readAppliedTheme())

  const isDark = computed(() => theme.value === 'dark')

  /**
   * Always lands on an explicit `light`/`dark`, never back on "follow the system" —
   * this is a two-state switch, so once the visitor has an opinion the app keeps it.
   *
   * The baseline is re-read here rather than taken from `theme.value`, which was
   * sampled once at construction. While nothing is stored the page follows
   * `prefers-color-scheme` live, so an OS scheme change since boot has already
   * re-colored the screen without the ref noticing. Flipping that stale baseline would
   * land on the theme already showing — a click that visibly does nothing. Once a
   * choice has been applied the attribute exists and this simply reads it back.
   */
  function toggleTheme() {
    const next: Theme = readAppliedTheme() === 'dark' ? 'light' : 'dark'

    theme.value = next
    setStoredTheme(next)
    // The CSS override layer keys off this attribute; without it nothing re-colors.
    document.documentElement.dataset.theme = next
  }

  return { theme, isDark, toggleTheme }
})
