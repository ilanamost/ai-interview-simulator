import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * QA adversarial pass on plan 015 item 3. jsdom paints no UA chrome, so the visible fix (a
 * light calendar glyph in dark mode) can only be confirmed by eye — these are the
 * source-level guards around it: that `color-scheme` is the mechanism actually shipped,
 * that no per-browser glyph hack was reached for instead, and that the custom scrollbar
 * rules from plan 010 still ride the tokens rather than fighting the new UA default.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const variables = read('./setup/variables.scss')
const base = read('./basics/base.scss')
const form = read('./cmps/form.scss')

describe('the color-scheme fix is the whole fix', () => {
  it('declares color-scheme exactly once per theme block and nowhere else', () => {
    // Three declarations: :root, the OS-preference dark block, the chosen-dark block.
    // The `prefers-color-scheme` media query itself is not a declaration.
    const declarations = variables.match(/^\s*color-scheme:\s*(light|dark)/gm) ?? []

    expect(declarations).toHaveLength(3)
  })

  /**
   * The rejected alternative. `::-webkit-calendar-picker-indicator { filter: invert(1) }`
   * repaints only the glyph, only on Chromium, and leaves a blinding white popup panel in
   * dark mode. Plan step 12 allows it only as a supplement if the manual check showed
   * `color-scheme` was insufficient — it did not, so nothing should be here.
   */
  it('reaches for no per-browser calendar-glyph hack', () => {
    for (const css of [variables, base, form]) {
      expect(css).not.toContain('calendar-picker-indicator')
      expect(css).not.toMatch(/filter:\s*invert/)
    }
  })

  it('puts color-scheme on the same selectors the tokens already use, adding no new block', () => {
    // Plan 011's three selectors, unchanged — no fourth theme selector was introduced.
    // Comments in this file also name the attribute, so only real selectors are counted.
    const code = variables.replace(/\/\*[\s\S]*?\*\//g, '')

    expect(code).toContain(":root[data-theme='dark']")
    expect(code).toContain(":root:not([data-theme='light'])")
    expect(code.match(/data-theme/g) ?? []).toHaveLength(2)
  })
})

describe('the custom scrollbars still override the new UA default rather than fight it', () => {
  it('colours the scrollbar from tokens, not from literals that would ignore the theme', () => {
    const scrollbarRules = base.match(/(scrollbar-color|::-webkit-scrollbar[^{]*)\{[^}]*\}/g) ?? []
    expect(scrollbarRules.length).toBeGreaterThan(0)

    expect(base).toMatch(/scrollbar-color:\s*var\(--clr-border\)/)
    expect(base).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--clr-/)

    // No hardcoded hex inside any scrollbar rule: that is what would look wrong in one theme.
    for (const rule of scrollbarRules) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
