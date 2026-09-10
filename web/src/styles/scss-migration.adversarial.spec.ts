import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compile } from 'sass'
import { describe, expect, it } from 'vitest'

/**
 * Adversarial guards for plan 017's SCSS migration.
 *
 * The migration's whole safety claim is "the compiled cascade is unchanged". Nothing in
 * the suite enforced that: the three disk-reading specs assert on the *source text* of
 * three individual files, so a reordered barrel, an unreachable stylesheet, or a
 * reintroduced `@import` would all stay green while the shipped CSS changed.
 *
 * These tests compile the real tree with the real Sass compiler and assert on the
 * *output*, which is the artifact the browser actually gets.
 */

const STYLES = resolve(process.cwd(), 'src/styles')
const ENTRY = join(STYLES, 'main.scss')

/** Vite compiles with `charset: false` (see `web/vite.config.ts`); match it here. */
const OPTS = { charset: false } as const

/**
 * Documented cascade order: tokens and reset, then base elements, then components.
 * Hard-coded on purpose — deriving it from the barrels would make a reorder
 * unfalsifiable, and this list *is* the contract the barrels have to satisfy.
 */
const CASCADE_ORDER = [
  'setup/variables.scss',
  'setup/reset.scss',
  'basics/base.scss',
  'basics/layout.scss',
  'cmps/animation.scss',
  'cmps/card.scss',
  'cmps/button.scss',
  'cmps/form.scss',
  'cmps/badge.scss',
  'cmps/progress.scss',
  'cmps/voice.scss',
  'cmps/accordion.scss',
  'cmps/home.scss',
  'cmps/menu.scss',
  'cmps/auth.scss',
  'cmps/nav.scss',
  'cmps/history.scss',
  'cmps/pagination.scss',
  'cmps/encouragement.scss'
]

/** Every `.scss` under `src/styles`, relative to that folder, POSIX-separated. */
function allStylesheets(dir = STYLES, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) return allStylesheets(join(dir, entry.name), rel)
    return entry.name.endsWith('.scss') ? [rel] : []
  })
}

describe('the SCSS tree compiles', () => {
  /**
   * Regression guard for the namespace collision that the plan's literal
   * `@use './setup/index'` / `'./basics/index'` / `'./cmps/index'` would have caused —
   * all three default to the namespace `index`, which is a hard compile error. The
   * shipped form points at the directory instead.
   */
  it('compiles main.scss without a namespace collision', () => {
    expect(() => compile(ENTRY, OPTS)).not.toThrow()
  })

  it('emits real declarations, not an empty stylesheet', () => {
    const { css } = compile(ENTRY, OPTS)
    expect(css).toContain('--clr-bg')
    expect(css.length).toBeGreaterThan(10_000)
  })
})

describe('cascade order survives the barrel conversion', () => {
  /**
   * Emit order is cascade order. Compile each leaf on its own, then locate its output
   * inside the full bundle: the positions must ascend in the documented order. A swapped
   * pair of `@use` lines flips two positions and fails here.
   */
  it('emits every stylesheet in the documented order', () => {
    const { css: full } = compile(ENTRY, OPTS)

    const positions = CASCADE_ORDER.map((rel) => {
      const own = compile(join(STYLES, rel), OPTS).css.trim()
      const marker = own.slice(0, 60)
      const at = full.indexOf(marker)
      expect(at, `${rel} is not present in the compiled bundle`).toBeGreaterThan(-1)
      return { rel, at }
    })

    const sorted = [...positions].sort((a, b) => a.at - b.at)
    expect(sorted.map((p) => p.rel)).toEqual(CASCADE_ORDER)
  })

  /**
   * The silent failure this migration makes easy: add `foo.scss` to `cmps/`, forget the
   * `@use` line in the barrel, and the styles simply never ship. Nothing else catches it.
   */
  it('reaches every stylesheet on disk from the entry point', () => {
    const onDisk = allStylesheets()
      .filter((rel) => !rel.endsWith('index.scss') && rel !== 'main.scss')
      .sort()

    expect(onDisk).toEqual([...CASCADE_ORDER].sort())
  })
})

describe('the migration invariants hold', () => {
  it('leaves no .css file in the styles tree', () => {
    const stray = readdirSync(STYLES, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.css')
    )
    expect(stray).toEqual([])
  })

  it('loads every stylesheet with @use, never the deprecated @import', () => {
    const offenders = allStylesheets().filter((rel) =>
      readFileSync(join(STYLES, rel), 'utf8').includes('@import')
    )
    expect(offenders).toEqual([])
  })

  /**
   * `@charset "UTF-8";` reappears the moment `charset: false` is dropped from
   * `vite.config.ts`, because the sources carry em dashes in comments. Harmless, but it
   * is the one byte-level difference the migration had to suppress.
   */
  it('emits no @charset prologue', () => {
    expect(compile(ENTRY, OPTS).css).not.toContain('@charset')
  })

  it('keeps charset suppression configured in vite.config.ts', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(config).toMatch(/charset:\s*false/)
  })
})

describe('variables.scss stays parseable by variables.spec.ts', () => {
  /**
   * `variables.spec.ts` reads each theme block by slicing to the *first* `}`. Sass
   * nesting inside `:root` or a `[data-theme]` block would truncate what it reads and
   * silently hollow out those assertions instead of failing them. The rules file states
   * this constraint in prose; this asserts it.
   */
  const SELECTORS = [':root {', ":root:not([data-theme='light'])", ":root[data-theme='dark']"]

  const source = readFileSync(join(STYLES, 'setup/variables.scss'), 'utf8')

  it.each(SELECTORS)('keeps the %s token block flat', (selector) => {
    const start = source.indexOf(selector)
    expect(start, `no \`${selector}\` block`).toBeGreaterThan(-1)

    const open = source.indexOf('{', start)
    const close = source.indexOf('}', open)
    const body = source.slice(open + 1, close)

    // A nested rule would put another `{` before the block's first `}`.
    expect(body).not.toContain('{')
    // And the block must still hold its declarations, not be an empty truncation.
    expect(body).toMatch(/color-scheme:/)
  })
})
