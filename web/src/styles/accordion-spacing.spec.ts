import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Read from disk: vitest stubs CSS imports to an empty string. */
const css = readFileSync(resolve(process.cwd(), 'src/styles/cmps/accordion.scss'), 'utf8')

function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No \`${selector}\` rule`)

  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('accordion panel spacing', () => {
  it('has a non-zero top padding from a spacing token, so content clears the header', () => {
    const padding = /padding:\s*([^;\n]+)/.exec(declarations('.accordion-panel'))![1].trim()
    const [top] = padding.split(/\s+/)

    expect(top).toMatch(/^var\(--sp-\d+\)$/)
  })
})

describe('untouched password field autofill fallback', () => {
  const form = readFileSync(resolve(process.cwd(), 'src/styles/cmps/form.scss'), 'utf8')

  it('hides an autofill on the untouched input, with no tinted background', () => {
    const start = form.indexOf('.control.is-untouched:-webkit-autofill')
    expect(start).toBeGreaterThan(-1)

    const rule = form.slice(form.indexOf('{', start), form.indexOf('}', start))
    expect(rule).toContain('-webkit-text-fill-color: transparent')
    expect(rule).toMatch(/box-shadow:[^;]*var\(--clr-surface\)/)
  })
})
