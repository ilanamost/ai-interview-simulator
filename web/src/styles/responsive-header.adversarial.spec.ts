import { join, resolve } from 'node:path'
import { compile } from 'sass'
import { describe, expect, it } from 'vitest'

/**
 * QA adversarial guard for plan 022 (mobile Logout).
 *
 * In a wrapping flex container the browser picks line breaks from each item's
 * hypothetical main size, which for `flex-basis: auto` is the max-content width.
 * `min-width: 0` only matters after the line is chosen, so it never lets the brand
 * shrink to make room. Measured in headless Chrome at 360px: the one-line brand
 * (~200px) + toggle + avatar + gear needs ~356px of a 328px content box, so
 * `.header-user` wraps to row two at the LEFT edge, and the right-anchored
 * `.menu-panel` opens at x = -64, clipping "User settings" and "Logout".
 *
 * A zero flex-basis on the brand below the breakpoint makes the line break ignore
 * the brand's text width; the brand then shrinks and wraps its own text instead.
 * jsdom does no layout, so this asserts the mechanism in the compiled CSS.
 */
const STYLES = resolve(process.cwd(), 'src/styles')
const css = compile(join(STYLES, 'main.scss'), { charset: false }).css

const PHONE = '@media (max-width: 40rem)'

function phoneBrandRules(): string[] {
  const found: string[] = []
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
    const body = css.slice(open + 1, i - 1)
    const re = /\.app-header \.brand\s*\{([^}]*)\}/g
    let match = re.exec(body)
    while (match) {
      found.push(match[1])
      match = re.exec(body)
    }
    at = css.indexOf(PHONE, i)
  }

  return found
}

describe('the brand cannot push the gear onto a second row on a 360px phone', () => {
  it('gives .brand a zero flex-basis below the breakpoint, not only min-width: 0', () => {
    const decls = phoneBrandRules().join('\n')
    const zeroBasis =
      /flex-basis:\s*0(px|rem|%)?\s*(;|$)/m.test(decls) ||
      /flex:\s*\d+(\.\d+)?\s+\d+(\.\d+)?\s+0(px|rem|%)?\s*(;|$)/m.test(decls) ||
      /flex:\s*1\s*(;|$)/m.test(decls)

    expect(
      zeroBasis,
      'phone .app-header .brand needs a zero flex-basis (e.g. `flex: 1 1 0`); with ' +
        '`flex-basis: auto` the control cluster wraps left and the menu panel opens off-screen'
    ).toBe(true)
  })
})
