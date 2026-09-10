import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `color-scheme` is what makes the chrome the browser draws itself — the date input's
 * calendar glyph and its popup panel among them — follow the active theme instead of
 * always rendering in the UA's light scheme. jsdom paints no such chrome, so the source
 * is the only automatable check; the visual confirmation is manual, in both themes.
 *
 * Read from disk rather than imported: vitest stubs CSS modules to an empty string,
 * which would make every assertion here pass vacuously.
 */
const CSS_PATH = 'src/styles/setup/variables.scss'

const css = readFileSync(resolve(process.cwd(), CSS_PATH), 'utf8')

/**
 * The declarations of one theme block. None of the three nests braces, so the block ends
 * at the first `}` after its selector.
 */
function block(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`No \`${selector}\` block in ${CSS_PATH}`)

  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

/** The three selectors plan 011 established, which plan 015 adds to rather than restructures. */
const LIGHT = ':root {'
const SYSTEM_DARK = ":root:not([data-theme='light'])"
const CHOSEN_DARK = ":root[data-theme='dark']"

describe('the theme blocks declare a color scheme for UA-drawn controls', () => {
  it('loaded the stylesheet it is asserting about', () => {
    expect(css).toContain('--clr-bg')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
  })

  it('declares light on :root', () => {
    expect(block(LIGHT)).toMatch(/color-scheme:\s*light/)
  })

  it('declares dark for the OS preference, so a system-dark reader gets it with no stored choice', () => {
    expect(block(SYSTEM_DARK)).toMatch(/color-scheme:\s*dark/)
  })

  it('declares dark for an explicit dark choice, so the toggle wins on a light system too', () => {
    expect(block(CHOSEN_DARK)).toMatch(/color-scheme:\s*dark/)
  })

  /** The failure mode: one block declaring the other scheme would invert the glyph. */
  it('never declares dark in the light block, nor light in either dark block', () => {
    expect(block(LIGHT)).not.toMatch(/color-scheme:\s*dark/)
    expect(block(SYSTEM_DARK)).not.toMatch(/color-scheme:\s*light/)
    expect(block(CHOSEN_DARK)).not.toMatch(/color-scheme:\s*light/)
  })
})
