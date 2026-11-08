import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compile } from 'sass'
import { describe, expect, it } from 'vitest'

/**
 * Plan 022: on a phone the header gear (the only path to Logout) was pushed past the
 * viewport edge, because `.app-header` was a single non-wrapping row. jsdom does no
 * layout, so the visual result is a manual check at 360px / 390px; these guard the
 * mechanism in the compiled CSS the browser actually gets.
 *
 * Compiled with the real Sass compiler rather than imported: vitest stubs CSS to an
 * empty string, which would make every assertion here pass vacuously.
 */
const STYLES = resolve(process.cwd(), 'src/styles')
const OPTS = { charset: false } as const

const css = compile(join(STYLES, 'main.scss'), OPTS).css
const variables = readFileSync(join(STYLES, 'setup/variables.scss'), 'utf8')

const PHONE = '@media (max-width: 40rem)'

/** The body of every phone-width media block, concatenated. */
function phoneRules(): string {
  const bodies: string[] = []
  let at = css.indexOf(PHONE)

  while (at !== -1) {
    const open = css.indexOf('{', at)
    let depth = 1
    let i = open + 1
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      if (css[i] === '}') depth--
      i++
    }
    bodies.push(css.slice(open + 1, i - 1))
    at = css.indexOf(PHONE, i)
  }

  return bodies.join('\n')
}

/**
 * The declarations of `selector` inside the phone media blocks. Anchored to the start
 * of a rule, so `.avatar` does not match inside `.header-user .avatar`.
 */
function phoneRule(selector: string): string {
  const rules = phoneRules()
  const start = rules.indexOf(`\n  ${selector} {`)
  if (start === -1) return ''
  const open = rules.indexOf('{', start)
  return rules.slice(open + 1, rules.indexOf('}', open))
}

describe('the breakpoint token', () => {
  it('defines $bp-sm as 40rem in variables.scss', () => {
    expect(variables).toMatch(/^\$bp-sm:\s*40rem;/m)
  })

  /** A media query cannot read a custom property, so the token must not be one. */
  it('is not a custom property', () => {
    expect(variables).not.toContain('--bp-sm')
  })

  it('compiles to a real media query in the bundle', () => {
    expect(css).toContain(PHONE)
    // An unresolved variable would leak through as `max-width: $bp-sm` (comments may name it).
    expect(css).not.toMatch(/:\s*\$bp-sm/)
  })
})

describe('the header wraps on phones', () => {
  it('lets .app-header wrap below the breakpoint', () => {
    expect(phoneRule('.app-header')).toMatch(/flex-wrap:\s*wrap/)
  })

  /**
   * `min-width: 0` alone is not proof: wrapping is decided on the flex base size, so an
   * `auto` basis keeps the brand at its one-line width and pushes the gear to row two
   * (QA: menu clipped at 360px). The basis must be zero so the controls stay on row one.
   */
  it('gives the brand a zero flex basis so it cannot push the controls off the row', () => {
    const brand = phoneRule('.app-header .brand')
    expect(brand).toMatch(/flex:\s*1 1 0(px|%)?\s*;/)
    expect(brand).toMatch(/min-width:\s*0/)
  })

  it('does not rely on min-width alone, with an auto basis', () => {
    expect(phoneRule('.app-header .brand')).not.toMatch(/flex(-basis)?:[^;]*auto/)
  })

  it('moves the nav to its own full-width row with no left indent', () => {
    const nav = phoneRule('.app-nav')
    expect(nav).toMatch(/flex-basis:\s*100%/)
    expect(nav).toMatch(/order:\s*1/)
    expect(nav).toMatch(/margin-inline-start:\s*0/)
  })

  /** The control cluster stays right-aligned in both layouts. */
  it('keeps the theme toggle auto margin', () => {
    expect(css).toMatch(/\.theme-toggle\s*\{\s*margin-left:\s*auto/)
  })

  /** The failure path: the desktop header must not wrap. */
  it('leaves the desktop .app-header a single non-wrapping row', () => {
    const start = css.indexOf('.app-header {')
    const desktop = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
    expect(desktop).toMatch(/display:\s*flex/)
    expect(desktop).not.toContain('flex-wrap')
  })
})

describe('header tap targets on phones', () => {
  it('gives .nav-link at least 2.75rem of height', () => {
    expect(phoneRule('.nav-link')).toMatch(/min-height:\s*2\.75rem/)
  })

  it('sizes the header avatar to 2.75rem square', () => {
    const rule = phoneRule('.header-user .avatar')
    expect(rule).toMatch(/width:\s*2\.75rem/)
    expect(rule).toMatch(/height:\s*2\.75rem/)
  })

  it('gives the gear and theme toggle at least 2.75rem in both axes', () => {
    const rule = phoneRule('.menu-trigger,\n  .theme-toggle')
    expect(rule).toMatch(/min-width:\s*2\.75rem/)
    expect(rule).toMatch(/min-height:\s*2\.75rem/)
  })

  /** Scoped to the header so the settings page's large avatar is not shrunk. */
  it('does not resize a bare .avatar, which would override .avatar-lg', () => {
    expect(phoneRule('.avatar')).toBe('')
  })
})
